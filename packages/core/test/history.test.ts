import { describe, expect, it } from "vitest";

import { computeStats, toHistoryEntry } from "../src/history.js";
import type { CouncilReport, Finding } from "../src/types.js";

function finding(o: Partial<Finding> = {}): Finding {
  return { severity: "high", title: "SQL injection", body: "x", file: "src/a.ts", ...o };
}

function report(
  findings: Finding[],
  overrides: Partial<CouncilReport> = {},
  providerResults?: CouncilReport["providerResults"]
): CouncilReport {
  const base: CouncilReport = {
    verdict: findings.some((f) => f.severity === "critical" || f.severity === "high") ? "fail" : "pass",
    summary: "x",
    findings,
    providerResults: providerResults ?? [
      { providerId: "glm", role: "security", providerType: "api", status: "ok", summary: "ok", findings, durationMs: 1 }
    ],
    metadata: {
      generatedAt: "2026-06-15T00:00:00.000Z",
      mode: "review",
      subject: "PR #1",
      providers: ["glm:security"],
      requestedProviders: ["glm:security"],
      ranProviders: ["glm:security"],
      degraded: false,
      reviewId: "abc123def456abc1"
    }
  };
  return { ...base, ...overrides, metadata: { ...base.metadata, ...overrides.metadata } };
}

describe("toHistoryEntry", () => {
  it("projects a report to a compact, reviewId-keyed history entry", () => {
    const r = report([finding({ severity: "high", file: "src/a.ts" }), finding({ severity: "medium", title: "Perf", file: "src/b.ts" })]);
    const entry = toHistoryEntry(r);
    expect(entry.reviewId).toBe("abc123def456abc1");
    expect(entry.verdict).toBe("fail");
    expect(entry.degraded).toBe(false);
    expect(entry.findingCounts).toEqual({ high: 1, medium: 1 });
    expect(entry.byFile).toEqual({ "src/a.ts": 1, "src/b.ts": 1 });
    expect(entry.byTitle).toEqual({ "SQL injection": 1, Perf: 1 });
  });

  it("omits suppressed findings from the counts (they don't gate)", () => {
    const r = report([
      finding({ severity: "high", file: "a.ts" }),
      finding({ severity: "critical", title: "Accepted", file: "b.ts", status: "suppressed" })
    ]);
    const entry = toHistoryEntry(r);
    expect(entry.findingCounts).toEqual({ high: 1 }); // suppressed critical excluded
    expect(entry.byFile).toEqual({ "a.ts": 1 });
  });

  it("omits byFile when a finding has no file", () => {
    const entry = toHistoryEntry(report([finding({ file: undefined })]));
    expect(entry.byFile).toEqual({});
  });

  it("records provider status for failure-rate stats", () => {
    const r = report([], {}, [
      { providerId: "glm", role: "security", providerType: "api", status: "ok", summary: "", findings: [], durationMs: 1 },
      { providerId: "claude", role: "architect", providerType: "cli", status: "error", summary: "", findings: [], durationMs: 1 }
    ]);
    const entry = toHistoryEntry(r);
    expect(entry.providerResults).toEqual([
      { providerId: "glm", status: "ok" },
      { providerId: "claude", status: "error" }
    ]);
  });

  it("caps byFile/byTitle maps to the top-N buckets (bounds line size)", () => {
    const findings = Array.from({ length: 80 }, (_, i) =>
      finding({ title: `Issue ${i}`, file: `src/f${i}.ts`, severity: "low" })
    );
    const entry = toHistoryEntry(report(findings));
    expect(Object.keys(entry.byFile).length).toBeLessThanOrEqual(50);
    expect(Object.keys(entry.byTitle).length).toBeLessThanOrEqual(50);
    // findingCounts (by severity) is NOT capped — only 5 severities exist
    expect(entry.findingCounts).toEqual({ low: 80 });
  });
});

describe("computeStats", () => {
  const entries = [
    toHistoryEntry(report([finding({ severity: "high", file: "a.ts" })], { reviewId: "r1", verdict: "fail" })),
    toHistoryEntry(report([finding({ severity: "medium", file: "a.ts" })], { reviewId: "r2", verdict: "warn" })),
    toHistoryEntry(report([], { reviewId: "r3", verdict: "pass" }))
  ];

  it("aggregates verdict distribution and run count", () => {
    const stats = computeStats(entries);
    expect(stats.runs).toBe(3);
    expect(stats.verdictCounts).toEqual({ pass: 1, warn: 1, fail: 1 });
  });

  it("ranks the noisiest files and titles", () => {
    const stats = computeStats(entries);
    expect(stats.topFiles[0]).toEqual({ file: "a.ts", count: 2 });
    expect(stats.topTitles[0]).toEqual({ title: "SQL injection", count: 2 });
  });

  it("computes per-severity totals", () => {
    const stats = computeStats(entries);
    expect(stats.severityCounts).toEqual({ high: 1, medium: 1 });
  });

  it("respects a --since cutoff (ISO date)", () => {
    // all entries share generatedAt 2026-06-15; a later cutoff yields zero runs
    const stats = computeStats(entries, { since: "2026-07-01T00:00:00.000Z" });
    expect(stats.runs).toBe(0);
  });

  it("computes provider failure rates", () => {
    const stats = computeStats([
      toHistoryEntry(
        report([], {}, [
          { providerId: "glm", role: "s", providerType: "api", status: "ok", summary: "", findings: [], durationMs: 1 },
          { providerId: "glm", role: "s", providerType: "api", status: "error", summary: "", findings: [], durationMs: 1 }
        ])
      )
    ]);
    const glm = stats.providerFailureRates.find((p) => p.providerId === "glm");
    expect(glm?.runs).toBe(2);
    expect(glm?.failures).toBe(1);
  });

  it("handles an empty entry list without throwing", () => {
    const stats = computeStats([]);
    expect(stats.runs).toBe(0);
    expect(stats.topFiles).toEqual([]);
  });
});
