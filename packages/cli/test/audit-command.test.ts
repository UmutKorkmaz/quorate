import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { appendApprovalAuditRecord, auditKeyPath, auditLedgerPath, auditLockPath } from "../src/trust-ledger.js";
import { runAuditExport, runAuditVerify } from "../src/audit-command.js";
import { buildProgram } from "../src/index.js";

function tempAuditDir(): string {
  return join(mkdtempSync(join(tmpdir(), "quorate-audit-command-")), "audit");
}

function seed(dir: string): void {
  appendApprovalAuditRecord(
    {
      requestId: "ap-1",
      runId: "run-1",
      source: "claude",
      tool: "Bash",
      decision: "allow",
      decisionSurface: "monitor-tui",
      timestamp: "2026-07-28T09:00:00.000Z"
    },
    { dir }
  );
}

describe("audit commands", () => {
  it("registers the exact `quorate audit verify` and `quorate audit export` command names", () => {
    const audit = buildProgram().commands.find((command) => command.name() === "audit");

    expect(audit?.commands.map((command) => command.name())).toEqual(["verify", "export"]);
  });

  it("reports a valid ledger with a successful exit code", () => {
    const dir = tempAuditDir();
    seed(dir);

    const result = runAuditVerify({ dir, json: true });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({ ok: true, records: 1, headSequence: 1 });
  });

  it("reports tampering with a failing exit code", () => {
    const dir = tempAuditDir();
    seed(dir);
    appendFileSync(auditLedgerPath(dir), "{}\n");

    const result = runAuditVerify({ dir, json: false });

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/FAILED/);
  });

  it("validates export filters and emits the selected format", () => {
    const dir = tempAuditDir();
    seed(dir);

    expect(() => runAuditExport({ dir, decision: "maybe", format: "jsonl" })).toThrow(/decision/i);
    expect(() => runAuditExport({ dir, format: "xml" })).toThrow(/format/i);
    expect(JSON.parse(runAuditExport({ dir, decision: "allow", format: "json" }))).toHaveLength(1);
  });

  it.each(["non-regular-key", "corrupt-key", "malformed-lock"] as const)(
    "returns machine JSON for malformed state: %s",
    (kind) => {
      const dir = tempAuditDir();
      seed(dir);
      if (kind === "non-regular-key") {
        rmSync(auditKeyPath(dir));
        mkdirSync(auditKeyPath(dir));
      } else if (kind === "corrupt-key") {
        writeFileSync(auditKeyPath(dir), "short", { mode: 0o600 });
      } else {
        writeFileSync(auditLockPath(dir), "not-json", { mode: 0o600 });
      }

      const result = runAuditVerify({ dir, json: true });

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.output)).toMatchObject({ ok: false, errors: expect.any(Array) });
    }
  );

  it("the actual --json CLI action writes JSON to stdout and exits 1 for a symlink audit path", async () => {
    const root = mkdtempSync(join(tmpdir(), "quorate-audit-cli-link-"));
    const target = join(root, "target");
    const dir = join(root, "audit");
    mkdirSync(target);
    symlinkSync(target, dir);
    let stdout = "";
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    }) as typeof process.stdout.write);
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await buildProgram().parseAsync(["node", "quorate", "audit", "verify", "--json", "--dir", dir]);
      expect(process.exitCode).toBe(1);
      expect(JSON.parse(stdout)).toMatchObject({ ok: false, errors: expect.any(Array) });
    } finally {
      write.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it("human verification diagnostics escape terminal control characters from --dir", () => {
    const root = mkdtempSync(join(tmpdir(), "quorate-audit-control-"));
    const dir = join(root, "audit-\u001b[31m");
    mkdirSync(dir, { mode: 0o700 });
    mkdirSync(auditKeyPath(dir));

    const result = runAuditVerify({ dir, json: false });

    expect(result.exitCode).toBe(1);
    expect(result.output).not.toContain("\u001b");
    expect(result.output).toContain("\\u001b");
  });
});
