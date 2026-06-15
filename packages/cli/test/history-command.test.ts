import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CouncilReport, Finding } from "@quorate/core";

import { appendHistory, historyPath, readHistory, formatHistoryTable, formatStatsReport } from "../src/history-command.js";
import { computeStats, toHistoryEntry } from "@quorate/core";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quorate-hist-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function finding(o: Partial<Finding> = {}): Finding {
  return { severity: "high", title: "SQL injection", body: "x", file: "src/a.ts", ...o };
}

function report(findings: Finding[], verdict: CouncilReport["verdict"] = "fail", at = "2026-06-15T00:00:00.000Z"): CouncilReport {
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
      reviewId: "abc123"
    }
  };
}

describe("appendHistory / readHistory", () => {
  it("appends and reads entries back (newest-first)", () => {
    appendHistory(dir, report([finding()], "fail", "2026-06-15T00:00:00.000Z"));
    appendHistory(dir, report([], "pass", "2026-06-16T00:00:00.000Z"));
    const entries = readHistory(dir);
    expect(entries).toHaveLength(2);
    // newest-first: the later (pass) entry is first
    expect(entries[0].verdict).toBe("pass");
    expect(entries[1].verdict).toBe("fail");
  });

  it("is a no-op (never throws) when the store can't be written", () => {
    // Point at a path under a file (not a dir) so mkdir fails — must not throw.
    expect(() => appendHistory(join(join(dir, "blocker"), "x"), report([]))).not.toThrow();
  });

  it("returns [] when no history exists", () => {
    expect(readHistory(dir)).toEqual([]);
  });

  it("skips corrupt/half-written lines instead of failing the whole read", () => {
    appendHistory(dir, report([finding()], "fail"));
    // Corrupt the file: append a broken line in the middle.
    const path = historyPath(dir);
    appendFileSync(path, "this is not json\n", "utf8");
    const entries = readHistory(dir);
    expect(entries).toHaveLength(1); // corrupt line skipped
  });
});

describe("historyPath", () => {
  it("is stable per cwd and lives outside the repo", () => {
    expect(historyPath(dir)).not.toContain(dir);
    expect(historyPath(dir)).toBe(historyPath(dir));
  });
});

describe("formatHistoryTable / formatStatsReport", () => {
  it("renders a non-empty history table", () => {
    appendHistory(dir, report([finding()], "fail"));
    const out = formatHistoryTable(readHistory(dir));
    expect(out).toContain("FAIL");
    expect(out).toContain("PR #1"); // subject present
  });

  it("reports 'No reviews' on an empty store", () => {
    expect(formatHistoryTable([])).toMatch(/No reviews/i);
  });

  it("formats stats without throwing on an empty store", () => {
    expect(formatStatsReport(computeStats([]))).toContain("0 review");
  });
});
