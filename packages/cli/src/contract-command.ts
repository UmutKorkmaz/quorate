import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import * as core from "@quorate/core";
import { preflightSecureWorkspaceState, writeSecureWorkspaceState } from "./secure-state.js";

export const CONTRACT_ARTIFACT_DIR = ".quorate/contract";

/** `git show` output is bounded so a mispointed ref at a binary blob fails closed instead of exhausting memory. */
const GIT_SHOW_MAX_BYTES = 5 * 1024 * 1024;
const CONTRACT_SCHEMA_VERSION = 1;
const LOCAL_SPEC_OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactOwnKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => typeof key === "string" && expected.includes(key))
  );
}

function ownValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function normalizeContractFinding(value: unknown): ContractFinding | undefined {
  if (!isPlainRecord(value)) return undefined;
  const optionalKeys = ["method", "path"].filter((key) => Object.hasOwn(value, key));
  if (!hasExactOwnKeys(value, ["id", "changeType", "rule", "title", "body", "severity", ...optionalKeys])) return undefined;
  const id = ownValue(value, "id");
  const changeType = ownValue(value, "changeType");
  const rule = ownValue(value, "rule");
  const title = ownValue(value, "title");
  const body = ownValue(value, "body");
  const severity = ownValue(value, "severity");
  if (
    typeof id !== "string" ||
    (changeType !== "breaking" && changeType !== "additive" && changeType !== "ambiguous") ||
    typeof rule !== "string" ||
    typeof title !== "string" ||
    typeof body !== "string" ||
    typeof severity !== "string"
  ) {
    return undefined;
  }
  const method = ownValue(value, "method");
  const path = ownValue(value, "path");
  if ((Object.hasOwn(value, "method") && typeof method !== "string") || (Object.hasOwn(value, "path") && typeof path !== "string")) {
    return undefined;
  }
  return {
    id,
    changeType,
    rule,
    title,
    body,
    severity,
    ...(typeof method === "string" ? { method } : {}),
    ...(typeof path === "string" ? { path } : {})
  };
}

function normalizeReference(value: unknown): { label: string; hash: string } | undefined {
  if (!isPlainRecord(value) || !hasExactOwnKeys(value, ["label", "hash"])) return undefined;
  const label = ownValue(value, "label");
  const hash = ownValue(value, "hash");
  return typeof label === "string" && typeof hash === "string" ? { label, hash } : undefined;
}

/** Verify the complete persisted artifact shape and its canonical hash before any consumer trusts it. */
export function validateContractArtifact(value: unknown): ContractArtifact | undefined {
  if (!isPlainRecord(value) || !hasExactOwnKeys(value, ["schema", "verdict", "counts", "findings", "before", "after", "artifactHash", "createdAt"])) {
    return undefined;
  }
  const schema = ownValue(value, "schema");
  const verdict = ownValue(value, "verdict");
  if (schema !== CONTRACT_SCHEMA_VERSION || (verdict !== "pass" && verdict !== "warn" && verdict !== "block")) return undefined;

  const countsValue = ownValue(value, "counts");
  if (!isPlainRecord(countsValue) || !hasExactOwnKeys(countsValue, ["breaking", "additive", "ambiguous"])) return undefined;
  const breaking = ownValue(countsValue, "breaking");
  const additive = ownValue(countsValue, "additive");
  const ambiguous = ownValue(countsValue, "ambiguous");
  if (
    !isNonNegativeInteger(breaking) ||
    !isNonNegativeInteger(additive) ||
    !isNonNegativeInteger(ambiguous)
  ) {
    return undefined;
  }

  const findingsValue = ownValue(value, "findings");
  if (!Array.isArray(findingsValue)) return undefined;
  const findings = findingsValue.map(normalizeContractFinding);
  if (findings.some((finding) => finding === undefined)) return undefined;
  const before = normalizeReference(ownValue(value, "before"));
  const after = normalizeReference(ownValue(value, "after"));
  const artifactHash = ownValue(value, "artifactHash");
  const createdAt = ownValue(value, "createdAt");
  if (!before || !after || typeof artifactHash !== "string" || !/^[a-f0-9]{64}$/.test(artifactHash) || typeof createdAt !== "string") {
    return undefined;
  }

  const artifact: ContractArtifact = {
    schema,
    verdict,
    counts: { breaking, additive, ambiguous },
    findings: findings as ContractFinding[],
    before,
    after,
    artifactHash,
    createdAt
  };
  return artifact.artifactHash === computeArtifactHash({
    schema: artifact.schema,
    verdict: artifact.verdict,
    counts: artifact.counts,
    findings: artifact.findings,
    before: artifact.before,
    after: artifact.after
  })
    ? artifact
    : undefined;
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
  let fd: number | undefined;
  try {
    const before = lstatSync(path);
    if (!before.isFile()) throw new Error("not a regular file");
    fd = openSync(path, LOCAL_SPEC_OPEN_FLAGS);
    const initial = fstatSync(fd);
    if (!initial.isFile() || initial.dev !== before.dev || initial.ino !== before.ino) {
      throw new Error("not a regular file or was replaced while opening");
    }
    if (initial.size > GIT_SHOW_MAX_BYTES) {
      throw new Error(`exceeds the bounded input limit of 5 MiB`);
    }

    const buffer = Buffer.allocUnsafe(GIT_SHOW_MAX_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, null);
      if (read === 0) break;
      bytesRead += read;
    }
    const final = fstatSync(fd);
    const after = lstatSync(path);
    if (
      bytesRead > GIT_SHOW_MAX_BYTES ||
      final.size > GIT_SHOW_MAX_BYTES ||
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      final.dev !== before.dev ||
      final.ino !== before.ino
    ) {
      throw new Error(`exceeds the bounded input limit of 5 MiB`);
    }
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read the ${option} spec file ${path}: ${message}`);
  } finally {
    if (fd !== undefined) closeSync(fd);
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
  const artifactJsonPath = resolve(cwd, CONTRACT_ARTIFACT_DIR, "latest.json");
  preflightSecureWorkspaceState(cwd, [
    `${CONTRACT_ARTIFACT_DIR}/latest.md`,
    `${CONTRACT_ARTIFACT_DIR}/latest.json`
  ]);
  writeSecureWorkspaceState(cwd, `${CONTRACT_ARTIFACT_DIR}/latest.md`, `${markdown}\n`);
  writeSecureWorkspaceState(cwd, `${CONTRACT_ARTIFACT_DIR}/latest.json`, `${JSON.stringify(artifact, null, 2)}\n`);

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

/** Verified loader for the latest contract artifact, undefined when absent, malformed, or hash-mismatched. */
export function readContractArtifact(cwd: string): ContractArtifact | undefined {
  const path = resolve(cwd, CONTRACT_ARTIFACT_DIR, "latest.json");
  if (!existsSync(path)) return undefined;
  try {
    return validateContractArtifact(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}
