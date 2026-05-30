#!/usr/bin/env node
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { Command } from "commander";
import {
  createDefaultConfig,
  detectAvailableProviders,
  loadConfig,
  renderMarkdownReport,
  runCouncil,
  serializeConfig,
  shouldFailForReport,
  type QuorateConfig
} from "@quorate/core";
import { readDiff } from "./diff.js";
import { startShell } from "./shell.js";
import { launchInkShell } from "./tui/index.js";
import { validateProviderSelection } from "./session.js";

interface GlobalOptions {
  config?: string;
  cwd?: string;
}

const defaultCwd = process.env.INIT_CWD ?? process.cwd();

function cwdFrom(program: Command): string {
  const opts = program.opts<GlobalOptions>();
  return resolve(opts.cwd ?? defaultCwd);
}

function configFrom(program: Command): QuorateConfig {
  const opts = program.opts<GlobalOptions>();
  return loadConfig(opts.config, cwdFrom(program));
}

function applyProviderFilter(config: QuorateConfig, providerList?: string): QuorateConfig {
  if (!providerList) return config;
  const selected = new Set(providerList.split(",").map((provider) => provider.trim()).filter(Boolean));

  return {
    ...config,
    providers: config.providers.map((provider) => ({
      ...provider,
      enabled: selected.has(provider.id)
    }))
  };
}

function printProviderTable(config: QuorateConfig): void {
  const detected = detectAvailableProviders();
  const byId = new Map(detected.map((provider) => [provider.id, provider]));

  console.log("Provider\tEnabled\tAvailable\tCommand\tPath");
  for (const provider of config.providers) {
    const detectedProvider = byId.get(provider.id);
    const available = provider.type === "mock" ? true : detectedProvider?.available ?? false;
    console.log(
      [
        provider.id,
        provider.enabled !== false ? "yes" : "no",
        available ? "yes" : "no",
        provider.command ?? "",
        detectedProvider?.path ?? ""
      ].join("\t")
    );
  }
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("quorate")
    .description("Run a multi-agent code review council from local CLIs or GitHub Actions.")
    .version("0.1.0")
    .option("-c, --config <path>", "Path to .quorate.yml")
    .option("--cwd <path>", "Working directory", defaultCwd);

  program
    .command("init")
    .description("Create a starter .quorate.yml with detected provider commands disabled by default.")
    .option("-f, --force", "Overwrite an existing config file")
    .action((options) => {
      const cwd = cwdFrom(program);
      const configPath = resolve(cwd, ".quorate.yml");
      if (existsSync(configPath) && !options.force) {
        throw new Error(`${configPath} already exists. Use --force to overwrite it.`);
      }

      const config = createDefaultConfig(detectAvailableProviders());
      writeFileSync(configPath, serializeConfig(config), "utf8");
      console.log(`Created ${configPath}`);
    });

  program
    .command("doctor")
    .description("Detect local provider CLIs and show current configuration state.")
    .option("--json", "Print machine-readable JSON")
    .action((options) => {
      const config = configFrom(program);
      const detected = detectAvailableProviders();
      if (options.json) {
        console.log(JSON.stringify({ detected, config }, null, 2));
        return;
      }

      printProviderTable(config);
    });

  program
    .command("providers")
    .description("List configured providers.")
    .option("--json", "Print machine-readable JSON")
    .action((options) => {
      const config = configFrom(program);
      if (options.json) {
        console.log(JSON.stringify(config.providers, null, 2));
        return;
      }

      printProviderTable(config);
    });

  program
    .command("review")
    .description("Review a diff using the configured council.")
    .option("--diff <path>", "Read a unified diff from a file")
    .option("--base <ref>", "Base ref for git diff")
    .option("--head <ref>", "Head ref for git diff")
    .option("--pr <number>", "Read a pull request diff with gh pr diff")
    .option("--subject <text>", "Review subject", "Local code review")
    .option("--providers <ids>", "Comma-separated provider ids to enable for this run")
    .option("--json", "Print JSON instead of Markdown")
    .option("--write-json <path>", "Write the JSON report to a file")
    .action(async (options) => {
      const cwd = cwdFrom(program);
      const config = applyProviderFilter(configFrom(program), options.providers);
      const diff = readDiff(options, cwd);
      const report = await runCouncil(
        {
          mode: "review",
          subject: options.subject,
          diff,
          repoPath: cwd,
          pullRequest: options.pr ? { number: Number(options.pr) } : undefined
        },
        config
      );

      if (options.writeJson) {
        writeFileSync(resolve(cwd, options.writeJson), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      }

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(renderMarkdownReport(report));
      }

      if (shouldFailForReport(report, config.github)) {
        process.exitCode = 1;
      }
    });

  program
    .command("plan")
    .description("Ask the council to evaluate an implementation or architecture plan.")
    .argument("<prompt...>", "Plan prompt")
    .option("--providers <ids>", "Comma-separated provider ids to enable for this run")
    .option("--json", "Print JSON instead of Markdown")
    .action(async (promptParts: string[], options) => {
      const cwd = cwdFrom(program);
      const config = applyProviderFilter(configFrom(program), options.providers);
      const subject = promptParts.join(" ");
      const report = await runCouncil(
        {
          mode: "plan",
          subject,
          repoPath: cwd
        },
        config
      );

      console.log(options.json ? JSON.stringify(report, null, 2) : renderMarkdownReport(report));
    });

  program
    .command("shell", { isDefault: true })
    .description("Start an interactive Quorate shell (default when no subcommand is given).")
    .option("--providers <ids>", "Comma-separated provider ids to enable for this shell session")
    .option("--mode <mode>", "Initial mode: review or plan", "review")
    .option("--classic", "Use the legacy inline shell instead of the Ink TUI")
    .action(async (options) => {
      if (options.mode !== "review" && options.mode !== "plan") {
        throw new Error("--mode must be review or plan");
      }
      const config = configFrom(program);
      const unknownProviders = validateProviderSelection(config, options.providers);
      if (unknownProviders.length > 0) {
        throw new Error(`Unknown provider id${unknownProviders.length === 1 ? "" : "s"}: ${unknownProviders.join(", ")}`);
      }

      const cwd = cwdFrom(program);
      if (stdin.isTTY && stdout.isTTY && !options.classic) {
        await launchInkShell({
          cwd,
          config,
          providers: options.providers,
          mode: options.mode
        });
        return;
      }

      await startShell({
        cwd,
        config,
        providers: options.providers,
        mode: options.mode
      });
    });

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  const currentFile = fileURLToPath(import.meta.url);
  try {
    return realpathSync(process.argv[1]) === currentFile;
  } catch {
    return process.argv[1] === currentFile;
  }
}

if (isCliEntrypoint()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
