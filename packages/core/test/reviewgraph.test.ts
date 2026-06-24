import { describe, expect, it } from "vitest";

import { buildReviewGraph, renderReviewGraph, renderReviewGraphMarkdown } from "../src/reviewgraph.js";
import type { CouncilReport } from "../src/types.js";

function report(): CouncilReport {
  return {
    verdict: "fail",
    summary: "x",
    findings: [
      {
        severity: "high",
        title: "Unsafe transfer",
        body: "x",
        file: "programs/lib.rs",
        line: 12,
        fingerprint: "abc",
        agreement: 2,
        agreedBy: ["glm", "heuristic"]
      }
    ],
    providerResults: [
      { providerId: "glm", role: "security", providerType: "api", status: "ok", summary: "ok", findings: [], durationMs: 1 },
      { providerId: "heuristic", role: "maintainer", providerType: "mock", status: "ok", summary: "ok", findings: [], durationMs: 1 }
    ],
    metadata: {
      generatedAt: "2026-06-15T00:00:00.000Z",
      mode: "review",
      subject: "PR #1",
      providers: ["glm:security", "heuristic:maintainer"],
      requestedProviders: ["glm:security", "heuristic:maintainer"],
      ranProviders: ["glm:security", "heuristic:maintainer"],
      degraded: false,
      reviewId: "review-1"
    }
  };
}

describe("ReviewGraph", () => {
  it("builds provider/finding nodes and agreement edges", () => {
    const graph = buildReviewGraph(report());
    expect(graph.reviewId).toBe("review-1");
    expect(graph.providers.map((provider) => provider.id)).toEqual(["glm", "heuristic"]);
    expect(graph.findings[0]).toMatchObject({ id: "abc", agreement: 2 });
    expect(graph.edges).toEqual([
      { providerId: "glm", findingId: "abc" },
      { providerId: "heuristic", findingId: "abc" }
    ]);
  });

  it("renders JSON and Markdown surfaces", () => {
    expect(JSON.parse(renderReviewGraph(report())).findings).toHaveLength(1);
    expect(renderReviewGraphMarkdown(report())).toContain("Unsafe transfer");
  });
});
