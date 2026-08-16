import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { createDefaultConfig, type CouncilReport, type CouncilRequest } from "@quorate/core";
import { StatusLine } from "../src/tui/app.js";
import { prepareReviewRequest } from "../src/review-preparation.js";

function report(): CouncilReport {
  return {
    verdict: "pass",
    summary: "ok",
    findings: [],
    providerResults: [
      { providerId: "claude", role: "security", providerType: "cli", status: "ok", summary: "", findings: [], durationMs: 3_200 }
    ],
    metadata: {
      generatedAt: "2026-07-28T09:00:00.000Z",
      mode: "review",
      subject: "review",
      providers: ["claude"],
      requestedProviders: ["claude"],
      ranProviders: ["claude"],
      degraded: false,
      budget: {
        changedFiles: 1,
        changedLines: 2,
        addedLines: 1,
        removedLines: 1,
        skippedGeneratedFiles: [],
        promptBytes: 2_000,
        estimatedInputTokens: 500,
        estimatedInputCostUsd: 0.14,
        providerEstimates: [],
        exceeded: []
      }
    }
  };
}

describe("persistent trust StatusLine", () => {
  it("shows latest verdict, pending approvals, review duration, and session estimates", () => {
    const { lastFrame, unmount } = render(
      <StatusLine
        mode="review"
        activeAgents="claude"
        detectedCount={1}
        degraded={false}
        lastReport={report()}
        pendingApprovals={2}
        sessionEstimatedInputTokens={1_500}
        sessionEstimatedPricedInputCostUsd={0.42}
        reviewDurationMs={5_100}
      />
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("PASS");
    expect(frame).toContain("2 pending");
    expect(frame).toContain("5.1s");
    expect(frame).not.toContain("3.2s");
    expect(frame).toContain("~1.5k tok in");
    expect(frame).toContain("~$0.42 priced in");
    unmount();
  });
});

describe("interactive review budget preparation", () => {
  it("analyzes and attaches the request-level budget before the TUI council run", () => {
    const config = createDefaultConfig([]);
    const request: CouncilRequest = {
      mode: "review",
      subject: "review",
      repoPath: "/repo",
      diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new"
    };

    const prepared = prepareReviewRequest(request, config);

    expect(prepared.budget).toMatchObject({ changedFiles: 1, changedLines: 2 });
    expect(prepared.fullDiff).toBe(request.diff);
    expect(prepared.budget?.estimatedInputTokens).toBeGreaterThan(0);
  });

  it("does not relabel the longest provider lane as council wall time", () => {
    const { lastFrame, unmount } = render(
      <StatusLine mode="review" activeAgents="claude" detectedCount={1} degraded={false} lastReport={report()} />
    );
    expect(lastFrame() ?? "").not.toContain("3.2s");
    unmount();
  });
});
