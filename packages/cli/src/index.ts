#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { Command } from "commander";
import {
  createDefaultConfig,
  detectAvailableProviders,
  findConfigPath,
  isEmptyReviewDiff,
  loadConfig,
  PALETTE,
  PROVIDER_PRESETS,
  PROVIDER_PRESET_NAMES,
  renderMarkdownReport,
  runCouncil,
  serializeConfig,
  shouldFailForReport,
  type QuorateConfig
} from "@quorate/core";
import { buildProvider } from "./provider-add.js";
import { readDiff } from "./diff.js";
import { buildDoctorBundle } from "./doctor-bundle.js";
import { printDoctor } from "./doctor.js";
import { latestSession, loadSession, type PersistedSession } from "./sessions.js";
import { runCouncilWithJsonStream } from "./json-stream.js";
import { startShell } from "./shell.js";
import { launchInkShell } from "./tui/index.js";
import { suggestionSuffix, validateProviderSelection } from "./session.js";
import { paint } from "./term.js";
import { readVersion } from "./version.js";

interface GlobalOptions {
  config?: string;
  cwd?: string;
}

const defaultCwd = process.env.INIT_CWD ?? process.cwd();

function cwdFrom(program: Command): string {
  const opts = program.opts<GlobalOptions>();
  return resolve(opts.cwd ?? defaultCwd);
}

/** Add `entry` to the repo's .gitignore if missing (best-effort, never throws). */
function ensureGitignored(cwd: string, entry: string): void {
  try {
    const gitignorePath = resolve(cwd, ".gitignore");
    const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
    const lines = existing.split("\n").map((line) => line.trim());
    if (lines.includes(entry) || lines.includes(entry.replace(/\/$/, ""))) return;
    const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
    appendFileSync(gitignorePath, `${prefix}\n# Quorate session/report artifacts\n${entry}\n`, "utf8");
    console.log(`Added ${entry} to .gitignore`);
  } catch {
    // Non-fatal: init still succeeds even if .gitignore can't be written.
  }
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

function helpExamples(): string {
  const heading = (text: string): string => paint(["bold", PALETTE.accent], text);
  return [
    "",
    heading("Examples:"),
    "  $ quorate                            open the interactive council shell",
    "  $ quorate doctor                     see which AI CLIs are installed",
    "  $ quorate review --base main         review the current branch against main",
    "  $ quorate review --pr 42             review a pull request (uses gh)",
    "  $ quorate review --diff changes.diff one-shot review of a diff file",
    '  $ quorate plan "add a rate limiter"  evaluate a plan instead of a diff',
    "",
    `${heading("Learn more:")}  https://github.com/UmutKorkmaz/quorate`,
    ""
  ].join("\n");
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("quorate")
    .description("Run a multi-agent code review council from local CLIs or GitHub Actions.")
    .version(readVersion(), "-v, --version", "Print the installed Quorate version")
    .option("-c, --config <path>", "Path to .quorate.yml")
    .option("--cwd <path>", "Working directory", defaultCwd)
    .configureHelp({
      styleTitle: (title) => paint(["bold", PALETTE.accent], title),
      styleCommandText: (text) => paint(PALETTE.command, text),
      styleSubcommandText: (text) => paint(PALETTE.command, text),
      styleOptionText: (text) => paint(PALETTE.ok, text),
      styleArgumentText: (text) => paint(PALETTE.warn, text)
    })
    .showHelpAfterError("(run `quorate --help` for usage)")
    .showSuggestionAfterError(true)
    .addHelpText("after", helpExamples);

  program
    .command("init")
    .helpGroup("Setup:")
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

      // Session/report artifacts (diffs, transcripts, findings) are written under
      // .quorate/ — keep them out of version control.
      ensureGitignored(cwd, ".quorate/");
    });

  program
    .command("doctor")
    .helpGroup("Setup:")
    .description("Check council readiness: environment, provider availability, and the next step.")
    .option("--json", "Print machine-readable JSON")
    .option("--bundle", "Zip diagnostics to stdout (redacted config, provider grid, last report)")
    .option("--bundle-file <path>", "Write diagnostic zip to a file")
    .action((options) => {
      const cwd = cwdFrom(program);
      const config = configFrom(program);
      const detected = detectAvailableProviders();

      if (options.bundle || options.bundleFile) {
        const buffer = buildDoctorBundle(config, cwd);
        if (options.bundleFile) {
          writeFileSync(resolve(cwd, options.bundleFile), buffer);
          console.log(`Wrote diagnostic bundle to ${options.bundleFile}`);
        } else {
          stdout.write(buffer);
        }
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({ detected, config }, null, 2));
        return;
      }

      printDoctor(config, cwd);
    });

  program
    .command("providers")
    .helpGroup("Setup:")
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

  const providerCmd = program
    .command("provider")
    .helpGroup("Setup:")
    .description("Manage providers in .quorate.yml (add, remove, presets).");

  providerCmd
    .command("add <id>")
    .description("Add a provider to .quorate.yml. Use --preset for a ready template.")
    .option("--preset <name>", `Template: ${PROVIDER_PRESET_NAMES.join(", ")}`)
    .option("--type <type>", "Provider type: cli or api (default: api, or the preset's type)")
    .option("--base-url <url>", "OpenAI-compatible base URL (api providers)")
    .option("--model <model>", "Model id (required for api providers)")
    .option("--api-key-env <var>", "Env var holding the API key (api providers, optional)")
    .option("--command <cmd>", "Executable to run (cli providers; default: the id)")
    .option("--args <list>", "Headless args, comma/space-separated (cli providers)")
    .option("--input-mode <mode>", "stdin | prompt-file | none (cli providers)")
    .option("--roles <list>", "Council roles, comma-separated (e.g. qa,security)")
    .option("--enabled", "Add the provider enabled (default)")
    .option("--disabled", "Add the provider disabled")
    .option("-f, --force", "Replace an existing provider with the same id")
    .action((id: string, options) => {
      const cwd = cwdFrom(program);
      const provider = buildProvider(id, options);
      const configPath = findConfigPath(cwd) ?? resolve(cwd, ".quorate.yml");
      const config = existsSync(configPath)
        ? loadConfig(configPath, cwd)
        : createDefaultConfig(detectAvailableProviders());
      const index = config.providers.findIndex((entry) => entry.id === id);
      if (index >= 0 && !options.force) {
        throw new Error(`Provider "${id}" already exists in ${configPath}. Use --force to replace it.`);
      }
      const providers =
        index >= 0
          ? config.providers.map((entry, i) => (i === index ? provider : entry))
          : [...config.providers, provider];
      writeFileSync(configPath, serializeConfig({ ...config, providers }), "utf8");
      ensureGitignored(cwd, ".quorate/");

      const detail = provider.type === "api" ? `api · ${provider.model}` : `cli · ${provider.command}`;
      console.log(`${index >= 0 ? "Replaced" : "Added"} provider "${id}" (${detail}) in ${configPath}`);
      console.log(`Roles: ${provider.roles?.join(", ") ?? "(config default)"}.`);
      if (provider.apiKeyEnv) console.log(`Set ${provider.apiKeyEnv} in your environment before running.`);
      console.log("Restart quorate to load it; /route to see role assignments, /review to run.");
    });

  providerCmd
    .command("remove <id>")
    .alias("rm")
    .description("Remove a provider from .quorate.yml.")
    .action((id: string) => {
      const cwd = cwdFrom(program);
      const configPath = findConfigPath(cwd);
      if (!configPath) {
        throw new Error("No .quorate.yml found. Run `quorate init` first.");
      }
      const config = loadConfig(configPath, cwd);
      if (!config.providers.some((entry) => entry.id === id)) {
        throw new Error(`No provider "${id}" in ${configPath}.`);
      }
      const providers = config.providers.filter((entry) => entry.id !== id);
      writeFileSync(configPath, serializeConfig({ ...config, providers }), "utf8");
      console.log(`Removed provider "${id}" from ${configPath}.`);
    });

  providerCmd
    .command("presets")
    .description("List the built-in API provider presets.")
    .action(() => {
      for (const name of PROVIDER_PRESET_NAMES) {
        const preset = PROVIDER_PRESETS[name];
        console.log(`  ${name.padEnd(11)} ${preset.baseUrl}  ${preset.model}`);
      }
      console.log("\nAdd one with: quorate provider add <id> --preset <name> [--model <model>]");
    });

  program
    .command("review")
    .helpGroup("Review:")
    .description("Review a diff using the configured council.")
    .option("--diff <path>", "Read a unified diff from a file")
    .option("--base <ref>", "Base ref for git diff")
    .option("--head <ref>", "Head ref for git diff")
    .option("--pr <number>", "Read a pull request diff with gh pr diff")
    .option("--subject <text>", "Review subject", "Local code review")
    .option("--providers <ids>", "Comma-separated provider ids to enable for this run")
    .option("--json", "Stream NDJSON events to stdout (final line is the report JSON)")
    .option("--write-json <path>", "Write the JSON report to a file")
    .action(async (options) => {
      const cwd = cwdFrom(program);
      const config = applyProviderFilter(configFrom(program), options.providers);
      const diff = readDiff(options, cwd);
      if (isEmptyReviewDiff("review", diff)) {
        console.error("No changes to review. Pass --diff <file>, --base/--head, or --pr <number>.");
        process.exitCode = 1;
        return;
      }
      const request = {
        mode: "review" as const,
        subject: options.subject,
        diff,
        repoPath: cwd,
        pullRequest: options.pr ? { number: Number(options.pr) } : undefined
      };

      const report = options.json
        ? await runCouncilWithJsonStream(request, config, {
            writeStdout: (line) => process.stdout.write(`${line}\n`),
            writeStderr: (line) => console.error(line)
          })
        : await runCouncil(request, config);

      if (options.writeJson) {
        writeFileSync(resolve(cwd, options.writeJson), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      }

      if (!options.json) {
        console.log(renderMarkdownReport(report));
      }

      if (shouldFailForReport(report, config.github)) {
        process.exitCode = 1;
      }
    });

  program
    .command("plan")
    .helpGroup("Review:")
    .description("Ask the council to evaluate an implementation or architecture plan.")
    .argument("<prompt...>", "Plan prompt")
    .option("--providers <ids>", "Comma-separated provider ids to enable for this run")
    .option("--json", "Stream NDJSON events to stdout (final line is the report JSON)")
    .action(async (promptParts: string[], options) => {
      const cwd = cwdFrom(program);
      const config = applyProviderFilter(configFrom(program), options.providers);
      const subject = promptParts.join(" ");
      const request = { mode: "plan" as const, subject, repoPath: cwd };

      const report = options.json
        ? await runCouncilWithJsonStream(request, config, {
            writeStdout: (line) => process.stdout.write(`${line}\n`),
            writeStderr: (line) => console.error(line)
          })
        : await runCouncil(request, config);

      if (!options.json) {
        console.log(renderMarkdownReport(report));
      }
    });

  program
    .command("shell", { isDefault: true })
    .helpGroup("Interactive:")
    .description("Start an interactive Quorate shell (default when no subcommand is given).")
    .option("--providers <ids>", "Comma-separated provider ids to enable for this shell session")
    .option("--mode <mode>", "Initial mode: review or plan", "review")
    .option("--continue", "Resume the most recent saved session for this repo")
    .option("--resume [id]", "Resume a saved session by id (omit id to use the latest)")
    .option("--classic", "Use the legacy inline shell instead of the Ink TUI")
    .action(async (options) => {
      if (options.mode !== "review" && options.mode !== "plan") {
        throw new Error("--mode must be review or plan");
      }
      const config = configFrom(program);
      const unknownProviders = validateProviderSelection(config, options.providers);
      if (unknownProviders.length > 0) {
        const ids = config.providers.map((provider) => provider.id);
        throw new Error(
          `Unknown provider id${unknownProviders.length === 1 ? "" : "s"}: ${unknownProviders.join(", ")}${suggestionSuffix(unknownProviders, ids)}`
        );
      }

      const cwd = cwdFrom(program);
      let restoredSession: PersistedSession | undefined;
      if (options.continue) {
        restoredSession = latestSession(cwd);
        if (!restoredSession) {
          throw new Error("No saved sessions for this repo. Run a /review first.");
        }
      } else if (options.resume !== undefined) {
        const id = typeof options.resume === "string" ? options.resume : undefined;
        restoredSession = id ? loadSession(cwd, id) ?? latestSession(cwd) : latestSession(cwd);
        if (!restoredSession) {
          throw new Error("No saved sessions for this repo. Run a /review first.");
        }
      }

      if (stdin.isTTY && stdout.isTTY && !options.classic) {
        await launchInkShell({
          cwd,
          config,
          providers: options.providers,
          mode: options.mode,
          restoredSession
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
