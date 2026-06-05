import { describe, expect, it } from "vitest";
import {
  renderMarkdownReport,
  shouldFailForReport,
  shouldFailForThreshold,
  summarizeDiff
} from "../src/render.js";
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

  it("fails via the gate when a finding meets severity and minAgreement", () => {
    const report = reportFixture({
      verdict: "warn",
      findings: [
        {
          severity: "medium",
          title: "Shared issue",
          body: "two providers agreed",
          providerId: "codex",
          role: "maintainer",
          agreement: 2
        }
      ],
      metadata: {
        generatedAt: "2026-05-29T00:00:00.000Z",
        mode: "review",
        subject: "fixture",
        providers: ["codex:maintainer"],
        requestedProviders: ["codex:maintainer"],
        ranProviders: ["codex:maintainer"],
        degraded: false
      }
    });

    // failOn never, no degraded fail — only the gate can trip this.
    expect(
      shouldFailForReport(
        report,
        baseGithub({ failOn: "never", failOnDegraded: false, gate: { severity: "medium", minAgreement: 2 } })
      )
    ).toBe(true);
  });

  it("does NOT fail via the gate when agreement is below minAgreement", () => {
    const report = reportFixture({
      verdict: "warn",
      findings: [
        {
          severity: "medium",
          title: "Lone issue",
          body: "one provider only",
          providerId: "codex",
          role: "maintainer",
          agreement: 1
        }
      ],
      metadata: {
        generatedAt: "2026-05-29T00:00:00.000Z",
        mode: "review",
        subject: "fixture",
        providers: ["codex:maintainer"],
        requestedProviders: ["codex:maintainer"],
        ranProviders: ["codex:maintainer"],
        degraded: false
      }
    });

    expect(
      shouldFailForReport(
        report,
        baseGithub({ failOn: "never", failOnDegraded: false, gate: { severity: "medium", minAgreement: 2 } })
      )
    ).toBe(false);
  });

  it("does NOT fail via the gate when severity is below the gate severity", () => {
    const report = reportFixture({
      verdict: "warn",
      findings: [
        {
          severity: "low",
          title: "Low issue",
          body: "agreed but low severity",
          providerId: "codex",
          role: "maintainer",
          agreement: 3
        }
      ],
      metadata: {
        generatedAt: "2026-05-29T00:00:00.000Z",
        mode: "review",
        subject: "fixture",
        providers: ["codex:maintainer"],
        requestedProviders: ["codex:maintainer"],
        ranProviders: ["codex:maintainer"],
        degraded: false
      }
    });

    expect(
      shouldFailForReport(
        report,
        baseGithub({ failOn: "never", failOnDegraded: false, gate: { severity: "high", minAgreement: 2 } })
      )
    ).toBe(false);
  });
});

describe("renderMarkdownReport summary option", () => {
  it("renders a Summary section before Findings when summary is provided", () => {
    const markdown = renderMarkdownReport(reportFixture(), { summary: "**1 file changed**\n\n- `a.ts`" });
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("**1 file changed**");
    expect(markdown.indexOf("## Summary")).toBeLessThan(markdown.indexOf("## Findings"));
  });

  it("omits the Summary section when summary is absent", () => {
    expect(renderMarkdownReport(reportFixture())).not.toContain("## Summary");
  });

  it("omits the Summary section for an empty summary string", () => {
    expect(renderMarkdownReport(reportFixture(), { summary: "" })).not.toContain("## Summary");
  });
});

describe("summarizeDiff", () => {
  it("returns an empty string for an empty diff", () => {
    expect(summarizeDiff("")).toBe("");
    expect(summarizeDiff("   \n  ")).toBe("");
  });

  it("counts files and lists their paths", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,2 @@",
      "+const x = 1;",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -0,0 +1,1 @@",
      "+const y = 2;"
    ].join("\n");

    const summary = summarizeDiff(diff);
    expect(summary).toContain("**2 files changed**");
    expect(summary).toContain("- `src/a.ts`");
    expect(summary).toContain("- `src/b.ts`");
  });

  it("uses singular wording for a single file", () => {
    const diff = ["diff --git a/only.ts b/only.ts", "--- a/only.ts", "+++ b/only.ts", "@@ -1 +1 @@", "+x"].join(
      "\n"
    );
    expect(summarizeDiff(diff)).toContain("**1 file changed**");
  });

  it("ignores deleted-file targets pointing at /dev/null", () => {
    const diff = [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-x"
    ].join("\n");
    // The diff --git fallback still records the renamed/changed path.
    expect(summarizeDiff(diff)).toContain("**1 file changed**");
    expect(summarizeDiff(diff)).toContain("- `gone.ts`");
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
