import { describe, expect, it } from "vitest";
import { renderMarkdownReport, shouldFailForReport, shouldFailForThreshold } from "../src/render.js";
import type { CouncilReport, GithubConfig } from "../src/types.js";

function baseGithub(overrides: Partial<GithubConfig> = {}): GithubConfig {
  return {
    commentMode: "update",
    failOn: "high",
    runnerMode: "auto",
    failOnDegraded: false,
    ...overrides
  };
}

function reportFixture(overrides: Partial<CouncilReport> = {}): CouncilReport {
  return {
    verdict: "warn",
    summary: "Only the built-in heuristic ran — enable a real provider (`/use available`) for a trustworthy verdict. 0 findings.",
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
      subject: "fixture",
      providers: ["heuristic:maintainer"],
      requestedProviders: ["heuristic:maintainer"],
      ranProviders: ["heuristic:maintainer"],
      degraded: true
    },
    ...overrides
  };
}

describe("shouldFailForReport", () => {
  it("does NOT fail on a clean degraded report when failOnDegraded is false", () => {
    const report = reportFixture();
    expect(shouldFailForThreshold(report, "high")).toBe(false);
    expect(shouldFailForReport(report, baseGithub({ failOn: "high", failOnDegraded: false }))).toBe(false);
  });

  it("fails on a clean degraded report when failOnDegraded is true", () => {
    const report = reportFixture();
    expect(shouldFailForReport(report, baseGithub({ failOn: "high", failOnDegraded: true }))).toBe(true);
  });

  it("falls back to the severity threshold when not degraded", () => {
    const report = reportFixture({
      verdict: "fail",
      findings: [
        {
          severity: "high",
          title: "Missing authz check",
          body: "token introspection result is trusted",
          providerId: "codex",
          role: "security"
        }
      ],
      metadata: {
        generatedAt: "2026-05-29T00:00:00.000Z",
        mode: "review",
        subject: "fixture",
        providers: ["codex:security"],
        requestedProviders: ["codex:security"],
        ranProviders: ["codex:security"],
        degraded: false
      }
    });
    expect(shouldFailForReport(report, baseGithub({ failOn: "high", failOnDegraded: false }))).toBe(true);
    expect(shouldFailForReport(report, baseGithub({ failOn: "never", failOnDegraded: false }))).toBe(false);
  });
});

describe("renderMarkdownReport degraded banner", () => {
  it("prints a one-line degraded banner when metadata.degraded is true", () => {
    const markdown = renderMarkdownReport(reportFixture());
    expect(markdown).toContain("> ⚠ Degraded:");
  });

  it("omits the degraded banner when metadata.degraded is false", () => {
    const report = reportFixture({
      verdict: "pass",
      metadata: {
        generatedAt: "2026-05-29T00:00:00.000Z",
        mode: "review",
        subject: "fixture",
        providers: ["codex:security"],
        requestedProviders: ["codex:security"],
        ranProviders: ["codex:security"],
        degraded: false
      }
    });
    expect(renderMarkdownReport(report)).not.toContain("> ⚠ Degraded:");
  });
});
