import { appendFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CouncilReport, Finding } from "@quorate/core";

import {
  appendHistory,
  appendHistoryNow,
  formatHistoryTable,
  formatStatsReport,
  historyPath,
  readHistory
} from "../src/history-command.js";
import { buildProgram } from "../src/index.js";
import { computeStats } from "@quorate/core";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quorate-hist-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function finding(o: Partial<Finding> = {}): Finding {
  return { severity: "high", title: "SQL injection", body: "x", file: "src/a.ts", ...o };
}

function report(
  findings: Finding[],
  verdict: CouncilReport["verdict"] = "fail",
  at = "2026-06-15T00:00:00.000Z",
  reviewId = "abc123"
): CouncilReport {
  return {
    verdict,
    summary: "x",
    findings,
    providerResults: [{ providerId: "glm", role: "security", providerType: "api", status: "ok", summary: "ok", findings, durationMs: 1 }],
    metadata: {
      generatedAt: at,
      mode: "review",
      subject: "PR #1",
      providers: ["glm:security"],
      requestedProviders: ["glm:security"],
      ranProviders: ["glm:security"],
      degraded: false,
      reviewId
    }
  };
}

function captureConsoleLog(): string[] {
  const output: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
    output.push(String(message));
  });
  return output;
}

describe("appendHistory / readHistory", () => {
  it("appends and reads entries back newest-first", async () => {
    await appendHistoryNow(dir, report([finding()], "fail", "2026-06-15T00:00:00.000Z", "r1"));
    await appendHistoryNow(dir, report([], "pass", "2026-06-16T00:00:00.000Z", "r2"));
    const entries = await readHistory(dir);
    expect(entries).toHaveLength(2);
    expect(entries[0].verdict).toBe("pass");
    expect(entries[1].verdict).toBe("fail");
  });

  it("writes the history file with user-only permissions", async () => {
    await appendHistoryNow(dir, report([]));
    const mode = statSync(historyPath(dir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("is a no-op when fire-and-forget append fails", () => {
    expect(() => appendHistory(join(join(dir, "blocker"), "x"), report([]))).not.toThrow();
  });

  it("returns [] when no history exists", async () => {
    expect(await readHistory(dir)).toEqual([]);
  });

  it("skips corrupt lines instead of failing the whole read", async () => {
    await appendHistoryNow(dir, report([finding()], "fail"));
    appendFileSync(historyPath(dir), "this is not json\n", "utf8");
    const entries = await readHistory(dir);
    expect(entries).toHaveLength(1);
  });

  it("dedupes repeated review ids and keeps the newest entry", async () => {
    await appendHistoryNow(dir, report([finding()], "fail", "2026-06-15T00:00:00.000Z", "same"));
    await appendHistoryNow(dir, report([], "pass", "2026-06-16T00:00:00.000Z", "same"));
    const entries = await readHistory(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].verdict).toBe("pass");
  });

  it("honors a bounded recent-read limit", async () => {
    await appendHistoryNow(dir, report([], "pass", "2026-06-14T00:00:00.000Z", "r1"));
    await appendHistoryNow(dir, report([], "warn", "2026-06-15T00:00:00.000Z", "r2"));
    await appendHistoryNow(dir, report([], "fail", "2026-06-16T00:00:00.000Z", "r3"));
    const entries = await readHistory(dir, { limit: 2 });
    expect(entries.map((entry) => entry.verdict)).toEqual(["fail", "warn"]);
  });
});

describe("historyPath", () => {
  it("is stable per cwd and lives outside the repo", () => {
    expect(historyPath(dir)).not.toContain(dir);
    expect(historyPath(dir)).toBe(historyPath(dir));
  });
});

describe("formatHistoryTable / formatStatsReport", () => {
  it("renders a non-empty history table with sanitized subjects", async () => {
    const unsafe = report([finding()], "fail");
    unsafe.metadata.subject = "\u001b[31mPR #1\u001b[0m\nInjected";
    await appendHistoryNow(dir, unsafe);
    const out = formatHistoryTable(await readHistory(dir));
    expect(out).toContain("FAIL");
    expect(out).toContain("PR #1 Injected");
    expect(out).not.toContain("\u001b");
  });

  it("reports 'No reviews' on an empty store", () => {
    expect(formatHistoryTable([])).toMatch(/No reviews/i);
  });

  it("formats stats without throwing on an empty store", () => {
    expect(formatStatsReport(computeStats([]))).toContain("0 review");
  });
});

describe("history/stats commands", () => {
  it("prints machine-readable history JSON with --limit", async () => {
    await appendHistoryNow(dir, report([], "pass", "2026-06-16T00:00:00.000Z", "cmd"));
    const output = captureConsoleLog();
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "quorate", "--cwd", dir, "history", "--limit", "1", "--json"], { from: "node" });
    expect(JSON.parse(output.join("\n"))).toHaveLength(1);
  });

  it("rejects invalid history limits and stats dates", async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "quorate", "--cwd", dir, "history", "--limit", "wat"], { from: "node" });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;

    await program.parseAsync(["node", "quorate", "--cwd", dir, "stats", "--since", "not-a-date"], { from: "node" });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
