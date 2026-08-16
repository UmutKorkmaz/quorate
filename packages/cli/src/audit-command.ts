import {
  exportApprovalAuditRecords,
  verifyApprovalAuditLedger,
  type ApprovalAuditDecision
} from "./trust-ledger.js";

export interface AuditVerifyOptions {
  dir?: string;
  json?: boolean;
}

export interface AuditCommandResult {
  exitCode: 0 | 1;
  output: string;
}

export function runAuditVerify(options: AuditVerifyOptions = {}): AuditCommandResult {
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
