import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendApprovalAuditRecord,
  auditHeadPath,
  auditKeyPath,
  auditLedgerPath,
  auditLockPath,
  MAX_AUDIT_LEDGER_BYTES,
  MAX_AUDIT_DIAGNOSTICS,
  MAX_AUDIT_RECORDS,
  exportApprovalAuditRecords,
  readVerifiedApprovalAuditRecord,
  verifyApprovalAuditLedger
} from "../src/trust-ledger.js";

function tempAuditDir(): string {
  return join(mkdtempSync(join(tmpdir(), "quorate-audit-")), "audit");
}

function auditInitKeyPath(dir: string): string {
  return join(dir, "approvals.key.init");
}

function append(dir: string, id: string, decision: "allow" | "deny" | "timeout" = "allow"): void {
  appendApprovalAuditRecord(
    {
      requestId: id,
      runId: "run-1",
      source: "claude",
      tool: "Bash",
      decision,
      decisionSurface: "monitor-tui",
      timestamp: "2026-07-28T09:00:00.000Z"
    },
    { dir }
  );
}

describe("approval trust ledger", () => {
  it("creates an owner-only directory, key, ledger, signed head, and lock", () => {
    const dir = tempAuditDir();

    append(dir, "ap-1");

    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const path of [auditKeyPath(dir), auditLedgerPath(dir), auditHeadPath(dir)]) {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    // The exclusive lock is removed after the append, but while present its
    // declared path is inside the audit directory and never world-readable.
    expect(auditLockPath(dir)).toBe(join(dir, "approvals.lock"));
  });

  it("chains deterministic hashes and HMAC signatures and verifies the intact ledger", () => {
    const dir = tempAuditDir();
    append(dir, "ap-1", "allow");
    append(dir, "ap-2", "deny");

    const lines = readFileSync(auditLedgerPath(dir), "utf8").trim().split("\n").map((line) => JSON.parse(line));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ schemaVersion: 1, sequence: 1, requestId: "ap-1", previousHash: null });
    expect(lines[1]).toMatchObject({ schemaVersion: 1, sequence: 2, requestId: "ap-2", previousHash: lines[0].recordHash });
    expect(lines[0].recordHash).toMatch(/^[a-f0-9]{64}$/);
    expect(lines[0].signature).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyApprovalAuditLedger({ dir })).toEqual({ ok: true, records: 2, headSequence: 2, errors: [] });
  });

  it.each(["after-ledger-fsync", "after-head-temp-fsync", "after-head-rename"] as const)(
    "recovers a complete signed suffix after an injected %s crash boundary",
    (point) => {
      const dir = tempAuditDir();
      append(dir, "ap-1");
      expect(() =>
        appendApprovalAuditRecord(
          {
            requestId: "ap-crash",
            runId: "run-1",
            source: "claude",
            tool: "Bash",
            decision: "deny",
            reasonCode: "user-denied",
            decisionSurface: "monitor-web",
            timestamp: "2026-07-28T09:00:01.000Z"
          },
          { dir, fault: (at) => { if (at === point) throw new Error(`fault:${point}`); } }
        )
      ).toThrow(`fault:${point}`);

      // A retry with a different request must safely recover the already
      // signed suffix/head boundary rather than permanently bricking storage.
      append(dir, "ap-after");
      expect(verifyApprovalAuditLedger({ dir })).toMatchObject({ ok: true, records: 3, headSequence: 3 });
      expect(readVerifiedApprovalAuditRecord({ requestId: "ap-crash", runId: "run-1", source: "claude", tool: "Bash" }, { dir })?.decision).toBe("deny");
    }
  );

  it("rejects a non-empty ledger with a missing head at every valid prefix", () => {
    const sourceDir = tempAuditDir();
    append(sourceDir, "ap-1");
    append(sourceDir, "ap-2");
    append(sourceDir, "ap-3");
    const allLines = readFileSync(auditLedgerPath(sourceDir), "utf8").trimEnd().split("\n");
    const key = readFileSync(auditKeyPath(sourceDir));

    for (let prefix = 1; prefix <= allLines.length; prefix += 1) {
      const dir = tempAuditDir();
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(auditKeyPath(dir), key, { mode: 0o600 });
      writeFileSync(auditLedgerPath(dir), `${allLines.slice(0, prefix).join("\n")}\n`, { mode: 0o600 });

      const result = verifyApprovalAuditLedger({ dir });

      expect(result.ok, `prefix ${prefix}`).toBe(false);
      expect(result.errors.join(" "), `prefix ${prefix}`).toMatch(/head.*missing|required head/i);
      expect(() => append(dir, `ap-after-${prefix}`)).toThrow(/verification failed/i);
      expect(existsSync(auditHeadPath(dir))).toBe(false);
    }
  });

  it("rejects deletion of the entire ledger and head when the established final key remains", () => {
    const dir = tempAuditDir();
    append(dir, "ap-before-rollback");
    const establishedKey = readFileSync(auditKeyPath(dir));
    rmSync(auditLedgerPath(dir));
    rmSync(auditHeadPath(dir));

    const result = verifyApprovalAuditLedger({ dir });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/final.*key.*head|head.*missing|incomplete.*store/i);
    expect(() => append(dir, "ap-after-rollback")).toThrow(/verification failed/i);
    expect(readFileSync(auditKeyPath(dir))).toEqual(establishedKey);
    expect(existsSync(auditLedgerPath(dir))).toBe(false);
    expect(existsSync(auditHeadPath(dir))).toBe(false);
  });

  it("quarantines a partial provisional key and fails the current append closed", () => {
    const dir = tempAuditDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const provisional = auditInitKeyPath(dir);
    writeFileSync(provisional, Buffer.alloc(12, 0x41), { mode: 0o600 });

    const result = verifyApprovalAuditLedger({ dir });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/provisional.*key/i);
    expect(() => append(dir, "ap-partial-key")).toThrow(/provisional.*key/i);
    expect(existsSync(provisional)).toBe(false);
    expect(existsSync(auditKeyPath(dir))).toBe(false);
    expect(existsSync(auditHeadPath(dir))).toBe(false);
    expect(existsSync(auditLedgerPath(dir))).toBe(false);
    const quarantined = readdirSync(dir).filter((name) => name.startsWith("approvals.key.init.corrupt-"));
    expect(quarantined).toHaveLength(1);
    expect(readFileSync(join(dir, quarantined[0]!))).toEqual(Buffer.alloc(12, 0x41));

    append(dir, "ap-after-partial-key");
    expect(verifyApprovalAuditLedger({ dir })).toMatchObject({ ok: true, records: 1, headSequence: 1 });
  });

  it("writes a signed sequence-0 genesis head before the first ledger append", () => {
    const dir = tempAuditDir();
    expect(() => appendApprovalAuditRecord({
      requestId: "ap-first", runId: "run-1", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "monitor-tui", timestamp: "2026-07-28T09:00:00.000Z"
    }, { dir, fault: (point) => { if (point === "after-ledger-fsync") throw new Error("record crash"); } })).toThrow("record crash");

    expect(JSON.parse(readFileSync(auditHeadPath(dir), "utf8"))).toMatchObject({ sequence: 0, recordHash: null });
    append(dir, "ap-after-first-crash");
    expect(verifyApprovalAuditLedger({ dir })).toMatchObject({ ok: true, records: 2, headSequence: 2 });
  });

  it("detects mutation, deletion/reordering, invalid signatures, and tail truncation", () => {
    const cases = ["mutation", "reorder", "signature", "truncate"] as const;
    for (const kind of cases) {
      const dir = tempAuditDir();
      append(dir, "ap-1");
      append(dir, "ap-2", "deny");
      const path = auditLedgerPath(dir);
      const lines = readFileSync(path, "utf8").trim().split("\n");
      if (kind === "mutation") {
        lines[0] = lines[0].replace('"tool":"Bash"', '"tool":"Write"');
        writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
      } else if (kind === "reorder") {
        writeFileSync(path, `${lines.reverse().join("\n")}\n`, { mode: 0o600 });
      } else if (kind === "signature") {
        const record = JSON.parse(lines[0]);
        record.signature = "0".repeat(64);
        lines[0] = JSON.stringify(record);
        writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
      } else {
        writeFileSync(path, `${lines[0]}\n`, { mode: 0o600 });
      }

      const result = verifyApprovalAuditLedger({ dir });
      expect(result.ok, kind).toBe(false);
      expect(result.errors.length, kind).toBeGreaterThan(0);
    }
  });

  it("rejects malformed trailing bytes instead of ignoring a partial record", () => {
    const dir = tempAuditDir();
    append(dir, "ap-1");
    const path = auditLedgerPath(dir);
    const size = statSync(path).size;
    truncateSync(path, size - 3);

    expect(verifyApprovalAuditLedger({ dir }).ok).toBe(false);
  });

  it("enforces exactly one terminal decision per request id", () => {
    const dir = tempAuditDir();
    append(dir, "ap-1", "allow");

    expect(() => append(dir, "ap-1", "deny")).toThrow(/already has a terminal decision/i);
    expect(verifyApprovalAuditLedger({ dir }).records).toBe(1);
  });

  it("stores only allowlisted metadata and a closed reason code, never free-form text or secrets", () => {
    const dir = tempAuditDir();
    appendApprovalAuditRecord(
      {
        requestId: "ap-secret",
        runId: "run-secret",
        source: "claude",
        tool: "Bash",
        decision: "deny",
        reasonCode: "user-denied",
        decisionSurface: "monitor-web",
        timestamp: "2026-07-28T09:00:00.000Z",
        // Compile-time escape simulates a caller accidentally forwarding raw
        // hook data. The persisted record must be built from an allowlist.
        ...({ reason: "Basic YWxhZGRpbjpvcGVuc2VzYW1l", prompt: "secret prompt", output: "eyJhbGciOiJIUzI1NiJ9.secret.jwt", diff: "postgres://u:p@db/x", privateKey: "-----BEGIN PRIVATE KEY-----" } as Record<string, unknown>)
      },
      { dir }
    );

    const raw = readFileSync(auditLedgerPath(dir), "utf8");
    const record = JSON.parse(raw);
    expect(Object.keys(record).sort()).toEqual([
      "decision",
      "decisionSurface",
      "previousHash",
      "reasonCode",
      "recordHash",
      "requestId",
      "runId",
      "schemaVersion",
      "sequence",
      "signature",
      "source",
      "timestamp",
      "tool"
    ].sort());
    expect(raw).not.toContain("secret prompt");
    expect(raw).not.toContain("secret output");
    expect(raw).not.toContain("full diff");
    expect(raw).not.toContain("Basic");
    expect(raw).not.toContain("eyJhbGci");
    expect(raw).not.toContain("postgres://");
    expect(raw).not.toContain("PRIVATE KEY");
    expect(record.reasonCode).toBe("user-denied");
  });

  it("exports filtered records as JSONL or a JSON array without signature material", () => {
    const dir = tempAuditDir();
    append(dir, "ap-1", "allow");
    appendApprovalAuditRecord(
      {
        requestId: "ap-2",
        runId: "run-2",
        source: "codex",
        tool: "Write",
        decision: "deny",
        decisionSurface: "monitor-web",
        timestamp: "2026-07-29T09:00:00.000Z"
      },
      { dir }
    );

    const jsonl = exportApprovalAuditRecords({ dir, decision: "deny", source: "codex", format: "jsonl" });
    expect(jsonl.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(jsonl).requestId).toBe("ap-2");
    expect(jsonl).not.toContain("signature");
    expect(jsonl).not.toContain("recordHash");

    const json = exportApprovalAuditRecords({ dir, since: "2026-07-29T00:00:00.000Z", format: "json" });
    expect(JSON.parse(json)).toHaveLength(1);
    expect(JSON.parse(json)[0].requestId).toBe("ap-2");
  });

  it.each([
    ["directory", (dir: string) => dir],
    ["key", auditKeyPath],
    ["ledger", auditLedgerPath],
    ["head", auditHeadPath]
  ] as const)("reports widened %s permissions without repairing them", (_label, target) => {
    const dir = tempAuditDir();
    append(dir, "ap-1");
    const path = target(dir);
    chmodSync(path, path === dir ? 0o755 : 0o644);
    const before = statSync(path).mode & 0o777;

    const result = verifyApprovalAuditLedger({ dir });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/permissions/i);
    expect(statSync(path).mode & 0o777).toBe(before);
  });

  it("reports a widened live lock mode without repairing or removing it", () => {
    const dir = tempAuditDir();
    append(dir, "ap-1");
    writeFileSync(auditLockPath(dir), `${JSON.stringify({
      token: "a".repeat(32), pid: process.pid,
      createdAt: new Date().toISOString(), leaseUntil: new Date(Date.now() + 60_000).toISOString()
    })}\n`, { mode: 0o644 });

    const result = verifyApprovalAuditLedger({ dir });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/lock permissions/i);
    expect(statSync(auditLockPath(dir)).mode & 0o777).toBe(0o644);
  });

  it("verify and export are read-only and never create a missing directory or lock", () => {
    const dir = tempAuditDir();
    expect(existsSync(dir)).toBe(false);

    expect(verifyApprovalAuditLedger({ dir })).toEqual({ ok: true, records: 0, headSequence: 0, errors: [] });
    expect(exportApprovalAuditRecords({ dir, format: "json" })).toBe("[]\n");
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(auditLockPath(dir))).toBe(false);
  });

  it("turns a symlink audit directory into a verification result without mutating its target", () => {
    const root = mkdtempSync(join(tmpdir(), "quorate-audit-link-"));
    const target = join(root, "target");
    const dir = join(root, "audit");
    mkdirSync(target, { mode: 0o755 });
    symlinkSync(target, dir);

    const result = verifyApprovalAuditLedger({ dir });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/symlink|real directory/i);
    expect(statSync(target).mode & 0o777).toBe(0o755);
  });

  it("rejects oversized ledgers before unbounded parsing", () => {
    const dir = tempAuditDir();
    append(dir, "ap-1");
    writeFileSync(auditLedgerPath(dir), Buffer.alloc(MAX_AUDIT_LEDGER_BYTES + 1, 0x20), { mode: 0o600 });

    const result = verifyApprovalAuditLedger({ dir });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/too large/i);
  });

  it("caps physical invalid lines and diagnostic amplification independently of valid records", () => {
    const dir = tempAuditDir();
    append(dir, "ap-seed");
    const invalidLines = MAX_AUDIT_RECORDS + 10_000;
    writeFileSync(auditLedgerPath(dir), "{}\n".repeat(invalidLines), { mode: 0o600 });

    const result = verifyApprovalAuditLedger({ dir });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeLessThanOrEqual(MAX_AUDIT_DIAGNOSTICS + 2);
    expect(result.errors.join(" ")).toMatch(/physical|record limit|suppressed/i);
  });

  it.each([
    "July 28 2026",
    "2026-02-30T00:00:00.000Z",
    "2026-07-28T09:00:00",
    "2026-07-28T09:00:00.000+99:00"
  ])("rejects non-RFC3339 or invalid timestamps: %s", (timestamp) => {
    const dir = tempAuditDir();
    expect(() => appendApprovalAuditRecord({
      requestId: "ap-date", runId: "run-1", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "monitor-tui", timestamp
    }, { dir })).toThrow(/RFC 3339/i);
  });

  it("rejects non-RFC3339 and inverted export ranges", () => {
    const dir = tempAuditDir();
    append(dir, "ap-1");
    expect(() => exportApprovalAuditRecords({ dir, since: "yesterday" })).toThrow(/RFC 3339/i);
    expect(() => exportApprovalAuditRecords({ dir, since: "2026-07-29T00:00:00.000Z", until: "2026-07-28T00:00:00.000Z" })).toThrow(/after/i);
  });
});
