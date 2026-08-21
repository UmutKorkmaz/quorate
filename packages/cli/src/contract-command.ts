import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import * as core from "@quorate/core";

export const CONTRACT_ARTIFACT_DIR = ".quorate/contract";

/** `git show` output is bounded so a mispointed ref at a binary blob fails closed instead of exhausting memory. */
const GIT_SHOW_MAX_BYTES = 5 * 1024 * 1024;
const CONTRACT_SCHEMA_VERSION = 1;

export type ContractVerdict = "pass" | "warn" | "block";
export type ContractChangeType = "breaking" | "additive" | "ambiguous";

export interface ContractFinding {
  id: string;
  changeType: ContractChangeType;
  rule: string;
  title: string;
  body: string;
  severity: string;
  method?: string;
  path?: string;
}

export interface ContractComparisonResult {
  verdict: ContractVerdict;
  counts: { breaking: number; additive: number; ambiguous: number };
  before: { label: string; hash: string };
  after: { label: string; hash: string };
  findings: ContractFinding[];
}

/** What `quorate contract check` persists for the metrics agent and later audits. */
export interface ContractArtifact {
  schema: 1;
  verdict: ContractVerdict;
  counts: { breaking: number; additive: number; ambiguous: number };
  findings: ContractFinding[];
  before: { label: string; hash: string };
  after: { label: string; hash: string };
  artifactHash: string;
  createdAt: string;
}

export interface ContractCheckOptions {
  cwd: string;
  spec?: string;
  base?: string;
  head?: string;
  before?: string;
  after?: string;
  gate?: boolean;
  json?: boolean;
}

export interface ContractCheckOutcome {
  verdict: "pass" | "warn" | "block";
  exitCode: number;
  summary: string;
  artifactPath?: string;
}

type ParseOpenApiFn = (source: string) => { ok: true; doc: unknown } | { ok: false; error: string };
type CompareContractsFn = (input: {
  before: { source: string; label: string };
  after: { source: string; label: string };
}) => ContractComparisonResult;

const execFileAsync = promisify(execFile) as (
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Resolve the ContractCourt engine from @quorate/core. Looked up structurally
 * (like the SupplyChainGate integration) so a CLI built against an older core
 * fails with a clear message instead of an import-time crash.
 */
function contractEngine(): { parseOpenApi: ParseOpenApiFn; compareContracts: CompareContractsFn } {
  const candidates = core as unknown as { parseOpenApi?: ParseOpenApiFn; compareContracts?: CompareContractsFn };
  if (typeof candidates.parseOpenApi !== "function" || typeof candidates.compareContracts !== "function") {
    throw new Error(
      "ContractCourt engine is not available in this build. Rebuild or upgrade @quorate/core."
    );
  }
  return { parseOpenApi: candidates.parseOpenApi, compareContracts: candidates.compareContracts };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Deterministic JSON: sorted keys, recursively — same inputs, same bytes. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** sha256 over the canonical JSON of everything except createdAt, so the artifact verifies deterministically. */
function computeArtifactHash(artifact: Omit<ContractArtifact, "artifactHash" | "createdAt">): string {
  return sha256(canonicalJson(artifact));
}

interface ContractInput {
  source: string;
  label: string;
}

/** Load the spec file content at one git ref (`git show ref:path`, no shell, bounded output). */
async function showGitSpec(ref: string, specPath: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["show", `${ref}:${specPath}`], {
      cwd,
      encoding: "utf8",
      shell: false,
      maxBuffer: GIT_SHOW_MAX_BYTES
    });
    return stdout;
  } catch (error) {
    const detail =
      typeof error === "object" && error !== null && "stderr" in error && typeof (error as { stderr?: unknown }).stderr === "string" && (error as { stderr: string }).stderr.trim()
        ? (error as { stderr: string }).stderr.trim()
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`git show ${ref}:${specPath} failed: ${detail}`);
  }
}

function readSpecFile(path: string, option: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read the ${option} spec file ${path}: ${message}`);
  }
}

/** Validate the mutually exclusive input modes and load both spec sources. */
async function loadContractInputs(options: ContractCheckOptions, cwd: string): Promise<{ before: ContractInput; after: ContractInput }> {
  const gitModeSelected = Boolean(options.spec || options.base || options.head);
  const fileModeSelected = Boolean(options.before || options.after);

  if (gitModeSelected && fileModeSelected) {
    throw new Error(
      "Choose one contract input mode: --spec/--base/--head for git refs or --before/--after for files."
    );
  }

  if (gitModeSelected) {
    if (!options.spec) throw new Error("--base/--head require --spec <path> to select the contract file.");
    if (!options.base || !options.head) throw new Error("--spec requires both --base <ref> and --head <ref>.");
    return {
      before: { source: await showGitSpec(options.base, options.spec, cwd), label: `${options.base}:${options.spec}` },
      after: { source: await showGitSpec(options.head, options.spec, cwd), label: `${options.head}:${options.spec}` }
    };
  }

  if (fileModeSelected) {
    if (!options.before || !options.after) {
      throw new Error(
        options.after ? "--after requires --before <path>." : "--before requires --after <path>."
      );
    }
    return {
      before: { source: readSpecFile(resolve(cwd, options.before), "--before"), label: options.before },
      after: { source: readSpecFile(resolve(cwd, options.after), "--after"), label: options.after }
    };
  }

  throw new Error(
    "Pass a contract input mode: --spec <path> --base <ref> --head <ref>, or --before <path> --after <path>."
  );
}

/** Compact human-readable evidence: verdict, counts, and per-finding rule/method/path with before→after labels. */
function renderContractMarkdown(artifact: ContractArtifact): string {
  const lines = [
    "# Quorate ContractCourt — contract check",
    "",
    `Verdict: ${artifact.verdict.toUpperCase()}`,
    "",
    "| Verdict | Breaking | Ambiguous | Additive |",
    "| --- | --- | --- | --- |",
    `| ${artifact.verdict} | ${artifact.counts.breaking} | ${artifact.counts.ambiguous} | ${artifact.counts.additive} |`,
    "",
    `Before: \`${artifact.before.label}\` (sha256 ${artifact.before.hash})`,
    `After: \`${artifact.after.label}\` (sha256 ${artifact.after.hash})`,
    ""
  ];

  if (artifact.findings.length === 0) {
    lines.push("No contract changes detected.", "");
    return lines.join("\n");
  }

  lines.push(
    "| # | Change | Severity | Rule | Method | Path | Title |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...artifact.findings.map(
      (finding, index) =>
        `| ${index + 1} | ${finding.changeType} | ${finding.severity} | ${finding.rule} | ${finding.method ?? "—"} | ${finding.path ?? "—"} | ${finding.title} |`
    ),
    "",
    `Evidence: \`${artifact.before.label}\` → \`${artifact.after.label}\``,
    ""
  );

  for (const finding of artifact.findings) {
    const where = [finding.method, finding.path].filter(Boolean).join(" ");
    lines.push(
      `### ${finding.title} (${finding.changeType}, ${finding.severity})`,
      "",
      `- Rule: \`${finding.rule}\`${where ? ` — ${where}` : ""}`,
      `- Evidence: \`${artifact.before.label}\` → \`${artifact.after.label}\``,
      "",
      finding.body,
      ""
    );
  }

  return lines.join("\n");
}

/**
 * Run a contract comparison between two spec snapshots and persist the artifact
 * to `<cwd>/.quorate/contract/latest.{json,md}`. Fails closed: mode-validation,
 * git, file, and parse errors return exitCode 1 with an "error: …" summary and
 * write no artifact. With `gate: true`, only a "block" verdict exits non-zero.
 */
export async function runContractCheck(options: ContractCheckOptions): Promise<ContractCheckOutcome> {
  const cwd = resolve(options.cwd);

  let before: ContractInput;
  let after: ContractInput;
  let comparison: ContractComparisonResult;
  try {
    const inputs = await loadContractInputs(options, cwd);
    before = inputs.before;
    after = inputs.after;

    const engine = contractEngine();
    for (const input of [before, after]) {
      const parsed = engine.parseOpenApi(input.source);
      if (!parsed.ok) throw new Error(`failed to parse the OpenAPI spec at ${input.label}: ${parsed.error}`);
    }
    comparison = engine.compareContracts({ before, after });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const summary = `error: ${message}`;
    console.error(summary);
    return { verdict: "block", exitCode: 1, summary };
  }

  const artifact: ContractArtifact = {
    schema: CONTRACT_SCHEMA_VERSION,
    verdict: comparison.verdict,
    counts: comparison.counts,
    findings: comparison.findings,
    before: comparison.before,
    after: comparison.after,
    artifactHash: computeArtifactHash({
      schema: CONTRACT_SCHEMA_VERSION,
      verdict: comparison.verdict,
      counts: comparison.counts,
      findings: comparison.findings,
      before: comparison.before,
      after: comparison.after
    }),
    createdAt: new Date().toISOString()
  };

  const markdown = renderContractMarkdown(artifact);
  const artifactDir = resolve(cwd, CONTRACT_ARTIFACT_DIR);
  // Creation-time modes only (a write never re-chmods an existing file),
  // matching how sessions and proofs keep .quorate state owner-only.
  mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  const artifactJsonPath = join(artifactDir, "latest.json");
  writeFileSync(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  writeFileSync(join(artifactDir, "latest.md"), `${markdown}\n`, { encoding: "utf8", mode: 0o600 });

  if (options.json) {
    console.log(JSON.stringify(artifact, null, 2));
  } else {
    console.log(markdown);
  }

  const exitCode = options.gate && comparison.verdict === "block" ? 1 : 0;
  const summary =
    `contract check ${comparison.verdict}: ${comparison.counts.breaking} breaking, ` +
    `${comparison.counts.ambiguous} ambiguous, ${comparison.counts.additive} additive ` +
    `(${comparison.before.label} → ${comparison.after.label})`;

  return { verdict: comparison.verdict, exitCode, summary, artifactPath: artifactJsonPath };
}

/** Plain loader for the latest contract artifact — no re-verification, undefined when absent or unreadable. */
export function readContractArtifact(cwd: string): ContractArtifact | undefined {
  const path = resolve(cwd, CONTRACT_ARTIFACT_DIR, "latest.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ContractArtifact;
  } catch {
    return undefined;
  }
}
