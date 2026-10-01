import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteApproval,
  auditDirForLiveDir,
  isMonitorAttached,
  listPendingApprovals,
  readApprovalDecision,
  readMonitorDiscovery,
  reapExpiredApprovals,
  removeMonitorDiscovery,
  writeApprovalDecision,
  writeApprovalRequest,
  writeMonitorDiscovery,
  type ApprovalRequest
} from "../src/live-spool.js";
import { exportApprovalAuditRecords, verifyApprovalAuditLedger } from "../src/trust-ledger.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "quorate-approvals-"));
}

function baseRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "ap-1",
    runId: "run-1",
    source: "claude",
    toolName: "Bash",
    summary: "rm -rf /tmp/x",
    cwd: "/repo",
    createdAt: "2026-07-20T00:00:00.000Z",
    expiresAt: "2026-07-20T00:00:55.000Z",
    ...overrides
  };
}

describe("approvals write/read", () => {
  it("writes a pending request atomically at 0600 and lists it", () => {
    // Arrange
    const dir = tempDir();

    // Act
    writeApprovalRequest(baseRequest({ id: "ap-1" }), dir);

    // Assert
    expect(listPendingApprovals(dir)).toHaveLength(1);
    expect(listPendingApprovals(dir)[0]?.toolName).toBe("Bash");
    const raw = readFileSync(join(dir, "approvals", "ap-1.json"), "utf8");
    expect(JSON.parse(raw).summary).toBe("rm -rf /tmp/x");
  });

  it("truncates the summary to the cap", () => {
    // Arrange
    const dir = tempDir();
    const long = "x".repeat(500);

    // Act
    writeApprovalRequest(baseRequest({ id: "ap-2", summary: long }), dir);

    // Assert
    const stored = listPendingApprovals(dir)[0]?.summary ?? "";
    expect(stored.length).toBeLessThanOrEqual(301); // 300 + ellipsis
  });

  it("rejects unsafe ids before any path use", () => {
    const dir = tempDir();
    expect(() => writeApprovalRequest(baseRequest({ id: "../escape" }), dir)).toThrow(/Unsafe approval id/);
    expect(() => readApprovalDecision("..", dir)).toThrow(/Unsafe approval id/);
    expect(listPendingApprovals(dir)).toHaveLength(0);
  });

  it("does not follow a planted predictable temp-file symlink while writing a request", () => {
    const dir = tempDir();
    const approvals = join(dir, "approvals");
    const victim = join(dir, "victim.txt");
    mkdirSync(approvals, { recursive: true, mode: 0o700 });
    writeFileSync(victim, "keep", { mode: 0o600 });
    symlinkSync(victim, join(approvals, `ap-link.json.${process.pid}.tmp`));

    writeApprovalRequest(baseRequest({ id: "ap-link" }), dir);

    expect(readFileSync(victim, "utf8")).toBe("keep");
  });

  it("reads a decision back once written; a decided request drops out of pending", () => {
    // Arrange
    const dir = tempDir();
    writeApprovalRequest(baseRequest({ id: "ap-3" }), dir);
    expect(listPendingApprovals(dir)).toHaveLength(1);

    // Act — before a decision, nothing resolves.
    expect(readApprovalDecision("ap-3", dir)).toBeUndefined();
    writeApprovalDecision({ id: "ap-3", decision: "allow", decisionSurface: "monitor-tui", decidedAt: "2026-07-20T00:00:10.000Z" }, dir);

    // Assert
    const decision = readApprovalDecision("ap-3", dir);
    expect(decision).toMatchObject({
      id: "ap-3", runId: "run-1", source: "claude", toolName: "Bash", decision: "allow",
      decisionSurface: "monitor-tui", recordHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    // Decided → no longer pending (the monitor's pending list drops it).
    expect(listPendingApprovals(dir)).toHaveLength(0);
    expect(JSON.parse(exportApprovalAuditRecords({ dir: auditDirForLiveDir(dir), format: "json" }))[0]).toMatchObject({
      requestId: "ap-3",
      runId: "run-1",
      source: "claude",
      tool: "Bash",
      decision: "allow",
      decisionSurface: "monitor-tui"
    });
    // deleteApproval removes both files for real.
    deleteApproval("ap-3", dir);
    expect(readApprovalDecision("ap-3", dir)).toBeUndefined();
  });

  it("rejects a structurally complete delivery file that is not bound to a verified ledger record", () => {
    const dir = tempDir();
    const approvals = join(dir, "approvals");
    mkdirSync(approvals, { recursive: true, mode: 0o700 });
    writeFileSync(join(approvals, "ap-fake.decision.json"), `${JSON.stringify({
      id: "ap-fake", runId: "run-1", source: "claude", toolName: "Bash", decision: "allow",
      decisionSurface: "monitor-web", decidedAt: "2026-07-20T00:00:10.000Z", recordHash: "f".repeat(64)
    }, null, 2)}\n`, { mode: 0o600 });

    expect(readApprovalDecision("ap-fake", dir)).toBeUndefined();
  });

  it("lists pending oldest-first; a decided request is no longer pending", () => {
    // Arrange
    const dir = tempDir();
    writeApprovalRequest(baseRequest({ id: "b", createdAt: "2026-07-20T00:00:02.000Z" }), dir);
    writeApprovalRequest(baseRequest({ id: "a", createdAt: "2026-07-20T00:00:01.000Z" }), dir);
    writeApprovalDecision({ id: "a", decision: "deny", decisionSurface: "monitor-web", decidedAt: "2026-07-20T00:00:03.000Z" }, dir);

    // Act
    const pending = listPendingApprovals(dir);

    // Assert — `a` is decided (resolved) so only the undecided `b` is pending.
    expect(pending.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("reapExpiredApprovals", () => {
  it("removes only expired, undecided requests", () => {
    // Arrange
    const dir = tempDir();
    writeApprovalRequest(baseRequest({ id: "expired", expiresAt: "2026-07-20T00:00:01.000Z" }), dir);
    writeApprovalRequest(baseRequest({ id: "fresh", expiresAt: "2026-07-20T00:10:00.000Z" }), dir);
    writeApprovalRequest(baseRequest({ id: "expired-decided", expiresAt: "2026-07-20T00:00:01.000Z" }), dir);
    writeApprovalDecision({ id: "expired-decided", decision: "allow", decisionSurface: "monitor-web", decidedAt: "2026-07-20T00:00:05.000Z" }, dir);

    // Act — now is after the expiry.
    const reaped = reapExpiredApprovals(new Date("2026-07-20T00:00:30.000Z"), dir);

    // Assert
    expect(reaped).toEqual(["expired"]);
    expect(listPendingApprovals(dir).map((p) => p.id)).toEqual(["fresh"]);
    const records = JSON.parse(exportApprovalAuditRecords({ dir: auditDirForLiveDir(dir), format: "json" }));
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: "expired", decision: "timeout", decisionSurface: "approval-reaper" })
    ]));
  });

  it("does not delete an allow/deny winner delivery when an expired timeout loses the race", () => {
    const dir = tempDir();
    const expired = baseRequest({ id: "winner", expiresAt: "2026-07-20T00:00:01.000Z" });
    writeApprovalRequest(expired, dir);
    writeApprovalDecision({
      id: "winner", decision: "allow", decisionSurface: "monitor-web", decidedAt: "2026-07-20T00:00:00.500Z"
    }, dir);
    // Recreate the stale request to simulate a crash before hook acknowledgement.
    writeApprovalRequest(expired, dir);

    reapExpiredApprovals(new Date("2026-07-20T00:00:30.000Z"), dir);

    expect(readApprovalDecision("winner", dir)?.decision).toBe("allow");
    expect(listPendingApprovals(dir)).toHaveLength(0);
  });
});

describe("terminal decision invariant", () => {
  it("keeps the first decision and idempotently reconstructs its bound delivery on a duplicate", () => {
    const dir = tempDir();
    writeApprovalRequest(baseRequest({ id: "ap-race" }), dir);
    writeApprovalDecision(
      { id: "ap-race", decision: "allow", decisionSurface: "monitor-tui", decidedAt: "2026-07-20T00:00:01.000Z" },
      dir
    );

    deleteApproval("ap-race", dir);
    writeApprovalRequest(baseRequest({ id: "ap-race" }), dir);
    const winner = writeApprovalDecision(
      { id: "ap-race", decision: "deny", decisionSurface: "monitor-web", decidedAt: "2026-07-20T00:00:02.000Z" },
      dir
    );
    expect(winner.decision).toBe("allow");
    expect(readApprovalDecision("ap-race", dir)?.decision).toBe("allow");
    expect(verifyApprovalAuditLedger({ dir: auditDirForLiveDir(dir) })).toMatchObject({ ok: true, records: 1 });
  });
});

describe("pending request validation", () => {
  it("skips malformed, oversized, mismatched, and extra-field entries without aborting valid entries", () => {
    const dir = tempDir();
    const approvals = join(dir, "approvals");
    mkdirSync(approvals, { recursive: true, mode: 0o700 });
    writeApprovalRequest(baseRequest({ id: "valid" }), dir);
    writeFileSync(join(approvals, "mismatch.json"), JSON.stringify(baseRequest({ id: "other" })), { mode: 0o600 });
    writeFileSync(join(approvals, "extra.json"), JSON.stringify({ ...baseRequest({ id: "extra" }), prompt: "secret" }), { mode: 0o600 });
    writeFileSync(join(approvals, "bad-date.json"), JSON.stringify(baseRequest({ id: "bad-date", expiresAt: "tomorrow" })), { mode: 0o600 });
    writeFileSync(join(approvals, "huge.json"), "x".repeat(70_000), { mode: 0o600 });
    writeFileSync(join(approvals, "../not-used"), "", { mode: 0o600 });

    expect(listPendingApprovals(dir).map((request) => request.id)).toEqual(["valid"]);
  });

  it("rejects invalid request dates and oversized identity fields at write time", () => {
    const dir = tempDir();
    expect(() => writeApprovalRequest(baseRequest({ id: "bad", createdAt: "today" }), dir)).toThrow(/RFC 3339/i);
    expect(() => writeApprovalRequest(baseRequest({ id: "long", runId: "x".repeat(500) }), dir)).toThrow(/runId/i);
  });
});

describe("monitor discovery + isMonitorAttached", () => {
  it("writes and reads the discovery file", () => {
    const dir = tempDir();
    writeMonitorDiscovery({ url: "http://127.0.0.1:9999/?token=abc", token: "abc", pid: 999999, heartbeatAt: "2026-07-20T00:00:00.000Z" }, dir);
    expect(readMonitorDiscovery(dir)?.url).toContain("9999");
    removeMonitorDiscovery(dir);
    expect(readMonitorDiscovery(dir)).toBeUndefined();
  });

  it("is attached when pid is alive and heartbeat is fresh", () => {
    const dir = tempDir();
    writeMonitorDiscovery({ url: "http://x", token: "t", pid: process.pid, heartbeatAt: new Date().toISOString() }, dir);
    expect(isMonitorAttached({ dir })).toBe(true);
  });

  it("is NOT attached when pid is dead (injectable)", () => {
    const dir = tempDir();
    writeMonitorDiscovery({ url: "http://x", token: "t", pid: 999999, heartbeatAt: new Date().toISOString() }, dir);
    expect(isMonitorAttached({ dir, pidAlive: () => false })).toBe(false);
  });

  it("is NOT attached when the heartbeat is stale", () => {
    const dir = tempDir();
    writeMonitorDiscovery({ url: "http://x", token: "t", pid: process.pid, heartbeatAt: "2020-01-01T00:00:00.000Z" }, dir);
    expect(isMonitorAttached({ dir })).toBe(false);
  });

  it("is NOT attached when no discovery file exists", () => {
    const dir = tempDir();
    expect(isMonitorAttached({ dir })).toBe(false);
  });
});
