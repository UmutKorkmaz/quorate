import { describe, expect, it } from "vitest";
import { shouldFailForReport } from "@quorate/core";
import type { CouncilReport, GithubConfig } from "@quorate/core";

function github(overrides: Partial<GithubConfig> = {}): GithubConfig {
  return {
    commentMode: "update",
    failOn: "high",
    runnerMode: "auto",
    failOnDegraded: false,
    ...overrides
  };
}

const degradedCleanReport: CouncilReport = {
  verdict: "warn",
  summary: "Only the built-in heuristic ran — enable a real provider for a trustworthy verdict. 0 findings.",
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
    generatedAt: "2026-05-29T00:00:00.000Z",
    mode: "review",
    subject: "PR #1",
    providers: ["heuristic:maintainer"],
    requestedProviders: ["heuristic:maintainer"],
    ranProviders: ["heuristic:maintainer"],
    degraded: true
  }
};

describe("action fail gating", () => {
  it("does not gate on a clean degraded PR by default", () => {
    expect(shouldFailForReport(degradedCleanReport, github())).toBe(false);
  });

  it("gates on a clean degraded PR when failOnDegraded is true", () => {
    expect(shouldFailForReport(degradedCleanReport, github({ failOnDegraded: true }))).toBe(true);
  });
});
