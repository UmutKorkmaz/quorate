import { describe, expect, it } from "vitest";
import type { CouncilReport } from "@quorate/core";
import { compareCouncilReports, compareSessionSummaries } from "../src/sessions.js";

function sampleReport(verdict: CouncilReport["verdict"], title: string): CouncilReport {
  return {
    verdict,
    summary: `${verdict} summary`,
    findings: [{ severity: "high", title, body: "detail" }],
    providerResults: [],
    metadata: {
      generatedAt: "now",
      mode: "review",
      subject: "s",
      providers: [],
      requestedProviders: [],
      ranProviders: [],
      degraded: false
    }
  };
}

describe("session compare helpers", () => {
  it("compares session summaries", () => {
    const text = compareSessionSummaries(
      { label: "A", summary: { verdict: "pass", summary: "clean", findings: 0, degraded: false } },
      { label: "B", summary: { verdict: "warn", summary: "issues", findings: 2, degraded: true } }
    );
    expect(text).toContain("PASS → WARN");
    expect(text).toContain("Findings: 0 → 2");
  });

  it("compares full council reports", () => {
    const left = sampleReport("pass", "Old issue");
    const right = sampleReport("warn", "New issue");
    const text = compareCouncilReports(left, right, { left: "left.json", right: "right.json" });
    expect(text).toContain("Only in A");
    expect(text).toContain("Only in B");
    expect(text).toContain("[high] Old issue");
    expect(text).toContain("[high] New issue");
  });
});