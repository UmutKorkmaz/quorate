import { describe, expect, it } from "vitest";
import { renderMarkdownReport } from "../src/render.js";
import type { CouncilReport } from "../src/types.js";

function report(degraded: boolean): CouncilReport {
  return {
    verdict: "pass",
    summary: "No blocking issues.",
    findings: [],
    providerResults: [
      {
        providerId: "heuristic",
        role: "maintainer",
        status: "ok",
        summary: "no findings",
        findings: [],
        durationMs: 1,
        providerType: "mock"
      }
    ],
    metadata: {
      generatedAt: "2026-06-06T00:00:00.000Z",
      mode: "review",
      subject: "fixture",
      providers: ["heuristic:maintainer"],
      requestedProviders: ["heuristic:maintainer"],
      ranProviders: ["heuristic:maintainer"],
      degraded
    }
  };
}

describe("renderMarkdownReport — honest degraded verdict", () => {
  it("marks a degraded PASS as heuristic-only on the verdict line", () => {
    const markdown = renderMarkdownReport(report(true));
    expect(markdown).toContain("Verdict: **PASS** _(heuristic only — not a confident pass)_");
    // The existing degraded banner is preserved.
    expect(markdown).toContain("> ⚠ Degraded:");
  });

  it("does not add the heuristic marker to a confident (non-degraded) PASS", () => {
    const markdown = renderMarkdownReport(report(false));
    expect(markdown).toContain("Verdict: **PASS**");
    expect(markdown).not.toContain("heuristic only");
    expect(markdown).not.toContain("Degraded");
  });
});
