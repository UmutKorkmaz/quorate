#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { Command } from "commander";
import {
  buildMultiPackConfig,
  createDefaultConfig,
  detectAvailableProviders,
  detectPacks,
  fetchProviderModels,
  findConfigPath,
  isEmptyReviewDiff,
  loadConfig,
  PACK_IDS,
  PACKS,
  PALETTE,
  PROVIDER_PRESETS,
  PROVIDER_PRESET_NAMES,
  renderMarkdownReport,
  runCouncil,
  serializeConfig,
  shouldFailForReport,
  type CouncilReport,
  type QuorateConfig
} from "@quorate/core";
import { buildProvider } from "./provider-add.js";
import { createFixSnapshot, finalizeFix, listFixes, revertFix } from "./fix.js";
import { buildFixPrompt, extractHunk } from "./fix-prompt.js";
import { runWriteAgent, WRITE_AGENT_PROFILES, writeAgentProfile } from "./fix-agent.js";
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
    .description("List available domain packs (councils + per-role guidance).")
    .action(() => {
      for (const [id, pack] of Object.entries(PACKS)) {
        console.log(`  ${id}  ${pack.description}`);
        console.log(`    councils: ${pack.councils.join(", ")}`);
      }
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
    .action(async (options) => {
      const cwd = cwdFrom(program);
      let config = applyProviderFilter(configFrom(program), options.providers);
      if (options.merge) config = { ...config, merge: { provider: options.merge } };
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
      // Persist for `quorate fix` (same file the TUI writes).
      mkdirSync(resolve(cwd, ".quorate"), { recursive: true });
      writeFileSync(resolve(cwd, ".quorate", "last-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

      if (!options.json) {
        console.log(renderMarkdownReport(report));
      }

      if (shouldFailForReport(report, config.github)) {
        process.exitCode = 1;
      }
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
        throw new Error("quorate fix is interactive — run it in a terminal (pass --finding and --provider).");
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
