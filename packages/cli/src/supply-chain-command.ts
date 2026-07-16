import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import * as core from "@quorate/core";
import {
  renderMarkdownReport,
  resolvePolicy,
  severities,
  shouldFailForPolicy,
  type CouncilReport,
  type CouncilRequest,
  type QuorateConfig,
  type Severity
} from "@quorate/core";
import { run } from "./diff.js";
import { loadPolicyFile } from "./policy-command.js";

export interface SupplyChainScanOptions {
  diff?: string;
  base?: string;
  head?: string;
  pr?: string;
  subject?: string;
  json?: boolean;
  gate?: boolean;
  failOn?: string;
  writeJson?: string;
  writeMd?: string;
}

export interface SupplyChainScanContext {
  cwd: string;
  config: QuorateConfig;
}

type BuildSupplyChainReport = (request: CouncilRequest, config?: QuorateConfig) => CouncilReport;

const VALID_FAIL_ON = new Set<string>([...severities, "never"]);

function buildSupplyChainReport(request: CouncilRequest, config: QuorateConfig): CouncilReport {
  const buildReport = (core as { buildSupplyChainReport?: BuildSupplyChainReport }).buildSupplyChainReport;
  if (typeof buildReport !== "function") {
    throw new Error(
      "SupplyChainGate core integration is not available in this build. Rebuild or upgrade @quorate/core."
    );
  }
  return buildReport(request, config);
}

function runGit(args: string[], cwd: string): string {
  try {
    return run("git", args, cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not a git repository|not a git work tree|outside repository|git diff --no-index/i.test(message)) {
      throw new Error(
        "No git repository found. Run quorate from a git worktree, or pass --diff <file>, --base <ref>, --head <ref>, or --pr <number>."
      );
    }
    throw err;
  }
}

function readUntrackedDiff(cwd: string): string {
  const paths = runGit(["ls-files", "--others", "--exclude-standard", "-z"], cwd)
    .split("\0")
    .filter(Boolean);

  return paths
    .map((file) => {
      const result = spawnSync("git", ["diff", "--no-index", "--", "/dev/null", file], {
        cwd,
        encoding: "utf8",
        shell: false,
        maxBuffer: 50 * 1024 * 1024
      });
      if (result.error) {
        throw new Error(`git diff --no-index failed for ${file}: ${result.error.message}`);
      }
      if (result.status !== 0 && result.status !== 1) {
        const detail = (result.stderr || result.stdout || "").trim();
        throw new Error(`git diff --no-index failed for ${file}: ${detail}`);
      }
      return result.stdout;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Read the complete diff for SupplyChainGate. Unlike `review`, this intentionally
 * keeps lockfiles because dependency-integrity checks need lockfile evidence.
 */
export function readSupplyChainDiff(options: SupplyChainScanOptions, cwd = process.cwd()): string {
  const selectedSources = [options.diff, options.pr, options.base].filter(Boolean).length;
  if (selectedSources > 1) {
    throw new Error("Choose only one SupplyChainGate diff source: --diff, --pr, or --base/--head.");
  }
  if (options.head && !options.base) {
    throw new Error("--head requires --base for a SupplyChainGate ref comparison.");
  }

  if (options.diff) {
    return readFileSync(resolve(cwd, options.diff), "utf8");
  }

  if (options.pr) {
    if (!/^\d+$/.test(options.pr)) {
      throw new Error(`Invalid PR number: '${options.pr}'. Use a numeric PR id, e.g. --pr 123.`);
    }
    return run("gh", ["pr", "diff", options.pr], cwd);
  }

  if (options.base && options.head) {
    return runGit(["diff", `${options.base}...${options.head}`], cwd);
  }

  if (options.base) {
    const tracked = runGit(["diff", options.base], cwd);
    const untracked = readUntrackedDiff(cwd);
    return [tracked, untracked].filter(Boolean).join("\n");
  }

  const staged = runGit(["diff", "--cached"], cwd);
  const unstaged = runGit(["diff"], cwd);
  const untracked = readUntrackedDiff(cwd);
  return [staged, unstaged, untracked].filter(Boolean).join("\n");
}

function writeReport(path: string | undefined, cwd: string, content: string): void {
  if (!path) return;
  const target = resolve(cwd, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function failOnFromOption(value: string | undefined): Severity | "never" | undefined {
  if (value === undefined) return undefined;
  if (!VALID_FAIL_ON.has(value)) {
    throw new Error(`--fail-on must be one of ${[...VALID_FAIL_ON].join(", ")}.`);
  }
  return value as Severity | "never";
}

export function runSupplyChainScan(options: SupplyChainScanOptions, context: SupplyChainScanContext): CouncilReport | undefined {
  const diff = readSupplyChainDiff(options, context.cwd);
  if (diff.trim().length === 0) {
    console.error("No changes to scan. Pass --diff <file>, --base/--head, or --pr <number>.");
    process.exitCode = 1;
    return undefined;
  }

  const request: CouncilRequest = {
    mode: "review",
    subject: options.subject ?? "SupplyChainGate scan",
    diff,
    repoPath: context.cwd,
    pullRequest: options.pr ? { number: Number(options.pr) } : undefined
  };
  const report = buildSupplyChainReport(request, context.config);

  const latestReportPath = resolve(context.cwd, ".quorate", "supply-chain", "latest.json");
  mkdirSync(dirname(latestReportPath), { recursive: true });
  writeFileSync(latestReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  writeReport(options.writeJson, context.cwd, `${JSON.stringify(report, null, 2)}\n`);
  writeReport(options.writeMd, context.cwd, renderMarkdownReport(report));

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderMarkdownReport(report));
  }

  if (options.gate) {
    const resolvedPolicy = resolvePolicy(context.config, {
      policy: loadPolicyFile(context.cwd) ?? undefined,
      failOn: failOnFromOption(options.failOn)
    });
    const policy = {
      ...resolvedPolicy,
      failOnDegraded: false,
      gate: undefined,
      rolesRequired: [],
      minRealProviders: 0
    };
    if (shouldFailForPolicy(report, policy)) {
      process.exitCode = 1;
    }
  }

  return report;
}
