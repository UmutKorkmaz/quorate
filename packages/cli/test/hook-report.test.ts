import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  dispatchHook,
  foreignRunId,
  newApprovalId,
  parseHookPayload,
  runPermissionRoundtrip,
  summarizeToolInput,
  type HookReportDeps
} from "../src/hook-report.js";
import { auditDirForLiveDir } from "../src/live-spool.js";
import { exportApprovalAuditRecords } from "../src/trust-ledger.js";
import { listPendingApprovals, readMonitorDiscovery, writeMonitorDiscovery, writeApprovalDecision, type ApprovalRequest } from "../src/live-spool.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "quorate-hook-"));
}

function deps(dir: string, overrides: Partial<HookReportDeps> = {}): HookReportDeps {
  return { dir, cwd: "/repo", pid: 4242, ...overrides };
}

describe("parseHookPayload", () => {
  it("parses a Claude session_id payload", () => {
    expect(parseHookPayload('{"session_id":"abc-123","cwd":"/r"}')).toEqual({ sessionId: "abc-123", cwd: "/r" });
  });

  it("parses tool_name + tool_input variants", () => {
    const parsed = parseHookPayload('{"tool_name":"Bash","tool_input":{"command":"ls"}}');
    expect(parsed?.toolName).toBe("Bash");
    expect(parsed?.toolInput).toEqual({ command: "ls" });
  });

  it("returns undefined for malformed/empty input", () => {
    expect(parseHookPayload("")).toBeUndefined();
    expect(parseHookPayload("not json")).toBeUndefined();
    expect(parseHookPayload("[]")).toBeUndefined();
    expect(parseHookPayload("null")).toBeUndefined();
  });
});

describe("foreignRunId + summarizeToolInput", () => {
  it("builds a charset-safe runId", () => {
    expect(foreignRunId("claude", "abc 123!")).toBe("claude-abc-123-");
    expect(foreignRunId("claude", undefined)).toBeUndefined();
    expect(foreignRunId("claude", "---")).toBe("claude----");
  });

  it("prefers command then path then pattern in the summary", () => {
    expect(summarizeToolInput("Bash", { command: "ls -la" })).toBe("Bash: ls -la");
    expect(summarizeToolInput("Edit", { file_path: "/a.ts" })).toBe("Edit: /a.ts");
    expect(summarizeToolInput("Grep", { pattern: "TODO" })).toBe("Grep: /TODO/");
    expect(summarizeToolInput("Bash", "raw string")).toBe("raw string");
    expect(summarizeToolInput(undefined, undefined)).toBe("(no detail)");
  });
});

describe("dispatchHook event mapping", () => {
  it("SessionStart creates an external run + council/started + session lane", () => {
    // Arrange
    const dir = tempDir();
    const payload = parseHookPayload('{"session_id":"sess-A","prompt":"write a test","cwd":"/r"}')!;

    // Act
    const outcome = dispatchHook("claude", "SessionStart", payload, deps(dir));

    // Assert — defer to the agent; the run is now in the spool.
    expect(outcome).toEqual({ action: "defer" });
    const runId = foreignRunId("claude", "sess-A");
    const meta = JSON.parse(readFileSync(join(dir, `${runId}.meta.json`), "utf8"));
    expect(meta).toMatchObject({ runId, source: "claude", kind: "external", status: "running", mode: "agent" });
    const spool = readFileSync(join(dir, `${runId}.ndjson`), "utf8");
    expect(spool).toContain('"council/started"');
    expect(spool).toContain('"provider/started"');
    expect(spool).toContain('"role":"session"');
  });

  it("UserPromptSubmit updates subject and emits a chunk", () => {
    const dir = tempDir();
    const payload = parseHookPayload('{"session_id":"sess-B","prompt":"first line\\nsecond"}')!;
    dispatchHook("claude", "SessionStart", parseHookPayload('{"session_id":"sess-B"}')!, deps(dir));
    dispatchHook("claude", "UserPromptSubmit", payload, deps(dir));
    const runId = foreignRunId("claude", "sess-B");
    const spool = readFileSync(join(dir, `${runId}.ndjson`), "utf8");
    expect(spool).toContain("» first line");
  });

  it("PreToolUse and PostToolUse emit non-blocking chunks and defer", () => {
    const dir = tempDir();
    dispatchHook("claude", "SessionStart", parseHookPayload('{"session_id":"sess-C"}')!, deps(dir));
    const runId = foreignRunId("claude", "sess-C");
    const before = dispatchHook("claude", "PreToolUse", parseHookPayload('{"session_id":"sess-C","tool_name":"Read"}')!, deps(dir));
    const after = dispatchHook("claude", "PostToolUse", parseHookPayload('{"session_id":"sess-C","tool_name":"Read"}')!, deps(dir));
    expect(before).toEqual({ action: "defer" });
    expect(after).toEqual({ action: "defer" });
    const spool = readFileSync(join(dir, `${runId}.ndjson`), "utf8");
    expect(spool).toContain("tool: Read");
    expect(spool).toContain("done: Read");
  });

  it("SubagentStart/Stop open and close a task lane", () => {
    const dir = tempDir();
    dispatchHook("claude", "SessionStart", parseHookPayload('{"session_id":"sess-D"}')!, deps(dir));
    const runId = foreignRunId("claude", "sess-D");
    dispatchHook("claude", "SubagentStart", parseHookPayload('{"session_id":"sess-D","subagent_id":"agent-7"}')!, deps(dir));
    dispatchHook("claude", "SubagentStop", parseHookPayload('{"session_id":"sess-D","subagent_id":"agent-7"}')!, deps(dir));
    const spool = readFileSync(join(dir, `${runId}.ndjson`), "utf8");
    expect(spool).toContain('"role":"task-agent-7"');
    expect(spool).toContain('"provider/done"');
  });

  it("Notification emits the text; Stop emits turn ended; SessionEnd seals done", () => {
    const dir = tempDir();
    dispatchHook("claude", "SessionStart", parseHookPayload('{"session_id":"sess-E"}')!, deps(dir));
    const runId = foreignRunId("claude", "sess-E");
    dispatchHook("claude", "Notification", parseHookPayload('{"session_id":"sess-E","message":"waiting for input"}')!, deps(dir));
    dispatchHook("claude", "Stop", parseHookPayload('{"session_id":"sess-E"}')!, deps(dir));
    dispatchHook("claude", "SessionEnd", parseHookPayload('{"session_id":"sess-E"}')!, deps(dir));
    const spool = readFileSync(join(dir, `${runId}.ndjson`), "utf8");
    expect(spool).toContain("waiting for input");
    expect(spool).toContain("turn ended");
    const meta = JSON.parse(readFileSync(join(dir, `${runId}.meta.json`), "utf8"));
    expect(meta.status).toBe("done");
  });

  it("PermissionRequest returns a permission outcome, defers all other unknown events", () => {
    const dir = tempDir();
    const runId = foreignRunId("claude", "sess-F");
    dispatchHook("claude", "SessionStart", parseHookPayload('{"session_id":"sess-F"}')!, deps(dir));
    const outcome = dispatchHook("claude", "PermissionRequest", parseHookPayload('{"session_id":"sess-F","tool_name":"Bash","tool_input":{"command":"rm -rf x"}}')!, deps(dir));
    expect(outcome.action).toBe("permission");
    if (outcome.action === "permission") {
      expect(outcome.runId).toBe(runId);
      expect(outcome.toolName).toBe("Bash");
      expect(outcome.summary).toContain("rm -rf x");
    }
  });

  it("defers when no session id resolves", () => {
    const dir = tempDir();
    expect(dispatchHook("claude", "UserPromptSubmit", { prompt: "x" }, deps(dir))).toEqual({ action: "defer" });
  });
});

describe("runPermissionRoundtrip", () => {
  function attach(dir: string): void {
    writeMonitorDiscovery({ url: "http://127.0.0.1:1/?token=t", token: "t", pid: process.pid, heartbeatAt: new Date().toISOString() }, dir);
  }

  function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
    return {
      id: "ap-1",
      runId: "claude-sess",
      source: "claude",
      toolName: "Bash",
      summary: "ls",
      cwd: "/r",
      createdAt: "2026-07-20T00:00:00.000Z",
      expiresAt: "2026-07-20T00:00:55.000Z",
      ...overrides
    };
  }

  it("defers silently when no monitor is attached", () => {
    const dir = tempDir();
    const result = runPermissionRoundtrip({ runId: "claude-sess", source: "claude", toolName: "Bash", summary: "ls", id: "ap-1" }, deps(dir));
    expect(result.stdout).toBeUndefined();
  });

  it("defers when the monitor dies mid-wait (cleanup happens)", () => {
    // Arrange — attached at first, but isAttached flips false after one tick.
    const dir = tempDir();
    attach(dir);
    let calls = 0;
    const isAttached = () => {
      calls++;
      return calls <= 1; // alive only on the first probe
    };
    const times: number[] = [0, 1_100]; // second probe crosses the recheck window
    let tick = 0;
    const now = () => new Date(times[Math.min(tick++, times.length - 1)]);

    // Act
    const result = runPermissionRoundtrip(
      { runId: "claude-sess", source: "claude", toolName: "Bash", summary: "ls", id: "ap-died" },
      deps(dir, { isAttached, now, sleep: () => undefined })
    );

    // Assert
    expect(result.stdout).toBeUndefined();
    expect(readMonitorDiscovery(dir)?.url).toBeDefined(); // discovery file untouched
  });

  it("emits the allow decision JSON when the monitor approves", () => {
    const dir = tempDir();
    attach(dir);
    let calls = 0;
    // Approve on the second poll.
    const isAttached = () => true;
    const sleep = () => {
      calls++;
      if (calls === 1) writeApprovalDecision({ id: "ap-allow", decision: "allow", decisionSurface: "monitor-tui", decidedAt: "2026-07-20T00:00:01.000Z" }, dir);
    };
    const result = runPermissionRoundtrip(
      { runId: "claude-sess", source: "claude", toolName: "Bash", summary: "ls", id: "ap-allow" },
      deps(dir, { isAttached, sleep, now: () => new Date(0) })
    );
    expect(JSON.parse(result.stdout!)).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } }
    });
  });

  it("emits the deny decision JSON with a message when denied", () => {
    const dir = tempDir();
    attach(dir);
    const isAttached = () => true;
    let calls = 0;
    const sleep = () => {
      calls++;
      if (calls === 1) writeApprovalDecision({ id: "ap-deny", decision: "deny", reasonCode: "user-denied", decisionSurface: "monitor-web", decidedAt: "2026-07-20T00:00:01.000Z" }, dir);
    };
    const result = runPermissionRoundtrip(
      { runId: "claude-sess", source: "claude", toolName: "Bash", summary: "ls", id: "ap-deny" },
      deps(dir, { isAttached, sleep, now: () => new Date(0) })
    );
    const parsed = JSON.parse(result.stdout!);
    expect(parsed.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(parsed.hookSpecificOutput.decision.message).toBe("Denied from Quorate monitor");
  });

  it("ignores a forged allow delivery file that has no verified ledger record", () => {
    const dir = tempDir();
    attach(dir);
    mkdirSync(join(dir, "approvals"), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "approvals", "ap-forged.decision.json"), JSON.stringify({
      id: "ap-forged", decision: "allow", decisionSurface: "monitor-web", decidedAt: new Date(0).toISOString()
    }), { mode: 0o600 });
    const times = [0, 56_000];
    let tick = 0;

    const result = runPermissionRoundtrip(
      { runId: "claude-sess", source: "claude", toolName: "Bash", summary: "ls", id: "ap-forged" },
      deps(dir, { isAttached: () => true, now: () => new Date(times[Math.min(tick++, 1)]), sleep: () => undefined })
    );

    expect(result.stdout).toBeUndefined();
    expect(JSON.parse(exportApprovalAuditRecords({ dir: auditDirForLiveDir(dir), format: "json" }))[0]).toMatchObject({
      requestId: "ap-forged", decision: "timeout"
    });
  });

  it("enforces the signed winner when decision-file publication crashes after ledger commit", () => {
    const dir = tempDir();
    attach(dir);
    let calls = 0;
    const result = runPermissionRoundtrip(
      { runId: "claude-sess", source: "claude", toolName: "Bash", summary: "ls", id: "ap-crash-delivery" },
      deps(dir, {
        isAttached: () => true,
        now: () => new Date(0),
        sleep: () => {
          calls += 1;
          if (calls === 1) {
            expect(() => writeApprovalDecision(
              { id: "ap-crash-delivery", decision: "allow", decisionSurface: "monitor-web", decidedAt: "1970-01-01T00:00:01.000Z" },
              dir,
              { fault: (point) => { if (point === "after-ledger-commit") throw new Error("delivery crash"); } }
            )).toThrow("delivery crash");
          }
        }
      })
    );

    expect(JSON.parse(result.stdout!)).toMatchObject({ hookSpecificOutput: { decision: { behavior: "allow" } } });
  });

  it("fails closed and preserves the pending request on a non-duplicate audit failure", () => {
    const dir = tempDir();
    attach(dir);
    mkdirSync(auditDirForLiveDir(dir), { recursive: true, mode: 0o700 });
    chmodSync(auditDirForLiveDir(dir), 0o755);
    const times = [0, 56_000];
    let tick = 0;

    const result = runPermissionRoundtrip(
      { runId: "claude-sess", source: "claude", toolName: "Bash", summary: "ls", id: "ap-audit-fail" },
      deps(dir, { isAttached: () => true, now: () => new Date(times[Math.min(tick++, 1)]), sleep: () => undefined })
    );

    expect(JSON.parse(result.stdout!)).toMatchObject({ hookSpecificOutput: { decision: { behavior: "deny" } } });
    expect(listPendingApprovals(dir).map((request) => request.id)).toContain("ap-audit-fail");
  });

  it("defers after the 55s hard cap without a decision", () => {
    const dir = tempDir();
    attach(dir);
    const isAttached = () => true;
    const times = [0, 56_000];
    let tick = 0;
    const now = () => new Date(times[Math.min(tick++, times.length - 1)]);
    const result = runPermissionRoundtrip(
      { runId: "claude-sess", source: "claude", toolName: "Bash", summary: "ls", id: "ap-timeout" },
      deps(dir, { isAttached, now, sleep: () => undefined })
    );
    expect(result.stdout).toBeUndefined();
    const records = JSON.parse(exportApprovalAuditRecords({ dir: auditDirForLiveDir(dir), format: "json" }));
    expect(records).toEqual([
      expect.objectContaining({
        requestId: "ap-timeout",
        decision: "timeout",
        decisionSurface: "hook-timeout"
      })
    ]);
  });
});

describe("newApprovalId", () => {
  it("produces collision-resistant, fixed-width safe ids at the same timestamp", () => {
    // The timestamp intentionally stays fixed: uniqueness must come from the
    // unpredictable suffix, not millisecond timing.
    const ids = new Set(Array.from({ length: 1_000 }, () => newApprovalId(new Date(0))));

    expect(ids.size).toBe(1_000);
    for (const id of ids) expect(id).toMatch(/^ap-0-[a-f0-9]{12}$/);
  });

  it("does not fall back to Math.random for approval identifiers", () => {
    // A predictable PRNG makes a concurrent local approval race guessable.
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("approval ids must use a cryptographic RNG");
    });

    expect(() => newApprovalId(new Date(0))).not.toThrow();
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});
