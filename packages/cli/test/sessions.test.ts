import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultConfig, type CouncilReport } from "@quorate/core";
import type { SessionState } from "../src/session.js";
import {
  applyPersistedSession,
  createSessionId,
  formatSessionLine,
  hashDiff,
  latestSession,
  listSessions,
  loadSession,
  repoHash,
  saveSession,
  sessionFromState,
  sessionPath,
  sessionsDir,
  summarizeReport,
  type PersistedSession
} from "../src/sessions.js";

const riskyDiff = `diff --git a/src/example.test.ts b/src/example.test.ts
--- a/src/example.test.ts
+++ b/src/example.test.ts
@@ -1,3 +1,5 @@
+const apiKey = "sk-example-secret-value";
+test.only("focused", () => {});
`;

function makeReport(): CouncilReport {
  return {
    verdict: "fail",
    summary: "Secrets and focused tests detected",
    findings: [{ title: "Possible secret", severity: "high", body: "x", file: "a.ts", line: 1 }],
    providerResults: [],
    metadata: {
      generatedAt: "now",
      mode: "review",
      subject: "s",
      providers: ["heuristic"],
      requestedProviders: ["heuristic"],
      ranProviders: ["heuristic"],
      degraded: true
    }
  };
}

function makeState(cwd: string, overrides: Partial<SessionState> = {}): SessionState {
  return {
    cwd,
    config: createDefaultConfig([]),
    mode: "review",
    diff: riskyDiff,
    diffLabel: "sample.diff",
    activeProviders: ["heuristic"],
    activeRoles: ["security"],
    transcript: [{ input: "/review smoke", at: "2026-06-08T12:00:00.000Z" }],
    sessionId: "session-abc",
    sessionName: "Smoke session",
    lastReport: makeReport(),
    ...overrides
  };
}

const tempCwds: string[] = [];

function tempCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "quorate-sessions-"));
  tempCwds.push(dir);
  return dir;
}

afterEach(() => {
  for (const cwd of tempCwds.splice(0)) {
    const dir = sessionsDir(cwd);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("repoHash and hashDiff", () => {
  it("produces stable short hashes", () => {
    const cwd = tempCwd();
    expect(repoHash(cwd)).toHaveLength(16);
    expect(repoHash(cwd)).toBe(repoHash(cwd));
    expect(hashDiff(riskyDiff)).toHaveLength(16);
    expect(hashDiff(riskyDiff)).toBe(hashDiff(riskyDiff));
  });
});

describe("sessionFromState and summarizeReport", () => {
  it("maps live state into a persisted snapshot with transcript tail and report summary", () => {
    const cwd = tempCwd();
    const state = makeState(cwd);
    const snapshot = sessionFromState(state);

    expect(snapshot.id).toBe("session-abc");
    expect(snapshot.name).toBe("Smoke session");
    expect(snapshot.mode).toBe("review");
    expect(snapshot.diffLabel).toBe("sample.diff");
    expect(snapshot.diffHash).toBe(hashDiff(riskyDiff));
    expect(snapshot.activeProviders).toEqual(["heuristic"]);
    expect(snapshot.activeRoles).toEqual(["security"]);
    expect(snapshot.transcriptTail).toEqual([{ input: "/review smoke", at: "2026-06-08T12:00:00.000Z" }]);
    expect(snapshot.lastReportSummary).toEqual({
      verdict: "fail",
      summary: "Secrets and focused tests detected",
      findings: 1,
      degraded: true
    });
    expect(summarizeReport(makeReport()).findings).toBe(1);
  });

  it("generates ids and names when session metadata is missing", () => {
    const cwd = tempCwd();
    const snapshot = sessionFromState(makeState(cwd, { sessionId: undefined, sessionName: undefined, diffLabel: undefined }));
    expect(snapshot.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(snapshot.name).toMatch(/^Session /);
    expect(createSessionId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("saveSession and loadSession", () => {
  it("round-trips a persisted session under ~/.quorate/sessions/<repoHash>", () => {
    const cwd = tempCwd();
    const session: PersistedSession = {
      id: "persist-1",
      name: "Saved review",
      timestamp: "2026-06-08T12:00:00.000Z",
      mode: "review",
      diffLabel: "sample.diff",
      diffHash: hashDiff(riskyDiff),
      activeProviders: ["heuristic"],
      transcriptTail: []
    };

    saveSession(cwd, session);

    const path = sessionPath(cwd, session.id);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      id: "persist-1",
      name: "Saved review",
      diffLabel: "sample.diff"
    });
    expect(loadSession(cwd, "persist-1")).toEqual(session);
    expect(loadSession(cwd, "missing")).toBeUndefined();
  });

  it("lists sessions newest-first and returns the latest entry", () => {
    const cwd = tempCwd();
    saveSession(cwd, {
      id: "older",
      name: "Older",
      timestamp: "2026-06-08T10:00:00.000Z",
      mode: "review",
      transcriptTail: []
    });
    saveSession(cwd, {
      id: "newer",
      name: "Newer",
      timestamp: "2026-06-08T12:00:00.000Z",
      mode: "plan",
      transcriptTail: []
    });

    const listed = listSessions(cwd);
    expect(listed.map((entry) => entry.id)).toEqual(["newer", "older"]);
    expect(latestSession(cwd)?.id).toBe("newer");
    expect(formatSessionLine(listed[0])).toContain("Newer");
  });
});

describe("applyPersistedSession", () => {
  it("maps a snapshot onto partial live state without restoring diff bodies", () => {
    const restored = applyPersistedSession({
      id: "resume-1",
      name: "Resume me",
      timestamp: "2026-06-08T12:00:00.000Z",
      mode: "plan",
      diffLabel: "main...HEAD",
      activeProviders: ["codex"],
      activeRoles: ["qa"],
      transcriptTail: [{ input: "/plan auth", at: "2026-06-08T11:00:00.000Z" }]
    });

    expect(restored).toEqual({
      sessionId: "resume-1",
      sessionName: "Resume me",
      mode: "plan",
      diffLabel: "main...HEAD",
      activeProviders: ["codex"],
      activeRoles: ["qa"],
      transcript: [{ input: "/plan auth", at: "2026-06-08T11:00:00.000Z" }]
    });
    expect(restored).not.toHaveProperty("diff");
  });
});