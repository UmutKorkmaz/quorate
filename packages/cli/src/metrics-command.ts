import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { computeStats, type HistoryEntry, type Severity } from "@quorate/core";
import { readHistory } from "./history-command.js";
import { verifyLatestProof } from "./proof-runner.js";
import { exportApprovalAuditRecords, verifyApprovalAuditLedger } from "./trust-ledger.js";

/**
 * `quorate metrics` — aggregate LOCAL run evidence into one privacy-preserving
 * summary: review history verdicts/durations/findings, council agreement where
 * records carry it, verified approval decisions, the signed proof artifact, and
 * the latest contract verdict.
 *
 * Everything is read from `~/.quorate` plus `<cwd>/.quorate*`; nothing is ever
 * transmitted, and an empty store is a valid, all-zero report (never an error).
 */

const CONTRACT_MODULE_SPECIFIER = "../src/contract-command.js";
const CONTRACT_ARTIFACT_DIR = ".quorate/contract";
const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

export interface MetricsOptions {
  cwd: string;
  json?: boolean;
}

export interface HistoryMetrics {
  runs: number;
  verdictCounts: { pass: number; warn: number; fail: number };
  degradedRuns: number;
  findingCounts: Partial<Record<Severity, number>>;
  totalFindings: number;
  /** Median of per-run durations; null when no run recorded one. */
  medianDurationMs: number | null;
  /** Median of per-run council agreement (0..1); null when no run recorded one. */
  medianCouncilAgreement: number | null;
  providerFailureRates: Array<{ providerId: string; runs: number; failures: number }>;
}

export interface ApprovalMetrics {
  /** False when the HMAC chain failed verification — counts are then withheld. */
  verified: boolean;
  records: number;
  decisions: { allow: number; deny: number; timeout: number };
  /** First verification error, present only when `verified` is false. */
  note?: string;
}

export interface ProofMetrics {
  name: string;
  passed: boolean;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  finishedAt: string;
  /** Signed artifacts currently retained on disk (today: latest only). */
  artifacts: number;
  /** Passed artifacts / retained artifacts. */
  passRate: number;
}

export interface ContractMetrics {
  verdict: "pass" | "warn" | "block";
  counts: { breaking: number; ambiguous: number; additive: number };
  findings: number;
  before: { label: string; hash: string };
  after: { label: string; hash: string };
  artifactHash: string;
  createdAt: string;
}

export interface MetricsReport {
  schema: 1;
  cwd: string;
  generatedAt: string;
  history: HistoryMetrics;
  approvals: ApprovalMetrics;
  proofs?: ProofMetrics;
  contract?: ContractMetrics;
}

interface ContractArtifact {
  schema: 1;
  verdict: "pass" | "warn" | "block";
  counts: { breaking: number; ambiguous: number; additive: number };
  findings: unknown[];
  before: { label: string; hash: string };
  after: { label: string; hash: string };
  artifactHash: string;
  createdAt: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function collectHistory(cwd: string): Promise<HistoryMetrics> {
  let entries: HistoryEntry[] = [];
  try {
    entries = await readHistory(cwd);
  } catch {
    entries = [];
  }
  const stats = computeStats(entries);
  const durations: number[] = [];
  const agreements: number[] = [];
  for (const entry of entries) {
    // The persisted schema records verdicts and finding counts today; durations
    // and council agreement are aggregated only when a run record carries them.
    const durationMs = (entry as { durationMs?: unknown }).durationMs;
    if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) durations.push(durationMs);
    const agreement = (entry as { agreement?: unknown }).agreement;
    if (typeof agreement === "number" && Number.isFinite(agreement) && agreement >= 0 && agreement <= 1) {
      agreements.push(agreement);
    }
  }
  const totalFindings = Object.values(stats.severityCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  return {
    runs: stats.runs,
    verdictCounts: { ...stats.verdictCounts },
    degradedRuns: stats.degradedRuns,
    findingCounts: { ...stats.severityCounts },
    totalFindings,
    medianDurationMs: median(durations),
    medianCouncilAgreement: median(agreements),
    providerFailureRates: stats.providerFailureRates.map((row) => ({ ...row }))
  };
}

function collectApprovals(): ApprovalMetrics {
  const empty = { allow: 0, deny: 0, timeout: 0 };
  try {
    const verification = verifyApprovalAuditLedger();
    if (!verification.ok) {
      // Never trust unverified records: withhold every count.
      return { verified: false, records: 0, decisions: { ...empty }, note: verification.errors[0] };
    }
    const decisions = { ...empty };
    let records = 0;
    for (const row of JSON.parse(exportApprovalAuditRecords({ format: "json" })) as Array<{ decision?: unknown }>) {
      if (row.decision === "allow" || row.decision === "deny" || row.decision === "timeout") decisions[row.decision] += 1;
      records += 1;
    }
    return { verified: true, records, decisions };
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    return { verified: false, records: 0, decisions: { ...empty }, note };
  }
}

function collectProofs(cwd: string): ProofMetrics | undefined {
  try {
    // Metrics report recorded evidence: a legitimately drifted worktree
    // fingerprint (stale) still counts, but an unsigned/tampered artifact never does.
    const verification = verifyLatestProof(cwd, { checkFingerprint: false });
    const artifact = verification.artifact;
    if (!verification.ok || !artifact) return undefined;
    const passed = artifact.exitCode === 0 && !artifact.timedOut;
    return {
      name: artifact.name,
      passed,
      exitCode: artifact.exitCode,
      timedOut: artifact.timedOut,
      durationMs: artifact.durationMs,
      finishedAt: artifact.finishedAt,
      artifacts: 1,
      passRate: passed ? 1 : 0
    };
  } catch {
    return undefined;
  }
}

function asContractArtifact(value: unknown): ContractArtifact | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const artifact = value as Record<string, unknown>;
  if (artifact.schema !== 1) return undefined;
  if (artifact.verdict !== "pass" && artifact.verdict !== "warn" && artifact.verdict !== "block") return undefined;
  const counts = artifact.counts as Record<string, unknown> | undefined;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return undefined;
  for (const key of ["breaking", "ambiguous", "additive"] as const) {
    const count = counts[key];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return undefined;
  }
  if (!Array.isArray(artifact.findings)) return undefined;
  for (const side of ["before", "after"] as const) {
    const ref = artifact[side] as Record<string, unknown> | undefined;
    if (!ref || typeof ref !== "object" || Array.isArray(ref) || typeof ref.label !== "string" || typeof ref.hash !== "string") {
      return undefined;
    }
  }
  if (typeof artifact.artifactHash !== "string" || typeof artifact.createdAt !== "string") return undefined;
  return value as ContractArtifact;
}

/**
 * Prefer the contract command's own reader. The specifier stays non-literal so
 * resolution is a runtime concern while `contract-command.ts` lands as a
 * concurrent change; a missing module simply falls back to the raw artifact.
 */
async function readContractArtifactViaModule(cwd: string): Promise<ContractArtifact | undefined> {
  try {
    const specifier = CONTRACT_MODULE_SPECIFIER;
    const loaded = (await import(/* @vite-ignore */ specifier)) as {
      readContractArtifact?: (cwd: string) => unknown;
    };
    if (typeof loaded?.readContractArtifact !== "function") return undefined;
    return asContractArtifact(loaded.readContractArtifact(cwd));
  } catch {
    return undefined;
  }
}

/** Shape-validated read of the on-disk contract artifact (latest.json first). */
function readContractArtifactRaw(cwd: string): ContractArtifact | undefined {
  const dir = join(resolve(cwd), CONTRACT_ARTIFACT_DIR);
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return undefined;
    const names = readdirSync(dir).filter((name) => name.endsWith(".json"));
    names.sort((left, right) => {
      if (left === "latest.json") return -1;
      if (right === "latest.json") return 1;
      return statSync(join(dir, right)).mtimeMs - statSync(join(dir, left)).mtimeMs;
    });
    for (const name of names) {
      try {
        const artifact = asContractArtifact(JSON.parse(readFileSync(join(dir, name), "utf8")));
        if (artifact) return artifact;
      } catch {
        // Malformed candidate — try the next file.
      }
    }
  } catch {
    // Unreadable store — treated as absent.
  }
  return undefined;
}

async function collectContract(cwd: string): Promise<ContractMetrics | undefined> {
  const artifact = (await readContractArtifactViaModule(cwd)) ?? readContractArtifactRaw(cwd);
  if (!artifact) return undefined;
  return {
    verdict: artifact.verdict,
    counts: { ...artifact.counts },
    findings: artifact.findings.length,
    before: { ...artifact.before },
    after: { ...artifact.after },
    artifactHash: artifact.artifactHash,
    createdAt: artifact.createdAt
  };
}

/** Collect every local metric. Empty stores yield zero/absent sections, never errors. */
export async function collectMetrics(options: MetricsOptions): Promise<MetricsReport> {
  const cwd = resolve(options.cwd);
  const history = await collectHistory(cwd);
  const contract = await collectContract(cwd).catch(() => undefined);
  return {
    schema: 1,
    cwd,
    generatedAt: new Date().toISOString(),
    history,
    approvals: collectApprovals(),
    proofs: collectProofs(cwd),
    contract
  };
}

/** Render the report as terse human text (the `--json` path prints the report instead). */
export function renderMetrics(report: MetricsReport): string {
  const history = report.history;
  const lines: string[] = ["Quorate metrics  ·  local evidence only", "", "Reviews"];
  lines.push(
    `  ${history.runs} review${history.runs === 1 ? "" : "s"} on record` +
      (history.degradedRuns > 0 ? ` (${history.degradedRuns} degraded)` : "")
  );
  lines.push(
    `  Verdicts: ${history.verdictCounts.pass} pass · ${history.verdictCounts.warn} warn · ${history.verdictCounts.fail} fail`
  );
  const severities = SEVERITY_ORDER.filter((severity) => history.findingCounts[severity]).map(
    (severity) => `${history.findingCounts[severity]} ${severity}`
  );
  lines.push(`  Findings: ${history.totalFindings} total${severities.length > 0 ? ` (${severities.join(", ")})` : ""}`);
  if (history.medianDurationMs !== null) lines.push(`  Median duration: ${history.medianDurationMs} ms`);
  if (history.medianCouncilAgreement !== null) {
    lines.push(`  Median council agreement: ${Math.round(history.medianCouncilAgreement * 100)}%`);
  }
  if (history.providerFailureRates.length > 0) {
    lines.push("  Provider reliability:");
    for (const row of history.providerFailureRates) {
      const rate = row.runs > 0 ? Math.round((1 - row.failures / row.runs) * 100) : 100;
      lines.push(`    ${row.providerId}: ${rate}% ok (${row.runs} runs)`);
    }
  }

  lines.push("", "Approvals");
  if (!report.approvals.verified) {
    lines.push(`  ledger unverified — counts withheld: ${report.approvals.note ?? "unknown error"}`);
  } else {
    const decisions = report.approvals.decisions;
    lines.push(
      `  ${report.approvals.records} verified record(s): ${decisions.allow} allow · ${decisions.deny} deny · ${decisions.timeout} timeout`
    );
  }

  if (report.proofs) {
    const proof = report.proofs;
    lines.push(
      "",
      "Proof",
      `  ${proof.name}: ${proof.passed ? "passed" : "failed"} — exit ${proof.exitCode}${proof.timedOut ? " (timed out)" : ""} in ${proof.durationMs} ms (${proof.passRate}/${proof.artifacts} artifact${proof.artifacts === 1 ? "" : "s"})`
    );
  }

  if (report.contract) {
    const contract = report.contract;
    lines.push(
      "",
      "Contract",
      `  ${contract.verdict} — ${contract.counts.breaking} breaking · ${contract.counts.ambiguous} ambiguous · ${contract.counts.additive} additive (${contract.findings} finding${contract.findings === 1 ? "" : "s"})`,
      `  ${contract.before.label} (${contract.before.hash.slice(0, 8)}) → ${contract.after.label} (${contract.after.hash.slice(0, 8)})`
    );
  }

  return lines.join("\n");
}

/** Command entry point for the orchestrator: exit code 0 with text or JSON output. */
export async function runMetrics(options: MetricsOptions): Promise<{ exitCode: 0; output: string }> {
  const report = await collectMetrics(options);
  return {
    exitCode: 0,
    output: options.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderMetrics(report)}\n`
  };
}
