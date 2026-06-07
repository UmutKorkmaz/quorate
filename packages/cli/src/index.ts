#!/usr/bin/env node
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { Command } from "commander";
import {
  createDefaultConfig,
  detectAvailableProviders,
  findConfigPath,
  findExecutable,
  glyphs,
  isEmptyReviewDiff,
  loadConfig,
  PALETTE,
  renderMarkdownReport,
  runCouncil,
  serializeConfig,
  shouldFailForReport,
  type QuorateConfig
} from "@quorate/core";
import { readDiff } from "./diff.js";
import { startShell } from "./shell.js";
import { launchInkShell } from "./tui/index.js";
import { providerSnapshots, suggestionSuffix, validateProviderSelection, type ShellState } from "./session.js";
import { bold, dim, paint } from "./term.js";
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

function shellStateFor(config: QuorateConfig, cwd: string): ShellState {
  return { cwd, config, mode: "review", transcript: [] };
}

function doctorRow(glyph: string, color: string, label: string, detail: string, active = false): string {
  const tag = active ? paint(PALETTE.accent, " (active)") : "";
  return `  ${paint(color, glyph)} ${label.padEnd(12)} ${dim(detail)}${tag}`;
}

/**
 * The verdict-style health checklist behind `quorate doctor`: environment
 * checks, per-provider state with a copy-paste fix, and a closing verdict that
 * names the next command. Honest by design — heuristic-only is reported as
 * DEGRADED, never a confident green.
 */
function printDoctor(config: QuorateConfig, cwd: string): void {
  const g = glyphs();
  const snapshots = providerSnapshots(shellStateFor(config, cwd));
  const realRunnable = snapshots.filter((snapshot) => snapshot.runnable && snapshot.id !== "heuristic");

  const lines: string[] = ["", `  ${paint(["bold", PALETTE.accent], "Quorate doctor")}  ${dim(`${g.separator} council readiness`)}`];

  lines.push("", `  ${bold("Environment")}`);
  const nodeOk = Number(process.versions.node.split(".")[0]) >= 22;
  lines.push(
    doctorRow(
      nodeOk ? g.check : g.cross,
      nodeOk ? PALETTE.ok : PALETTE.missing,
      `Node ${process.versions.node}`,
      nodeOk ? "Node >= 22 — ok" : "Quorate requires Node >= 22"
    )
  );
  for (const tool of ["git", "gh"] as const) {
    const path = findExecutable(tool);
    const hint = tool === "gh" ? "optional — enables /pr and --pr" : "recommended for git diffs";
    lines.push(
      doctorRow(path ? g.check : g.warn, path ? PALETTE.ok : PALETTE.needsProfile, tool, path ?? hint)
    );
  }

  lines.push("", `  ${bold("Providers")}  ${dim(`${realRunnable.length} runnable ${g.separator} ${snapshots.length} known`)}`);
  for (const snapshot of snapshots) {
    let glyph = g.cross;
    let color = PALETTE.missing;
    let detail: string;
    if (snapshot.id === "heuristic") {
      glyph = g.check;
      color = PALETTE.ok;
      detail = `built-in ${g.separator} always available`;
    } else if (snapshot.runnable) {
      glyph = g.check;
      color = PALETTE.ok;
      detail = `runnable${snapshot.installHint ? ` ${g.separator} ${snapshot.installHint}` : ""}`;
    } else if (snapshot.available) {
      glyph = g.warn;
      color = PALETTE.needsProfile;
      detail = `found ${g.separator} needs a headless profile ${g.arrow} see .quorate.example.yml`;
    } else {
      detail = `not installed${snapshot.installHint ? ` ${g.separator} install ${snapshot.installHint}` : ""}`;
    }
    lines.push(doctorRow(glyph, color, snapshot.id, detail, snapshot.active));
  }

  lines.push("", `  ${bold("Verdict")}`);
  if (realRunnable.length > 0) {
    const ids = realRunnable.slice(0, 2).map((snapshot) => snapshot.id).join(",");
    lines.push(`  ${paint(PALETTE.ok, g.check)} Council ready — ${realRunnable.length} real reviewer${realRunnable.length === 1 ? "" : "s"} runnable.`);
    lines.push(dim(`     Try:  quorate review --providers ${ids} --base main`));
  } else {
    lines.push(`  ${paint(PALETTE.degraded, g.warn)} Heuristic-only — reviews report as DEGRADED, never a confident pass.`);
    lines.push(dim("     Install a reviewer (claude, codex, qwen …), then:"));
    lines.push(dim("       quorate init      # write .quorate.yml"));
    lines.push(dim("       quorate doctor    # confirm it is runnable"));
  }
  lines.push("", dim(`  Config: ${findConfigPath(cwd) ?? "none — using built-in defaults (run quorate init)"}`));
  console.log(lines.join("\n"));
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
    });

  program
    .command("doctor")
    .helpGroup("Setup:")
    .description("Check council readiness: environment, provider availability, and the next step.")
    .option("--json", "Print machine-readable JSON")
    .action((options) => {
      const config = configFrom(program);
      const detected = detectAvailableProviders();
      if (options.json) {
        console.log(JSON.stringify({ detected, config }, null, 2));
        return;
      }

      printDoctor(config, cwdFrom(program));
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
    .option("--json", "Print JSON instead of Markdown")
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
    .helpGroup("Review:")
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
    .helpGroup("Interactive:")
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
        const ids = config.providers.map((provider) => provider.id);
        throw new Error(
          `Unknown provider id${unknownProviders.length === 1 ? "" : "s"}: ${unknownProviders.join(", ")}${suggestionSuffix(unknownProviders, ids)}`
        );
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
