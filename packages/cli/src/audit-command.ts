import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { decisionInputHash, validateDecisionRecord, type DecisionSource } from "@quorate/core";
import { getWorktreeFingerprint } from "./proof-runner.js";
import {
  exportApprovalAuditRecords,
  verifyApprovalAuditLedger,
  type ApprovalAuditDecision
} from "./trust-ledger.js";

export interface AuditVerifyOptions {
  dir?: string;
  json?: boolean;
  cwd?: string;
  receipt?: string;
  diff?: string;
  current?: boolean;
}

export interface AuditCommandResult {
  exitCode: 0 | 1;
  output: string;
}

export function runAuditVerify(options: AuditVerifyOptions = {}): AuditCommandResult {
  if (options.receipt) return verifyReceipt(options);
  const result = verifyApprovalAuditLedger({ dir: options.dir });
  if (options.json) return { exitCode: result.ok ? 0 : 1, output: `${JSON.stringify(result, null, 2)}\n` };
  const lines = result.ok
    ? [`Audit verification PASSED: ${result.records} record(s), signed head sequence ${result.headSequence}.`]
    : [
        `Audit verification FAILED: ${result.records} readable record(s), signed head sequence ${result.headSequence}.`,
        ...result.errors.map((error) => `  - ${error}`)
      ];
  return { exitCode: result.ok ? 0 : 1, output: `${lines.join("\n")}\n` };
}

const DECISION_RUNTIME_PATHS = [".quorate/last-report.json", ".quorate/proofs", ".quorate/contract", ".quorate/supply-chain", ".quorate/decision.json"];

function git(cwd: string, args: string[]): string | undefined {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, maxBuffer: 1024 * 1024, timeout: 10_000 });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function commit(cwd: string, ref: string): string {
  const sha = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  if (!sha || !/^[a-f0-9]{40,64}$/.test(sha)) throw new Error(`Cannot resolve review revision: ${ref}`);
  return sha;
}

/** Capture before review execution. File/remote diffs never claim to describe the local worktree. */
export function captureDecisionSource(cwd: string, options: { diff?: string; pr?: string; base?: string; head?: string }): DecisionSource {
  if (options.diff) return { kind: "diff" };
  if (options.pr) return { kind: "pull-request" };
  if (options.base && options.head) {
    const headSha = commit(cwd, options.head);
    const baseSha = git(cwd, ["merge-base", commit(cwd, options.base), headSha]);
    if (!baseSha) throw new Error("Cannot resolve the merge base for this review.");
    return { kind: "git", baseSha, headSha };
  }
  const fingerprint = getWorktreeFingerprint(cwd, DECISION_RUNTIME_PATHS);
  // An unborn repository can still have reviewable staged changes. Bind only the
  // supplied diff until there is a commit identity rather than rejecting review.
  if (!fingerprint.gitHead) return { kind: "diff" };
  return { kind: "worktree", baseSha: options.base ? commit(cwd, options.base) : fingerprint.gitHead,
    headSha: fingerprint.gitHead, worktreeHash: fingerprint.worktreeHash };
}

function readBoundedFile(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > 5 * 1024 * 1024) throw new Error("Receipt verification inputs must be regular files of at most 5 MiB.");
    const buffer = Buffer.alloc(info.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    if (bytes !== info.size) throw new Error("Verification input changed while being read.");
    return buffer.subarray(0, bytes).toString("utf8");
  } finally { closeSync(fd); }
}

function verifyReceipt(options: AuditVerifyOptions): AuditCommandResult {
  const errors: string[] = [];
  const cwd = resolve(options.cwd ?? process.cwd());
  try {
    const record: unknown = JSON.parse(readBoundedFile(resolve(cwd, options.receipt!)));
    if (!validateDecisionRecord(record)) throw new Error("Receipt schema or content digest does not match.");
    if (options.diff && decisionInputHash(readBoundedFile(resolve(cwd, options.diff))) !== record.inputs.diffHash) errors.push("The supplied diff does not match the reviewed input.");
    if (options.current) {
      if (record.source.kind === "worktree") {
        const current = getWorktreeFingerprint(cwd, DECISION_RUNTIME_PATHS);
        if (current.gitHead !== record.source.headSha || current.worktreeHash !== record.source.worktreeHash) errors.push("The current worktree differs from the reviewed snapshot.");
      } else if (record.source.kind === "git" && record.source.headSha) {
        if (commit(cwd, "HEAD") !== record.source.headSha) errors.push("Current HEAD differs from the reviewed revision.");
      } else errors.push("This receipt cannot establish the current checkout; verify its supplied diff instead.");
    }
  } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  const result = { ok: errors.length === 0, attestation: "none", errors,
    note: "Verifies content integrity and any requested input binding; does not authenticate the producer or attest execution." };
  return { exitCode: result.ok ? 0 : 1, output: options.json ? `${JSON.stringify(result, null, 2)}\n`
    : `${result.ok ? "Receipt integrity verified." : "Receipt verification FAILED."}\n${errors.map((error) => `  - ${error}\n`).join("")}${result.note}\n` };
}

export interface AuditExportCommandOptions {
  dir?: string;
  decision?: string;
  source?: string;
  since?: string;
  until?: string;
  format?: string;
}

export function runAuditExport(options: AuditExportCommandOptions = {}): string {
  const format = options.format ?? "jsonl";
  if (format !== "json" && format !== "jsonl") throw new Error("--format must be json or jsonl.");
  if (options.decision !== undefined && !["allow", "deny", "timeout"].includes(options.decision)) {
    throw new Error("--decision must be allow, deny, or timeout.");
  }
  return exportApprovalAuditRecords({
    dir: options.dir,
    format,
    decision: options.decision as ApprovalAuditDecision | undefined,
    source: options.source,
    since: options.since,
    until: options.until
  });
}
