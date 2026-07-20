#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { Command } from "commander";
import {
  buildMultiPackConfig,
  analyzeReviewBudget,
  buildSolanaReleaseGate,
  buildSolanaTestPlan,
  buildPullRequestContext,
  createDefaultConfig,
  detectAvailableProviders,
  detectPacks,
  fetchProviderModels,
  findConfigPath,
  formatBudgetSummary,
  formatSolanaReleaseGate,
  formatSolanaTestPlan,
  isLocalBaseUrl,
  isEmptyReviewDiff,
  loadConfig,
  PACK_COVERAGE,
  PACK_IDS,
  PACKS,
  PALETTE,
  PROVIDER_PRESETS,
  PROVIDER_PRESET_NAMES,
  renderHtml,
  renderJunit,
  renderMarkdownReport,
  renderReviewGraph,
  renderSarif,
  resolvePolicy,
  runCouncil,
  serializeConfig,
  shouldFailForPolicy,
  type CouncilRequest,
  type CouncilReport,
  type ProviderConfig,
  type QuorateConfig,
  type Severity
} from "@quorate/core";
import { buildProvider } from "./provider-add.js";
import { applyBaselineToReport, writeBaselineFromReport } from "./baseline-command.js";
import {
  applySuppressionStore,
  loadSuppressionStore,
  removeSuppressionFromStore,
  writeSuppression
} from "./suppress-command.js";
import {
  appendHistory,
  computeStats,
  formatHistoryTable,
  formatStatsReport,
  readHistory
} from "./history-command.js";
import { listExpired } from "@quorate/core";
import {
  buildRiskReport,
  generateGithubActionWorkflow,
  mergeVscodeRecommendations,
  type RiskItem
} from "./setup-command.js";
import {
  explainPolicy,
  loadLastReport,
  loadPolicyFile,
  policyDoctor,
  writeStarterPolicy
} from "./policy-command.js";
import { createFixSnapshot, finalizeFix, listFixes, revertFix } from "./fix.js";
import { buildFixPrompt, extractHunk } from "./fix-prompt.js";
import { runWriteAgent, WRITE_AGENT_PROFILES, writeAgentProfile } from "./fix-agent.js";
import { readDiff, readPullRequestContext } from "./diff.js";
import { buildDoctorBundle } from "./doctor-bundle.js";
import { printDoctor } from "./doctor.js";
import { latestSession, loadSession, type PersistedSession } from "./sessions.js";
import { runCouncilWithJsonStream } from "./json-stream.js";
import { createLiveSpoolSink, listLiveRuns, teeJsonStreamSink } from "./live-spool.js";
import { startShell } from "./shell.js";
import { launchInkShell } from "./tui/index.js";
import { launchMonitor } from "./tui/monitor.js";
import { createMonitorServer, listenMonitorServer } from "./monitor-server.js";
import { runHookReportCli } from "./hook-report.js";
import { applyRemove, applySetup, claudeSettingsPath, codexConfigPath, codexNotifySlotOccupied, computeSetupPlan, detectCliCapabilities, renderCapabilityTable } from "./monitor-setup.js";
import { suggestionSuffix, validateProviderSelection } from "./session.js";
import { paint } from "./term.js";
import { readVersion } from "./version.js";
import {
  applyWorkspaceCustomPacks,
  loadWorkspaceCustomPacks,
  writeCustomPackScaffold
} from "./custom-packs.js";
import { formatProviderTestResult, testProvider } from "./provider-test.js";
import { readRepositoryFiles, runSupplyChainScan } from "./supply-chain-command.js";

interface GlobalOptions {
  config?: string;
  cwd?: string;
}

/** Best-effort browser launch; the printed URL is the reliable path. */
function openInBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true, shell: false });
    child.on("error", () => {
      // The URL is already printed — failing to auto-open is not an error.
    });
    child.unref();
  } catch {
    // Same: auto-open is a convenience only.
  }
}

const defaultCwd = process.env.INIT_CWD ?? process.cwd();

function cwdFrom(program: Command): string {
  const opts = program.opts<GlobalOptions>();
  return resolve(opts.cwd ?? defaultCwd);
}

/**
 * Recursively collect repo-relative file paths under `dir`, capping at
 * `maxDepth` and `maxFiles`. Skips node_modules, .git, dist, build, and
 * .quorate directories entirely.
 */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".quorate"]);

function collectFilePaths(dir: string, root: string, depth: number, maxDepth: number, acc: string[]): void {
  if (depth > maxDepth || acc.length >= 5000) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (acc.length >= 5000) break;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = relative(root, full);
    if (entry.isDirectory()) {
      collectFilePaths(full, root, depth + 1, maxDepth, acc);
    } else if (entry.isFile()) {
      acc.push(rel);
    }
  }
}

/** Gather the signals `buildRiskReport` needs from the repo (stack, CI, keys). */
function gatherRiskInput(config: QuorateConfig, cwd: string): Parameters<typeof buildRiskReport>[0] {
  const files: string[] = [];
  collectFilePaths(cwd, cwd, 0, 6, files);
  let dependencies: string[] = [];
  const pkgPath = resolve(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      dependencies = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    } catch {
      // non-fatal
    }
  }
  const detectedPacks = detectPacks({ files, dependencies });

  // A workflow "references Quorate" if any .github/workflows/*.yml mentions it.
  let hasCiWorkflow = false;
  const workflowsDir = resolve(cwd, ".github", "workflows");
  if (existsSync(workflowsDir)) {
    try {
      for (const entry of readdirSync(workflowsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
        const text = readFileSync(resolve(workflowsDir, entry.name), "utf8").toLowerCase();
        if (text.includes("quorate")) {
          hasCiWorkflow = true;
          break;
        }
      }
    } catch {
      // non-fatal
    }
  }

  const missingProviderKeys = config.providers
    .filter((p) => p.enabled !== false && p.type === "api" && p.apiKeyEnv)
    .map((p) => p.apiKeyEnv as string)
    .filter((envVar) => !process.env[envVar]);

  return { config, detectedPacks, hasCiWorkflow, missingProviderKeys: [...new Set(missingProviderKeys)] };
}

/** Render the risk report with a colored status glyph per item. */
function printRiskReport(items: RiskItem[]): void {
  const glyph: Record<RiskItem["level"], string> = {
    ok: paint(PALETTE.ok, "✓"),
    warn: paint(PALETTE.warn, "!"),
    risk: paint(PALETTE.fail, "✗")
  };
  console.log("Quorate risk report\n");
  for (const item of items) {
    console.log(`${glyph[item.level]} ${paint(PALETTE.dim, item.label)} — ${item.detail}`);
  }
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
  const cwd = cwdFrom(program);
  return applyWorkspaceCustomPacks(loadConfig(configPathFrom(program, cwd), cwd), cwd);
}

function configPathFrom(program: Command, cwd: string): string | undefined {
  const opts = program.opts<GlobalOptions>();
  if (opts.config) {
    const explicitPath = resolve(cwd, opts.config);
    if (!existsSync(explicitPath)) {
      throw new Error(`Config file not found: ${opts.config}`);
    }
    return explicitPath;
  }
  return findConfigPath(cwd);
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
    const available =
      provider.type === "mock"
        ? true
        : provider.type === "api"
          ? Boolean(provider.model)
          : detectedProvider?.available ?? false;
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

export type ProviderPresetRow = ProviderConfig & { local: boolean };

export function providerPresetRows(): ProviderPresetRow[] {
  return PROVIDER_PRESET_NAMES.map((id) => {
    const preset = PROVIDER_PRESETS[id];
    const baseUrl = preset.baseUrl ?? "";
    return {
      id,
      ...preset,
      local: isLocalBaseUrl(baseUrl)
    };
  });
}

interface PackCatalogRow {
  id: string;
  description: string;
  councils: string[];
  classes: number;
  source: "built-in" | "custom";
}

function packCatalogRows(cwd: string): PackCatalogRow[] {
  const builtIn = Object.entries(PACKS).map(([id, pack]) => ({
    id,
    description: pack.description,
    councils: pack.councils,
    classes: PACK_COVERAGE[id]?.length ?? 0,
    source: "built-in" as const
  }));
  const custom = loadWorkspaceCustomPacks(cwd).map((definition) => ({
    id: definition.pack.id,
    description: definition.pack.description,
    councils: definition.pack.councils,
    classes: definition.heuristics.length,
    source: "custom" as const
  }));
  return [...builtIn, ...custom];
}

function printPackCatalog(rows: PackCatalogRow[]): void {
  const total = rows.reduce((sum, entry) => sum + entry.classes, 0);
  const width = Math.max(...rows.map((entry) => entry.id.length));
  console.log(paint(PALETTE.dim, `${rows.length} domain packs · ${total} heuristic classes · zero-config with \`quorate init --auto\``));
  console.log("");
  for (const entry of rows) {
    console.log(
      `  ${paint(PALETTE.accent, entry.id.padEnd(width))}  ${entry.description}  ${paint(PALETTE.dim, `(${entry.classes} classes, ${entry.source})`)}`
    );
    console.log(`  ${" ".repeat(width)}  ${paint(PALETTE.dim, "councils:")} ${entry.councils.join(", ")}`);
  }
  console.log("");
  console.log(paint(PALETTE.dim, "Scaffold one: ") + "quorate init --pack <id[,id]>  " + paint(PALETTE.dim, "·  Auto-detect: ") + "quorate init --auto");
}

export interface NormalizeAddedProviderRolesResult {
  provider: ProviderConfig;
  droppedPresetRoles: string[];
}

export function normalizeAddedProviderRoles(
  provider: ProviderConfig,
  config: QuorateConfig,
  rolesWereProvided: boolean
): NormalizeAddedProviderRolesResult {
  const roles = provider.roles ?? [];
  if (roles.length === 0) {
    return { provider, droppedPresetRoles: [] };
  }

  const knownRoles = new Set(config.councils);
  const unknownRoles: string[] = [];
  const keptRoles: string[] = [];
  for (const role of roles) {
    if (knownRoles.has(role)) keptRoles.push(role);
    else unknownRoles.push(role);
  }
  if (unknownRoles.length === 0) {
    return { provider, droppedPresetRoles: [] };
  }

  const availableRoles = config.councils.length > 0 ? config.councils.join(", ") : "(none)";
  if (rolesWereProvided) {
    throw new Error(
      `Unknown role${unknownRoles.length === 1 ? "" : "s"}: ${unknownRoles.join(", ")}. Roles: ${availableRoles}.`
    );
  }

  const normalized = { ...provider };
  if (keptRoles.length > 0) {
    normalized.roles = keptRoles;
  } else {
    throw new Error(
      `Preset roles not in this config: ${unknownRoles.join(", ")}. Choose roles with --roles. Roles: ${availableRoles}.`
    );
  }

  return { provider: normalized, droppedPresetRoles: unknownRoles };
}

/** Models for a preset name or a configured provider id (key read from apiKeyEnv). */
async function modelsFor(
  name: string,
  config: QuorateConfig | undefined
): Promise<{ models: string[]; baseUrl?: string; current?: string }> {
  const configured = config?.providers.find((p) => p.id === name && p.type === "api");
  const preset = PROVIDER_PRESETS[name];
  const source = configured ?? preset;
  if (!source) return { models: [] };
  const apiKey = source.apiKeyEnv ? process.env[source.apiKeyEnv] : undefined;
  const models = await fetchProviderModels(source.baseUrl, apiKey);
  return { models, baseUrl: source.baseUrl, current: configured?.model ?? preset?.model };
}

/** Numbered TTY picker: returns the chosen model, free-typed text, or undefined. */
async function pickModelInteractive(models: string[], current?: string): Promise<string | undefined> {
  const { createInterface } = await import("node:readline/promises");
  const shown = models.slice(0, 40);
  for (const [i, model] of shown.entries()) {
    const marker = model === current ? paint(PALETTE.accent, " (current)") : "";
    console.log(`  ${String(i + 1).padStart(3)}. ${model}${marker}`);
  }
  if (models.length > shown.length) console.log(`  … and ${models.length - shown.length} more (type a name)`);
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`Model [1-${shown.length}, name, or Enter for ${current ?? "default"}]: `)).trim();
    if (!answer) return current;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= shown.length) return shown[n - 1];
    return answer;
  } finally {
    rl.close();
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
    "  $ quorate supply-chain scan --base main --head HEAD --gate",
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
    .option(
      "--pack <ids>",
      "Scaffold one or more domain packs (comma-separated): " + PACK_IDS.join(", ")
    )
    .option("--auto", "Detect the repo's stack and scaffold the matching packs")
    .action((options) => {
      const cwd = cwdFrom(program);
      const configPath = resolve(cwd, ".quorate.yml");
      if (existsSync(configPath) && !options.force) {
        throw new Error(`${configPath} already exists. Use --force to overwrite it.`);
      }

      if (options.pack && options.auto) {
        throw new Error("Use either --pack or --auto, not both.");
      }

      let config: QuorateConfig;

      if (options.pack) {
        // CSV pack list
        const ids = (options.pack as string)
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);

        const packsArray = ids.map((id: string) => {
          const pack = PACKS[id];
          if (!pack) {
            throw new Error(`Unknown pack "${id}". Available: ${PACK_IDS.join(", ")}.`);
          }
          return pack;
        });

        config = buildMultiPackConfig(packsArray, detectAvailableProviders());
        writeFileSync(configPath, serializeConfig(config), "utf8");
        const totalCouncils = config.councils.length;
        console.log(
          `Created ${configPath} with the ${ids.join(",")} pack(s) (${totalCouncils} councils).`
        );
      } else if (options.auto) {
        // Gather repo signals
        const files: string[] = [];
        collectFilePaths(cwd, cwd, 0, 6, files);

        let dependencies: string[] = [];
        const pkgPath = resolve(cwd, "package.json");
        if (existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
              dependencies?: Record<string, string>;
              devDependencies?: Record<string, string>;
            };
            dependencies = [
              ...Object.keys(pkg.dependencies ?? {}),
              ...Object.keys(pkg.devDependencies ?? {})
            ];
          } catch {
            // non-fatal
          }
        }

        const detectedIds = detectPacks({ files, dependencies });

        if (detectedIds.length === 0) {
          console.log("No known stack detected — falling back to a default config.");
          config = createDefaultConfig(detectAvailableProviders());
          writeFileSync(configPath, serializeConfig(config), "utf8");
          console.log(`Created ${configPath}`);
        } else {
          const packsArray = detectedIds.map((id) => PACKS[id]);
          config = buildMultiPackConfig(packsArray, detectAvailableProviders());
          writeFileSync(configPath, serializeConfig(config), "utf8");
          console.log(
            `Detected: ${detectedIds.join(", ")}. Created ${configPath} with ${config.councils.length} councils.`
          );
        }
      } else {
        config = createDefaultConfig(detectAvailableProviders());
        writeFileSync(configPath, serializeConfig(config), "utf8");
        console.log(`Created ${configPath}`);
      }

      // Session/report artifacts (diffs, transcripts, findings) are written under
      // .quorate/ — keep them out of version control.
      ensureGitignored(cwd, ".quorate/");
    });

  program
    .command("packs")
    .helpGroup("Setup:")
    .description("List available domain packs (councils, heuristics, per-role guidance).")
    .option("--json", "Print the pack catalog as JSON")
    .action((options: { json?: boolean }) => {
      const cwd = cwdFrom(program);
      const allEntries = packCatalogRows(cwd);
      if (options.json) {
        console.log(JSON.stringify(allEntries, null, 2));
        return;
      }
      printPackCatalog(allEntries);
    });

  const packCmd = program
    .command("pack")
    .helpGroup("Setup:")
    .description("Manage custom review packs in .quorate/packs/.");

  packCmd
    .command("list")
    .description("List built-in and workspace custom packs.")
    .option("--json", "Print machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const rows = packCatalogRows(cwdFrom(program));
      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      printPackCatalog(rows);
    });

  packCmd
    .command("scaffold <id>")
    .description("Create .quorate/packs/<id>.yml with a custom pack template.")
    .option("--force", "Overwrite an existing custom pack file")
    .action((id: string, options: { force?: boolean }) => {
      const cwd = cwdFrom(program);
      const target = writeCustomPackScaffold(cwd, id, Boolean(options.force));
      console.log(`Wrote ${relative(cwd, target)}.`);
      console.log("Commit it with: git add -f .quorate/packs");
    });

  program
    .command("doctor")
    .helpGroup("Setup:")
    .description("Check council readiness: environment, provider availability, and the next step.")
    .option("--json", "Print machine-readable JSON")
    .option("--risk", "Summarize the repo's review posture (providers, keys, CI, gate, stack)")
    .option("--bundle", "Zip diagnostics to stdout (redacted config, provider grid, last report)")
    .option("--bundle-file <path>", "Write diagnostic zip to a file")
    .action((options) => {
      const cwd = cwdFrom(program);
      const config = configFrom(program);
      const detected = detectAvailableProviders();

      if (options.risk) {
        const report = buildRiskReport(gatherRiskInput(config, cwd));
        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }
        printRiskReport(report.items);
        if (report.items.some((item) => item.level === "risk")) process.exitCode = 1;
        return;
      }

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

  const solanaCmd = program
    .command("solana")
    .helpGroup("Setup:")
    .description("Inspect Solana / Anchor release readiness and generate test plans.");

  solanaCmd
    .command("doctor")
    .description("Run an offline Solana release gate over Anchor.toml, Cargo.toml, IDL, and Quorate config.")
    .option("--json", "Print machine-readable JSON")
    .option("--strict", "Exit non-zero on warnings as well as failures")
    .action(async (options: { json?: boolean; strict?: boolean }) => {
      const cwd = cwdFrom(program);
      const configPath = configPathFrom(program, cwd);
      const report = await buildSolanaReleaseGate({
        cwd,
        config: loadConfig(configPath, cwd),
        configPath
      });

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatSolanaReleaseGate(report));
      }

      if (report.summary.gate === "fail" || (options.strict && report.summary.gate === "warn")) {
        process.exitCode = 1;
      }
    });

  solanaCmd
    .command("test-plan")
    .description("Generate a Solana release test plan from the offline doctor signals.")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const cwd = cwdFrom(program);
      const configPath = configPathFrom(program, cwd);
      const report = await buildSolanaReleaseGate({
        cwd,
        config: loadConfig(configPath, cwd),
        configPath
      });
      const plan = buildSolanaTestPlan(report);

      if (options.json) {
        console.log(JSON.stringify(plan, null, 2));
      } else {
        console.log(formatSolanaTestPlan(plan));
      }
    });

  const supplyChainCmd = program
    .command("supply-chain")
    .alias("supplychain")
    .helpGroup("Review:")
    .description("Run deterministic supply-chain checks over a full diff, including lockfiles.");

  supplyChainCmd
    .command("scan")
    .description("Scan a diff for dependency, workflow, container, and publish-provenance risks.")
    .option("--diff <path>", "Read a unified diff from a file")
    .option("--base <ref>", "Base ref for git diff")
    .option("--head <ref>", "Head ref for git diff")
    .option("--pr <number>", "Read a pull request diff with gh pr diff")
    .option("--subject <text>", "Review subject", "SupplyChainGate scan")
    .option("--json", "Print the CouncilReport JSON")
    .option("--write-json <path>", "Write the JSON report to a file")
    .option("--write-md <path>", "Write the Markdown report to a file")
    .option("--gate", "Exit non-zero when the resolved policy fails")
    .option("--fail-on <severity>", "Override the gate threshold (critical…info, or never)")
    .action((options: {
      diff?: string;
      base?: string;
      head?: string;
      pr?: string;
      subject: string;
      json?: boolean;
      writeJson?: string;
      writeMd?: string;
      gate?: boolean;
      failOn?: string;
    }) => {
      const cwd = cwdFrom(program);
      const config = configFrom(program);
      runSupplyChainScan(options, { cwd, config });
    });

  const setupCmd = program
    .command("setup")
    .helpGroup("Setup:")
    .description("Generate starter files for a target (github-action, vscode) or show next steps.");

  setupCmd
    .command("github-action")
    .description("Write a starter .github/workflows/quorate.yml.")
    .option("-f, --force", "Overwrite an existing workflow file")
    .action((options) => {
      const cwd = cwdFrom(program);
      const target = resolve(cwd, ".github", "workflows", "quorate.yml");
      if (existsSync(target) && !options.force) {
        console.error(`${relative(cwd, target)} already exists. Use --force to overwrite it.`);
        process.exitCode = 1;
        return;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, generateGithubActionWorkflow(), "utf8");
      console.log(`Wrote ${relative(cwd, target)}.`);
      console.log("Next steps:");
      console.log("  1. Commit the workflow — the heuristic reviews every PR with zero setup.");
      console.log("  2. For real model review, add a `type: api` provider to .quorate.yml");
      console.log("     (`quorate provider add`) and pass its key secret via the step's env.");
    });

  setupCmd
    .command("vscode")
    .description("Recommend the Quorate VS Code extension in .vscode/extensions.json.")
    .action(() => {
      const cwd = cwdFrom(program);
      const target = resolve(cwd, ".vscode", "extensions.json");
      const existing = existsSync(target) ? readFileSync(target, "utf8") : undefined;
      const merged = mergeVscodeRecommendations(existing);
      if (merged === null) {
        console.error(
          `Could not parse ${relative(cwd, target)} (it may use JSONC comments). Add "umutkorkmaz.quorate-vscode" to its recommendations manually.`
        );
        process.exitCode = 1;
        return;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, merged, "utf8");
      console.log(`Updated ${relative(cwd, target)} to recommend the Quorate extension.`);
      console.log("Reload VS Code and accept the workspace recommendation to install it.");
    });

  setupCmd
    .command("provider")
    .description("How to add a model provider (delegates to `quorate provider add`).")
    .action(() => {
      console.log("Add a provider with a preset, then export its key:");
      console.log("  quorate provider add openrouter --preset openrouter");
      console.log("  export OPENROUTER_API_KEY=…");
      console.log("Run `quorate provider presets` to see all 16 presets, or `quorate provider add --help`.");
    });

  setupCmd
    .command("plan-gate")
    .description("Write a reusable PlanCourt prompt template under .quorate/commands/.")
    .option("--force", "Overwrite an existing template")
    .action((options: { force?: boolean }) => {
      const cwd = cwdFrom(program);
      const target = resolve(cwd, ".quorate", "commands", "plan-gate.md");
      if (existsSync(target) && !options.force) {
        console.error(`${relative(cwd, target)} already exists. Use --force to overwrite it.`);
        process.exitCode = 1;
        return;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(
        target,
        [
          "---",
          "description: Gate an implementation plan before code changes",
          "argument-hint: [plan or RFC text]",
          "mode: plan",
          "---",
          "Evaluate this implementation plan before any code is written.",
          "",
          "Focus on architecture risk, security impact, test strategy, rollout safety, and hidden maintenance cost.",
          "",
          "{{args}}",
          ""
        ].join("\n"),
        "utf8"
      );
      console.log(`Wrote ${relative(cwd, target)}.`);
      console.log("Use it in the TUI with QUORATE_TRUST_WORKSPACE=1 quorate, or run: quorate plan --gate \"<plan>\".");
    });

  setupCmd
    .command("github-app")
    .description("How to install the hosted Quorate GitHub App.")
    .action(() => {
      console.log("The Quorate GitHub App reviews PRs org-wide with no per-repo workflow.");
      console.log("Install it from the repository's Settings → GitHub Apps, or self-host");
      console.log("`@quorate/github-app` (see packages/github-app/README.md).");
      console.log("For a single repo without the App, use `quorate setup github-action` instead.");
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
    .command("roles")
    .helpGroup("Setup:")
    .description("List configured council roles.")
    .option("--json", "Print machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const roles = configFrom(program).councils ?? [];
      if (options.json) {
        console.log(JSON.stringify(roles, null, 2));
        return;
      }
      for (const role of roles) console.log(role);
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
    .option("--no-pick", "Skip the interactive model picker (use the preset/--model as-is)")
    .action(async (id: string, options) => {
      const cwd = cwdFrom(program);
      let provider = buildProvider(id, options);
      // Interactive model selection: api provider, no explicit --model, on a TTY.
      if (provider.type === "api" && !options.model && options.pick !== false && stdin.isTTY && stdout.isTTY) {
        const apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
        const models = await fetchProviderModels(provider.baseUrl, apiKey);
        if (models.length > 0) {
          console.log(`${models.length} models at ${provider.baseUrl ?? "the default endpoint"}:`);
          const chosen = await pickModelInteractive(models, provider.model);
          if (chosen) provider = { ...provider, model: chosen };
        } else if (provider.apiKeyEnv && !apiKey) {
          console.log(`(Set ${provider.apiKeyEnv} to list models; keeping the preset default "${provider.model}".)`);
        }
      }
      const configPath = findConfigPath(cwd) ?? resolve(cwd, ".quorate.yml");
      const storedConfig = existsSync(configPath)
        ? loadConfig(configPath, cwd)
        : createDefaultConfig(detectAvailableProviders());
      const configForRoles = applyWorkspaceCustomPacks(storedConfig, cwd);
      const normalized = normalizeAddedProviderRoles(provider, configForRoles, typeof options.roles === "string");
      provider = normalized.provider;
      const index = storedConfig.providers.findIndex((entry) => entry.id === id);
      if (index >= 0 && !options.force) {
        throw new Error(`Provider "${id}" already exists in ${configPath}. Use --force to replace it.`);
      }
      const providers =
        index >= 0
          ? storedConfig.providers.map((entry, i) => (i === index ? provider : entry))
          : [...storedConfig.providers, provider];
      writeFileSync(configPath, serializeConfig({ ...storedConfig, providers }), "utf8");
      ensureGitignored(cwd, ".quorate/");

      const detail = provider.type === "api" ? `api · ${provider.model}` : `cli · ${provider.command}`;
      console.log(`${index >= 0 ? "Replaced" : "Added"} provider "${id}" (${detail}) in ${configPath}`);
      if (normalized.droppedPresetRoles.length > 0) {
        console.log(`Skipped preset roles not in this config: ${normalized.droppedPresetRoles.join(", ")}.`);
      }
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
    .command("classify-url <baseUrl>")
    .description("Classify an OpenAI-compatible API base URL as local or hosted.")
    .option("--json", "Print machine-readable JSON")
    .action((baseUrl: string, options: { json?: boolean }) => {
      const row = { baseUrl, local: isLocalBaseUrl(baseUrl) };
      if (options.json) {
        console.log(JSON.stringify(row, null, 2));
        return;
      }
      console.log(row.local ? "local" : "hosted");
    });

  providerCmd
    .command("presets")
    .description("List the built-in API provider presets.")
    .option("--json", "Print machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const rows = providerPresetRows();
      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      for (const preset of rows) {
        const name = preset.id;
        console.log(`  ${name.padEnd(11)} ${preset.baseUrl}  ${preset.model}`);
      }
      console.log("\nAdd one with: quorate provider add <id> --preset <name> [--model <model>]");
    });

  providerCmd
    .command("models <name>")
    .description("List live models for a configured api provider or a preset (GET {baseUrl}/models).")
    .option("--json", "Print the model list as JSON")
    .action(async (name: string, options: { json?: boolean }) => {
      const cwd = cwdFrom(program);
      const configPath = findConfigPath(cwd);
      const config = configPath ? loadConfig(configPath, cwd) : undefined;
      const { models, baseUrl, current } = await modelsFor(name, config);
      if (options.json) {
        console.log(JSON.stringify(models));
        return;
      }
      if (!baseUrl && models.length === 0) {
        throw new Error(`"${name}" is not a configured api provider or a preset (${PROVIDER_PRESET_NAMES.join(", ")}).`);
      }
      if (models.length === 0) {
        const keyEnv = config?.providers.find((p) => p.id === name)?.apiKeyEnv ?? PROVIDER_PRESETS[name]?.apiKeyEnv;
        const hint = keyEnv && !process.env[keyEnv] ? ` (set ${keyEnv} to authenticate)` : "";
        console.log(`No models returned from ${baseUrl}/models${hint}.`);
        return;
      }
      for (const model of models) {
        console.log(model === current ? `* ${model}` : `  ${model}`);
      }
      console.log(`\n${models.length} models at ${baseUrl} · switch with: quorate provider set-model <id> [model]`);
    });

  providerCmd
    .command("test <id>")
    .description("Check provider readiness (CLI executable or API /models connectivity).")
    .option("--json", "Print machine-readable JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const config = configFrom(program);
      const provider = config.providers.find((entry) => entry.id === id);
      if (!provider) throw new Error(`No provider "${id}" in the active config.`);
      const result = await testProvider(provider);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatProviderTestResult(result));
      }
      if (result.status === "error") process.exitCode = 1;
    });

  providerCmd
    .command("set-roles <id> <roles>")
    .description("Replace a provider's council roles (comma-separated, e.g. security,qa).")
    .action((id: string, rolesArg: string) => {
      const cwd = cwdFrom(program);
      const configPath = findConfigPath(cwd);
      if (!configPath) throw new Error("No .quorate.yml found. Run `quorate init` first.");
      const config = loadConfig(configPath, cwd);
      const existing = config.providers.find((entry) => entry.id === id);
      if (!existing) throw new Error(`No provider "${id}" in ${configPath}.`);
      const roles = rolesArg.split(",").map((role) => role.trim()).filter(Boolean);
      const known = new Set(config.councils ?? ["architect", "security", "qa", "performance", "maintainer"]);
      const unknown = roles.filter((role) => !known.has(role));
      if (unknown.length > 0) {
        throw new Error(`Unknown role${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Roles: ${[...known].join(", ")}.`);
      }
      const providers = config.providers.map((entry) => (entry.id === id ? { ...entry, roles } : entry));
      writeFileSync(configPath, serializeConfig({ ...config, providers }), "utf8");
      console.log(`Provider "${id}" roles: ${existing.roles?.join(", ") ?? "(default)"} → ${roles.join(", ") || "(none)"}`);
    });

  providerCmd
    .command("set-model <id> [model]")
    .description("Change an api provider's model — pick from the live list when no model is given.")
    .action(async (id: string, model: string | undefined) => {
      const cwd = cwdFrom(program);
      const configPath = findConfigPath(cwd);
      if (!configPath) throw new Error("No .quorate.yml found. Run `quorate init` first.");
      const config = loadConfig(configPath, cwd);
      const existing = config.providers.find((entry) => entry.id === id);
      if (!existing) throw new Error(`No provider "${id}" in ${configPath}.`);
      if (existing.type !== "api") throw new Error(`Provider "${id}" is type "${existing.type}" — set-model applies to api providers.`);

      let next = model;
      if (!next) {
        if (!stdin.isTTY || !stdout.isTTY) throw new Error("Pass a model name when not running interactively.");
        const { models } = await modelsFor(id, config);
        if (models.length === 0) {
          const hint = existing.apiKeyEnv && !process.env[existing.apiKeyEnv] ? ` Set ${existing.apiKeyEnv} to list models.` : "";
          throw new Error(`No models returned from ${existing.baseUrl}/models.${hint}`);
        }
        console.log(`${models.length} models at ${existing.baseUrl}:`);
        next = await pickModelInteractive(models, existing.model);
      }
      if (!next || next === existing.model) {
        console.log(`Model unchanged (${existing.model}).`);
        return;
      }
      const providers = config.providers.map((entry) => (entry.id === id ? { ...entry, model: next } : entry));
      writeFileSync(configPath, serializeConfig({ ...config, providers }), "utf8");
      console.log(`Provider "${id}" model: ${existing.model} → ${next}`);
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
    .option("--merge <id>", "Master agent that merges duplicate findings across reviewers")
    .option("--json", "Stream NDJSON events to stdout (final line is the report JSON)")
    .option("--write-json <path>", "Write the JSON report to a file")
    .option("--write-sarif <path>", "Write a SARIF 2.1.0 report (GitHub Code Scanning, GitLab)")
    .option("--write-junit <path>", "Write a JUnit XML report (CI test dashboards)")
    .option("--write-html <path>", "Write a standalone HTML report")
    .option("--write-md <path>", "Write the Markdown report to a file")
    .option("--write-reviewgraph <path>", "Write ReviewGraph agreement evidence as JSON")
    .option("--reviewgraph", "Include ReviewGraph agreement evidence in Markdown output")
    .option("--no-pr-context", "Do not include PR title/body/commits when --pr is used")
    .option("--baseline", "Gate only on findings absent from the committed baseline")
    .option("--baseline-path <path>", "Baseline file to gate against (default .quorate.baseline.json)")
    .option("--suppress-path <path>", "Suppression store to apply (default .quorate/suppressions.json)")
    .option("--fail-on <severity>", "Override the gate threshold (critical…info, or never)")
    .action(async (options) => {
      const cwd = cwdFrom(program);
      let config = applyProviderFilter(configFrom(program), options.providers);
      if (options.merge) config = { ...config, merge: { provider: options.merge } };
      let diff = readDiff(options, cwd);
      if (isEmptyReviewDiff("review", diff)) {
        console.error("No changes to review. Pass --diff <file>, --base/--head, or --pr <number>.");
        process.exitCode = 1;
        return;
      }
      const prContext =
        options.pr && options.prContext !== false
          ? buildPullRequestContext(readPullRequestContext(options.pr, cwd) ?? { number: Number(options.pr) })
          : undefined;
      const request: CouncilRequest = {
        mode: "review" as const,
        subject: options.subject,
        diff,
        fullDiff: diff,
        repoPath: cwd,
        repositoryFiles: readRepositoryFiles(cwd),
        context: prContext,
        pullRequest: options.pr ? { number: Number(options.pr) } : undefined
      };
      const budget = analyzeReviewBudget({
        diff,
        config,
        request: {
          mode: request.mode,
          subject: request.subject,
          repoPath: request.repoPath,
          pullRequest: request.pullRequest,
          context: request.context
        }
      });
      diff = budget.diff;
      request.diff = diff;
      request.budget = budget.summary;
      if (isEmptyReviewDiff("review", diff)) {
        console.error("No reviewable changes remain after budget/generated-file filtering.");
        process.exitCode = 1;
        return;
      }
      if (!budget.ok) {
        console.error(formatBudgetSummary(budget.summary));
        process.exitCode = 1;
        return;
      }

      // When --baseline is set, suppress findings already in the committed
      // baseline and recompute the verdict on what remains. The notes (missing
      // baseline, staleness, suppressed count) go to stderr so stdout stays
      // clean for --json consumers. We capture the raw (pre-baseline) report so
      // last-report.json — the source for a later `quorate baseline` and for
      // `quorate fix` — always holds the full finding set.
      let rawReport: CouncilReport | undefined;
      const transformReport = (raw: CouncilReport): CouncilReport => {
        rawReport = raw;
        // Baseline first (removes accepted findings entirely), then suppression
        // (tags the remainder as accepted-but-visible). Suppression is always-on
        // when a committed .quorate/suppressions.json exists — its presence IS
        // the opt-in. Both notes go to stderr so stdout stays clean for --json.
        let current = raw;
        if (options.baseline) {
          const applied = applyBaselineToReport(current, cwd, options.baselinePath);
          for (const note of applied.notes) console.error(note);
          current = applied.report;
        }
        const suppressed = applySuppressionStore(current, cwd, options.suppressPath);
        for (const note of suppressed.notes) console.error(note);
        return suppressed.report;
      };

      // Every run also feeds the live spool (~/.quorate/live) so `quorate
      // monitor` surfaces can watch it from other terminals.
      const liveSpool = createLiveSpoolSink({ cwd });
      let report: CouncilReport;
      try {
        report = options.json
          ? await runCouncilWithJsonStream(
              request,
              config,
              teeJsonStreamSink(
                {
                  writeStdout: (line) => process.stdout.write(`${line}\n`),
                  writeStderr: (line) => console.error(line)
                },
                liveSpool
              ),
              transformReport
            )
          : transformReport(await runCouncil(request, config, { onEvent: (event) => liveSpool.handleEvent(event) }));
      } catch (error: unknown) {
        liveSpool.finish("error");
        throw error;
      }
      liveSpool.finish("done");

      if (options.writeJson) {
        writeFileSync(resolve(cwd, options.writeJson), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      }
      // Multi-format exporters for CI ecosystems (Code Scanning, test dashboards).
      const writeExport = (path: string | undefined, content: string): void => {
        if (!path) return;
        const target = resolve(cwd, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, "utf8");
      };
      writeExport(options.writeSarif, renderSarif(report, { toolVersion: readVersion() }));
      writeExport(options.writeJunit, renderJunit(report));
      writeExport(options.writeHtml, renderHtml(report));
      writeExport(options.writeMd, renderMarkdownReport(report, { includeReviewGraph: Boolean(options.reviewgraph) }));
      writeExport(options.writeReviewgraph, renderReviewGraph(report));

      // Persist the RAW report for `quorate fix` and `quorate baseline` (same
      // file the TUI writes) — never the baseline-filtered view, or a follow-up
      // `quorate baseline` would record a shrunken set.
      mkdirSync(resolve(cwd, ".quorate"), { recursive: true });
      writeFileSync(
        resolve(cwd, ".quorate", "last-report.json"),
        `${JSON.stringify(rawReport ?? report, null, 2)}\n`,
        "utf8"
      );
      // Append to the per-repo history store (best-effort, never throws). The
      // gated report is what the team saw and the gate acted on; suppressed
      // findings are excluded from the counts by toHistoryEntry.
      appendHistory(cwd, report);

      if (!options.json) {
        console.log(renderMarkdownReport(report, { includeReviewGraph: Boolean(options.reviewgraph) }));
      }

      // Gate on the resolved policy: a standalone .quorate/policy.yml wins,
      // else the legacy github config; --fail-on overrides the threshold.
      const policy = resolvePolicy(config, {
        policy: loadPolicyFile(cwd) ?? undefined,
        failOn: options.failOn as Severity | "never" | undefined
      });
      if (shouldFailForPolicy(report, policy)) {
        process.exitCode = 1;
      }
    });

  program
    .command("baseline")
    .helpGroup("Review:")
    .description("Record current findings as an accepted baseline so `review --baseline` gates only new ones.")
    .option("--update", "Overwrite an existing baseline")
    .option("--expires-days <n>", "Advisory expiry; warn once the baseline is older than this")
    .option("--report <path>", "Source report to baseline from (default .quorate/last-report.json)")
    .option("--path <path>", "Baseline output path (default .quorate.baseline.json)")
    .action((options) => {
      const cwd = cwdFrom(program);
      const expiresDays = options.expiresDays !== undefined ? Number(options.expiresDays) : undefined;
      if (expiresDays !== undefined && (!Number.isInteger(expiresDays) || expiresDays <= 0)) {
        console.error("--expires-days must be a positive integer.");
        process.exitCode = 1;
        return;
      }
      try {
        const result = writeBaselineFromReport({
          cwd,
          reportPath: options.report,
          baselinePath: options.path,
          update: Boolean(options.update),
          expiresDays
        });
        const verb = result.overwritten ? "Updated" : "Wrote";
        console.log(`${verb} baseline with ${result.count} finding(s) at ${relative(cwd, result.path)}.`);
        console.log("Commit this file so teammates and CI share the same accepted-issue set.");
      } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  const suppressCmd = program
    .command("suppress")
    .helpGroup("Review:")
    .description("Manage accepted-risk suppressions (.quorate/suppressions.json).");

  suppressCmd
    .command("add")
    .description("Accept a finding by fingerprint or number from the last report. Requires --reason.")
    .argument("[target]", "A finding fingerprint, or a 1-based finding number from --report")
    .option("--reason <text>", "Why this finding is accepted (required)")
    .option("--expires <yyyy-mm-dd>", "Date the suppression lapses (optional)")
    .option("--report <path>", "Source report for a finding number (default .quorate/last-report.json)")
    .option("--path <path>", "Suppression store path (default .quorate/suppressions.json)")
    .action((target: string | undefined, options) => {
      const cwd = cwdFrom(program);
      if (!target) {
        console.error("Pass a fingerprint or a finding number (from `quorate fix --list`).");
        process.exitCode = 1;
        return;
      }
      if (!options.reason || options.reason.trim().length === 0) {
        console.error("A --reason is required to suppress a finding.");
        process.exitCode = 1;
        return;
      }
      // A finding number (1-based) resolves to a fingerprint via the last report.
      let fingerprint = target;
      if (/^\d+$/.test(target)) {
        const last = loadLastReport(cwd, options.report);
        if (!last) {
          console.error("No report found to resolve the finding number. Run `quorate review` first.");
          process.exitCode = 1;
          return;
        }
        const n = Number(target);
        const found = last.findings[n - 1];
        if (!found) {
          console.error(`Finding number ${n} is out of range (the last report has ${last.findings.length}).`);
          process.exitCode = 1;
          return;
        }
        fingerprint = found.fingerprint ?? "";
        if (!fingerprint) {
          console.error("That finding has no fingerprint (stale report — re-run `quorate review`).");
          process.exitCode = 1;
          return;
        }
      }
      try {
        const result = writeSuppression(cwd, fingerprint, options.reason, {
          storePath: options.path,
          expires: options.expires,
          createdAt: new Date().toISOString()
        });
        console.log(`Suppressed ${fingerprint} at ${relative(cwd, result.path)}.`);
        console.log("The .quorate/ dir is gitignored — commit it with: git add -f .quorate/suppressions.json");
      } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  suppressCmd
    .command("list")
    .description("List committed suppressions and flag expired ones.")
    .option("--path <path>", "Suppression store path (default .quorate/suppressions.json)")
    .action((options) => {
      const cwd = cwdFrom(program);
      try {
        const store = loadSuppressionStore(cwd, options.path);
        if (!store || store.suppressions.length === 0) {
          console.log("No suppressions recorded.");
          return;
        }
        const now = Date.now();
        for (const entry of store.suppressions) {
          const expired = entry.expires !== undefined && Date.parse(entry.expires) <= now;
          const when = expired ? "(expired)" : entry.expires ? `→ expires ${entry.expires}` : "(no expiry)";
          console.log(`${entry.fingerprint}  ${when}\n  ${entry.reason}`);
        }
      } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  suppressCmd
    .command("remove")
    .description("Remove a suppression by fingerprint.")
    .argument("<fingerprint>", "The fingerprint to un-suppress")
    .option("--path <path>", "Suppression store path (default .quorate/suppressions.json)")
    .action((fingerprint: string, options) => {
      const cwd = cwdFrom(program);
      const removed = removeSuppressionFromStore(cwd, fingerprint, options.path);
      if (removed) {
        console.log(`Removed suppression for ${fingerprint}.`);
      } else {
        console.error(`No suppression for ${fingerprint}.`);
        process.exitCode = 1;
      }
    });

  suppressCmd
    .command("audit")
    .description("Report on suppressions: counts and expired entries (exit 1 if any are expired).")
    .option("--path <path>", "Suppression store path (default .quorate/suppressions.json)")
    .action((options) => {
      const cwd = cwdFrom(program);
      try {
        const store = loadSuppressionStore(cwd, options.path);
        if (!store) {
          console.log("No suppression store committed.");
          return;
        }
        const expired = listExpired(store);
        console.log(`${store.suppressions.length} suppression(s) committed${expired.length ? `, ${expired.length} expired` : ""}.`);
        for (const entry of expired) {
          console.log(`  ! ${entry.fingerprint} expired ${entry.expires} — ${entry.reason}`);
        }
        if (expired.length > 0) process.exitCode = 1;
      } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  program
    .command("history")
    .helpGroup("Review:")
    .description("Show recent reviews (newest-first). Stored at ~/.quorate/history/.")
    .option("--limit <n>", "Maximum number of entries to show", "20")
    .option("--json", "Print machine-readable JSON")
    .action(async (options) => {
      const cwd = cwdFrom(program);
      const limit = Number(options.limit);
      if (!Number.isInteger(limit) || limit < 0) {
        console.error("--limit must be a non-negative integer.");
        process.exitCode = 1;
        return;
      }
      const entries = await readHistory(cwd, { limit });
      if (options.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      console.log(formatHistoryTable(entries, limit));
    });

  program
    .command("stats")
    .helpGroup("Review:")
    .description("Aggregate review trends: verdicts, noisiest files, recurring findings, provider reliability.")
    .option("--since <iso-date>", "Only count reviews from this date onward")
    .option("--json", "Print machine-readable JSON")
    .action(async (options) => {
      const cwd = cwdFrom(program);
      if (options.since !== undefined && Number.isNaN(Date.parse(options.since))) {
        console.error("--since must be a valid ISO date.");
        process.exitCode = 1;
        return;
      }
      const entries = await readHistory(cwd);
      const stats = computeStats(entries, { since: options.since });
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      console.log(formatStatsReport(stats));
    });

  const policyCmd = program
    .command("policy")
    .helpGroup("Review:")
    .description("Manage the VerdictGate merge policy (.quorate/policy.yml).");

  policyCmd
    .command("init")
    .description("Write a starter .quorate/policy.yml.")
    .option("--path <path>", "Policy file path (default .quorate/policy.yml)")
    .option("--force", "Overwrite an existing policy file")
    .action((options) => {
      const cwd = cwdFrom(program);
      try {
        const result = writeStarterPolicy(cwd, { policyPath: options.path, force: Boolean(options.force) });
        console.log(`${result.overwritten ? "Updated" : "Wrote"} policy at ${relative(cwd, result.path)}.`);
        console.log("The .quorate/ dir is gitignored — commit it with: git add -f .quorate/policy.yml");
      } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  policyCmd
    .command("doctor")
    .description("Show the resolved merge policy and flag config gaps that would make it unsatisfiable.")
    .option("--path <path>", "Policy file path (default .quorate/policy.yml)")
    .action((options) => {
      const cwd = cwdFrom(program);
      const config = configFrom(program);
      try {
        const loaded = loadPolicyFile(cwd, options.path);
        const policy = resolvePolicy(config, { policy: loaded ?? undefined });
        const { warnings } = policyDoctor(config, policy);
        const source = loaded ? options.path ?? ".quorate/policy.yml" : "github config (derived)";
        console.log(`Resolved policy (source: ${source}):`);
        console.log(`  fail_on: ${policy.failOn}   fail_on_degraded: ${policy.failOnDegraded}`);
        console.log(`  block_on_verdict: [${policy.blockOnVerdict.join(", ")}]   allow_warn_merge: ${policy.allowWarnMerge}`);
        console.log(`  agreement gate: ${policy.gate ? `${policy.gate.severity}+ × ${policy.gate.minAgreement}` : "(none)"}`);
        console.log(`  roles_required: [${policy.rolesRequired.join(", ")}]   min_real_providers: ${policy.minRealProviders}`);
        if (warnings.length === 0) {
          console.log("\n✓ Policy is satisfiable by the current config.");
        } else {
          console.log("\nWarnings:");
          for (const warning of warnings) console.log(`  ! ${warning}`);
          process.exitCode = 1;
        }
      } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  policyCmd
    .command("explain")
    .description("Explain whether the last review would block merge under the current policy.")
    .option("--path <path>", "Policy file path (default .quorate/policy.yml)")
    .option("--report <path>", "Report to explain (default .quorate/last-report.json)")
    .action((options) => {
      const cwd = cwdFrom(program);
      const config = configFrom(program);
      const report = loadLastReport(cwd, options.report);
      if (!report) {
        console.error("No report found. Run `quorate review` first, or pass --report <path>.");
        process.exitCode = 1;
        return;
      }
      const policy = resolvePolicy(config, { policy: loadPolicyFile(cwd, options.path) ?? undefined });
      const result = explainPolicy(report, policy);
      console.log(`Verdict: ${report.verdict.toUpperCase()} → merge ${result.fail ? "BLOCKED" : "allowed"}.`);
      for (const reason of result.reasons) console.log(`  ${result.fail ? "✗" : "•"} ${reason}`);
      if (result.fail) process.exitCode = 1;
    });

  program
    .command("fix")
    .helpGroup("Review:")
    .description("Delegate a finding to a write-mode agent — snapshotted, watchable, revertible.")
    .option("--list", "List fixable findings from the last report (and past fixes)")
    .option("--finding <n>", "Finding number (1-based) from --list")
    .option("--provider <id>", `Write-mode agent: ${WRITE_AGENT_PROFILES.map((p) => p.id).join(", ")}`)
    .option("--report <path>", "Report JSON to fix from (default: .quorate/last-report.json)")
    .option("--revert [fixId]", "Undo a fix — the latest one when no id is given")
    .option("--force", "Override the tree-changed guard when reverting")
    .option("--no-review", "Skip the re-review offer after the fix")
    .action(async (options) => {
      const cwd = cwdFrom(program);

      if (options.revert !== undefined) {
        const fixId = typeof options.revert === "string" ? options.revert : undefined;
        const meta = revertFix(cwd, fixId, { force: options.force });
        console.log(`Reverted fix ${meta.fixId} (${meta.findingTitle}) — tracked files restored, agent-created files removed.`);
        return;
      }

      const reportPath = resolve(cwd, options.report ?? ".quorate/last-report.json");
      if (!existsSync(reportPath)) {
        throw new Error(`No report at ${reportPath}. Run \`quorate review\` first (or pass --report <path>).`);
      }
      const report = JSON.parse(readFileSync(reportPath, "utf8")) as CouncilReport;
      const findings = report.findings.filter((finding) => finding.file);
      if (findings.length === 0) {
        console.log("No fixable findings (none carry a file location).");
        return;
      }

      if (options.list || !options.finding) {
        console.log(`Fixable findings (${findings.length}):`);
        for (const [i, finding] of findings.entries()) {
          const loc = `${finding.file}${finding.line ? `:${finding.line}` : ""}`;
          console.log(`  ${String(i + 1).padStart(2)}. [${finding.severity}] ${loc} — ${finding.title}`);
        }
        const past = listFixes(cwd);
        if (past.length > 0) {
          console.log("\nPast fixes:");
          for (const meta of past) {
            console.log(`  ${meta.fixId}  ${meta.status.padEnd(15)} ${meta.agentId}  ${meta.findingTitle}`);
          }
        }
        if (options.list) return;
      }

      if (!stdin.isTTY || !stdout.isTTY) {
        throw new Error(
          "quorate fix needs a real interactive terminal — it hands the session to a coding agent " +
            "(claude, codex, …) to apply the change, so it can't run headlessly (CI, pipes, or a non-interactive tool). " +
            "Run it directly in your terminal. In VS Code, use the “Fix with agent” action (lightbulb, finding hover, " +
            "or the Quorate results tree) — it opens a terminal and runs this for you. " +
            "To only preview targets non-interactively, use `quorate fix --list`."
        );
      }
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        // 1. Pick the finding.
        let index = options.finding ? Number(options.finding) : NaN;
        if (!Number.isInteger(index) || index < 1 || index > findings.length) {
          const answer = (await rl.question(`Finding [1-${findings.length}]: `)).trim();
          index = Number(answer);
          if (!Number.isInteger(index) || index < 1 || index > findings.length) {
            throw new Error(`Pick a finding between 1 and ${findings.length}.`);
          }
        }
        const finding = findings[index - 1];

        // 2. Pick the agent (only ones actually on PATH).
        const detected = new Map(detectAvailableProviders().map((p) => [p.id, p.available]));
        const usable = WRITE_AGENT_PROFILES.filter((p) => detected.get(p.id));
        if (usable.length === 0) {
          throw new Error(`No write-mode agent found on PATH (looked for: ${WRITE_AGENT_PROFILES.map((p) => p.id).join(", ")}).`);
        }
        let profile = options.provider ? writeAgentProfile(options.provider) : undefined;
        if (options.provider && !profile) {
          throw new Error(`Unknown write-mode agent "${options.provider}". Available: ${usable.map((p) => p.id).join(", ")}.`);
        }
        if (!profile) {
          for (const [i, p] of usable.entries()) console.log(`  ${i + 1}. ${p.id} — ${p.label}`);
          const answer = (await rl.question(`Agent [1-${usable.length}]: `)).trim();
          profile = usable[Number(answer) - 1] ?? usable.find((p) => p.id === answer);
          if (!profile) throw new Error("No agent picked.");
        }

        // 3. Snapshot, build the prompt, confirm, hand the terminal over.
        const meta = createFixSnapshot(cwd, finding, profile.id);
        const treeDiff = (() => {
          try {
            return readDiff({}, cwd);
          } catch {
            return undefined;
          }
        })();
        const prompt = buildFixPrompt(finding, extractHunk(treeDiff, finding.file, finding.line));
        writeFileSync(resolve(cwd, ".quorate", "fix", meta.fixId, "prompt.md"), `${prompt}\n`, "utf8");

        console.log(`\nSnapshot ${meta.fixId} taken${meta.treeDirty ? ` (pre-fix state pinned: ${meta.stashSha?.slice(0, 7)})` : " (tree was clean)"}.`);
        console.log(`Delegating to ${profile.id}: [${finding.severity}] ${finding.file}${finding.line ? `:${finding.line}` : ""} — ${finding.title}`);
        const go = (await rl.question(`Hand the terminal to ${profile.id} now? [Y/n]: `)).trim().toLowerCase();
        if (go === "n" || go === "no") {
          console.log(`Skipped. Prompt saved at .quorate/fix/${meta.fixId}/prompt.md`);
          return;
        }
        rl.pause();
        const exitCode = runWriteAgent(profile, prompt, cwd);
        rl.resume();

        // 4. Record what changed + offer revert and re-review.
        const { changedStat, newUntracked } = finalizeFix(cwd, meta.fixId);
        console.log(`\n${profile.id} exited (${exitCode}).`);
        console.log(changedStat ? `Changes:\n${changedStat}` : "No tracked changes detected.");
        if (newUntracked.length) console.log(`New files: ${newUntracked.join(", ")}`);
        console.log(`Revert any time with: quorate fix --revert ${meta.fixId}`);

        if (options.review !== false) {
          const again = (await rl.question("Re-review the fix with the council? [y/N]: ")).trim().toLowerCase();
          if (again === "y" || again === "yes") {
            const { spawnSync } = await import("node:child_process");
            spawnSync(process.execPath, [realpathSync(process.argv[1]), "review"], { cwd, stdio: "inherit" });
          }
        }
      } finally {
        rl.close();
      }
    });

  program
    .command("plan")
    .helpGroup("Review:")
    .description("Ask the council to evaluate an implementation or architecture plan.")
    .argument("<prompt...>", "Plan prompt")
    .option("--providers <ids>", "Comma-separated provider ids to enable for this run")
    .option("--json", "Stream NDJSON events to stdout (final line is the report JSON)")
    .option("--write-json <path>", "Write the JSON plan report to a file")
    .option("--write-md <path>", "Write the Markdown plan report to a file")
    .option("--write-reviewgraph <path>", "Write ReviewGraph agreement evidence as JSON")
    .option("--reviewgraph", "Include ReviewGraph agreement evidence in Markdown output")
    .option("--gate", "Exit non-zero when the resolved VerdictGate policy blocks the plan")
    .option("--fail-on <severity>", "Override the gate threshold (critical…info, or never)")
    .action(async (promptParts: string[], options) => {
      const cwd = cwdFrom(program);
      const config = applyProviderFilter(configFrom(program), options.providers);
      const subject = promptParts.join(" ");
      const request = { mode: "plan" as const, subject, repoPath: cwd };

      // Plan runs feed the live spool too, so monitors see them alongside reviews.
      const liveSpool = createLiveSpoolSink({ cwd });
      let report: CouncilReport;
      try {
        report = options.json
          ? await runCouncilWithJsonStream(
              request,
              config,
              teeJsonStreamSink(
                {
                  writeStdout: (line) => process.stdout.write(`${line}\n`),
                  writeStderr: (line) => console.error(line)
                },
                liveSpool
              )
            )
          : await runCouncil(request, config, { onEvent: (event) => liveSpool.handleEvent(event) });
      } catch (error: unknown) {
        liveSpool.finish("error");
        throw error;
      }
      liveSpool.finish("done");

      const writeExport = (path: string | undefined, content: string): void => {
        if (!path) return;
        const target = resolve(cwd, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, "utf8");
      };
      writeExport(options.writeJson, `${JSON.stringify(report, null, 2)}\n`);
      writeExport(options.writeMd, renderMarkdownReport(report, { includeReviewGraph: Boolean(options.reviewgraph) }));
      writeExport(options.writeReviewgraph, renderReviewGraph(report));

      mkdirSync(resolve(cwd, ".quorate"), { recursive: true });
      writeFileSync(resolve(cwd, ".quorate", "last-plan-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

      if (!options.json) {
        console.log(renderMarkdownReport(report, { includeReviewGraph: Boolean(options.reviewgraph) }));
      }

      if (options.gate) {
        const policy = resolvePolicy(config, {
          policy: loadPolicyFile(cwd) ?? undefined,
          failOn: options.failOn as Severity | "never" | undefined
        });
        if (shouldFailForPolicy(report, policy)) process.exitCode = 1;
      }
    });

  const monitorCmd = program
    .command("monitor")
    .helpGroup("Interactive:")
    .description("Watch live council runs on this machine — agents, lanes, and per-lane output.")
    .option("--json", "Print the live run registry as JSON and exit (no TUI)")
    .option("--web", "Serve a browser dashboard on 127.0.0.1 instead of the TUI")
    .option("--serve", "Headless server: print one {url,token,pid} JSON line, serve until Ctrl+C (for monitor)")
    .option("--port <port>", "Fixed port for --web/--serve (default: random)")
    .option("--no-open", "With --web, do not auto-open the browser")
    .action(async (options) => {
      const cwd = cwdFrom(program);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(listLiveRuns(), null, 2)}\n`);
        return;
      }
      if (options.serve || options.web) {
        const handle = createMonitorServer();
        const port = options.port ? Number(options.port) : 0;
        if (!Number.isInteger(port) || port < 0 || port > 65_535) {
          throw new Error("--port must be an integer between 0 and 65535");
        }
        const url = await listenMonitorServer(handle, port);
        if (options.serve) {
          // Headless: one JSON line for the native app to parse, then block.
          process.stdout.write(`${JSON.stringify({ url, token: handle.token, pid: process.pid })}\n`);
        } else {
          console.error(`Quorate monitor: ${url}`);
          console.error("Loopback-only; the token in the URL is this session's key. Ctrl+C stops.");
          if (options.open !== false) openInBrowser(url);
        }
        await new Promise<void>((resolvePromise) => {
          // close() is idempotent, so overlapping SIGINT/SIGTERM are safe.
          const stop = (): void => {
            handle.close().catch(() => undefined).finally(() => resolvePromise());
          };
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);
        });
        return;
      }
      if (!stdin.isTTY || !stdout.isTTY) {
        throw new Error("quorate monitor needs a TTY (use --json, --web, or --serve for headless use).");
      }
      const config = configFrom(program);
      await launchMonitor({ cwd, config });
    });

  monitorCmd
    .command("setup")
    .description("Install Quorate hook-report entries in foreign AI CLIs (Claude Code, Codex) so monitor can observe them.")
    .option("--remove", "Strip Quorate hook entries (idempotent, marker-tagged)")
    .option("--dry-run", "Print the plan without writing anything")
    .option("--yes", "Skip the confirmation prompt")
    .action((options) => {
      const executable = (name: string): boolean => {
        try {
          const result = spawnSync("which", [name], { encoding: "utf8", shell: false });
          return result.status === 0 && result.stdout.trim().length > 0;
        } catch {
          return false;
        }
      };
      const capabilities = detectCliCapabilities({
        claude: executable("claude"),
        codex: executable("codex"),
        gemini: executable("gemini"),
        qwen: executable("qwen"),
        kimi: executable("kimi"),
        opencode: executable("opencode"),
        crush: executable("crush"),
        goose: executable("goose")
      });
      console.error(renderCapabilityTable(capabilities));
      console.error("");
      const plan = computeSetupPlan({
        claudePath: claudeSettingsPath(),
        codexPath: codexConfigPath(),
        codexNotifyOccupied: codexNotifySlotOccupied(),
        dryRun: Boolean(options.dryRun)
      });
      const verb = options.remove ? "remove" : "install";
      console.error(`Plan (${options.dryRun ? "dry-run" : verb}):`);
      console.error(`  Claude Code settings: ${plan.claude.path}`);
      console.error(`    ${plan.claude.exists ? "exists" : "will be created"}; ${plan.claude.changes} hook group(s) ${options.remove ? "to strip" : "to add"}.`);
      console.error(`  Codex notify: ${plan.codex.action} — ${plan.codex.note}`);
      if (options.dryRun) {
        console.error("No changes made (--dry-run).");
        return;
      }
      if (stdin.isTTY && !options.yes) {
        // Non-TTY and --yes both bypass the prompt; we don't block headless runs.
        console.error("Pass --yes to apply, or re-run with --dry-run to preview.");
        return;
      }
      const result = options.remove ? applyRemove(plan) : applySetup(plan);
      console.error(result.message);
      if (result.backup) console.error(`Backup: ${result.backup}`);
      if (!result.applied) process.exitCode = 1;
    });

  program
    .command("hook-report", { hidden: true })
    .description("Bridge hook for foreign AI CLIs (invoked by their hook events; not for direct use).")
    .requiredOption("--source <source>", "Foreign CLI source (claude, codex)")
    .requiredOption("--event <event>", "Hook event name")
    .action(async (options) => {
      await runHookReportCli({ source: options.source, event: options.event });
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
