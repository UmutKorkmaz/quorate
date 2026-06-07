import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { CouncilReport } from "@quorate/core";
import { DiffCard, RunningCard, VerdictReport, type RunRow } from "../src/tui/views.js";

function failReport(): CouncilReport {
  return {
    verdict: "fail",
    summary: "2 blocking issues across 4 files",
    metadata: {
      generatedAt: "t",
      mode: "review",
      subject: "s",
      providers: [],
      requestedProviders: [],
      ranProviders: [],
      degraded: false
    },
    providerResults: [
      { providerId: "claude", role: "architect", status: "ok", summary: "", findings: [], durationMs: 3200, providerType: "cli" },
      { providerId: "codex", role: "qa", status: "ok", summary: "", findings: [], durationMs: 2000, providerType: "cli" },
      { providerId: "qwen", role: "performance", status: "ok", summary: "", findings: [], durationMs: 1500, providerType: "cli" },
      { providerId: "droid", role: "maintainer", status: "ok", summary: "", findings: [], durationMs: 1200, providerType: "cli" }
    ],
    findings: [
      {
        severity: "critical",
        title: "Token audience claim is never verified",
        body: "The introspection result is trusted.",
        file: "src/auth/introspect.ts",
        line: 42,
        agreement: 4,
        agreedBy: ["claude", "codex", "qwen", "droid"],
        confidence: 0.96,
        suggestion: "assert claims.aud === config.audience"
      }
    ]
  };
}

describe("VerdictReport", () => {
  it("renders the verdict, severity, agreement meter, fix, and runs footer", () => {
    const { lastFrame, unmount } = render(<VerdictReport report={failReport()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("FAIL");
    expect(frame).toContain("CRITICAL");
    expect(frame).toContain("src/auth/introspect.ts:42");
    expect(frame).toContain("●●●●"); // 4-of-4 agreement, filled
    expect(frame).toContain("4/4");
    expect(frame).toContain("▸ fix");
    expect(frame).toContain("raised by claude, codex, qwen, droid");
    expect(frame).toContain("runs");
    unmount();
  });

  it("shows the honest degraded callout for a heuristic-only report", () => {
    const report = failReport();
    report.metadata.degraded = true;
    report.verdict = "warn";
    const { lastFrame, unmount } = render(<VerdictReport report={report} />);
    expect(lastFrame() ?? "").toContain("Degraded review");
    unmount();
  });
});

describe("RunningCard", () => {
  it("renders each provider row with its state", () => {
    const rows: RunRow[] = [
      { role: "architect", providerId: "claude", state: "done", note: "2 findings" },
      { role: "qa", providerId: "codex", state: "running" },
      { role: "maintainer", providerId: "droid", state: "queued" }
    ];
    const { lastFrame, unmount } = render(<RunningCard rows={rows} label="main…HEAD" startedAt={Date.now()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("architect");
    expect(frame).toContain("done");
    expect(frame).toContain("running");
    expect(frame).toContain("queued");
    expect(frame).toContain("runs complete");
    unmount();
  });
});

describe("DiffCard", () => {
  it("summarizes files changed with +/- counts", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1,3 @@",
      "-old",
      "+new1",
      "+new2",
      "+new3"
    ].join("\n");
    const { lastFrame, unmount } = render(<DiffCard label="main…HEAD" diff={diff} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("1 file changed");
    expect(frame).toContain("+3");
    expect(frame).toContain("-1");
    expect(frame).toContain("a.ts");
    unmount();
  });
});
