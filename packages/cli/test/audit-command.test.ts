import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createDecisionRecord, createDefaultConfig, resolvePolicy, runCouncil } from "@quorate/core";
import { describe, expect, it, vi } from "vitest";
import { appendApprovalAuditRecord, auditKeyPath, auditLedgerPath, auditLockPath } from "../src/trust-ledger.js";
import { captureDecisionSource, runAuditExport, runAuditVerify } from "../src/audit-command.js";
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
  it("keeps unborn-repository reviews available with explicit diff-only identity", () => {
    const cwd = mkdtempSync(join(tmpdir(), "quorate-unborn-receipt-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd });
      writeFileSync(join(cwd, "file.txt"), "first change\n");
      execFileSync("git", ["add", "file.txt"], { cwd });
      expect(captureDecisionSource(cwd, {})).toEqual({ kind: "diff" });
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it("verifies a portable receipt and rejects input drift without counting its own runtime artifacts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "quorate-receipt-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd });
      execFileSync("git", ["config", "user.name", "Receipt Test"], { cwd });
      execFileSync("git", ["config", "user.email", "receipt@example.test"], { cwd });
      writeFileSync(join(cwd, "file.txt"), "before\n");
      execFileSync("git", ["add", "."], { cwd });
      execFileSync("git", ["commit", "-qm", "before"], { cwd });
      writeFileSync(join(cwd, "file.txt"), "after\n");
      const config = createDefaultConfig();
      const request = { mode: "review" as const, subject: "receipt", diff: "+after" };
      const source = captureDecisionSource(cwd, {});
      const report = await runCouncil(request, config);
      const record = createDecisionRecord(request, config, report, resolvePolicy(config), { source });
      mkdirSync(join(cwd, ".quorate"));
      writeFileSync(join(cwd, ".quorate/last-report.json"), JSON.stringify(report));
      writeFileSync(join(cwd, ".quorate/decision.json"), JSON.stringify(record));
      const options = { cwd, receipt: ".quorate/decision.json", current: true, json: true };
      expect(runAuditVerify(options).exitCode).toBe(0);
      writeFileSync(join(cwd, "file.txt"), "changed after review\n");
      expect(runAuditVerify(options).exitCode).toBe(1);
      writeFileSync(join(cwd, "input.diff"), "+after");
      expect(runAuditVerify({ ...options, current: false, diff: "input.diff" }).exitCode).toBe(0);
      writeFileSync(join(cwd, "input.diff"), "+other");
      expect(runAuditVerify({ ...options, current: false, diff: "input.diff" }).exitCode).toBe(1);
      writeFileSync(join(cwd, ".quorate/decision.json"), JSON.stringify({ ...record, result: { verdict: "pass", degraded: false } }));
      expect(runAuditVerify(options).exitCode).toBe(1);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

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
    // DEL (0x7f) is filesystem-valid on Windows, unlike 0x00-0x1f such as ESC,
    // while still exercising the same terminal-control escaping path.
    const dir = join(root, "audit-\u007f");
    mkdirSync(dir, { mode: 0o700 });
    mkdirSync(auditKeyPath(dir));

    const result = runAuditVerify({ dir, json: false });

    expect(result.exitCode).toBe(1);
    expect(result.output).not.toContain("\u007f");
    expect(result.output).toContain("\\u007f");
  });
});
