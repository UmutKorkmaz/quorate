import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { CouncilReport } from "@quorate/core";
import type { ProviderResult } from "@quorate/core";
import {
  DiffCard,
  LaneStream,
  LogsOverview,
  LogsDetailView,
  RouteView,
  RunningCard,
  VerdictReport,
  stripAnsiEscapes,
  stripAnsiLine,
  truncateLine,
  type RunRow
} from "../src/tui/views.js";

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
  it("renders the reviewers, the verdict chip, severity, and the agreement meter", () => {
    const { lastFrame, unmount } = render(<VerdictReport report={failReport()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("FAIL");
    expect(frame).toContain("CRIT"); // abbreviated severity
    expect(frame).toContain("src/auth/introspect.ts:42");
    expect(frame).toContain("agreement"); // agreement header + meter
    expect(frame).toContain("agreed by claude, codex, qwen, droid");
    expect(frame).toContain("claude:architect"); // reviewer row at the top
    unmount();
  });

  it("shows the honest degraded callout for a heuristic-only report", () => {
    const report = failReport();
    report.metadata.degraded = true;
    report.verdict = "warn";
    const { lastFrame, unmount } = render(<VerdictReport report={report} />);
    expect(lastFrame() ?? "").toContain("heuristic only");
    unmount();
  });

  it("shows each lane duration and uses the request-level priced input estimate", () => {
    const report = failReport();
    report.metadata.budget = {
      changedFiles: 2,
      changedLines: 12,
      addedLines: 10,
      removedLines: 2,
      skippedGeneratedFiles: [],
      promptBytes: 2_000,
      estimatedInputTokens: 500,
      estimatedInputCostUsd: 0.42,
      providerEstimates: [],
      exceeded: []
    };

    const { lastFrame, unmount } = render(<VerdictReport report={report} />);
    const frame = lastFrame() ?? "";
    for (const expected of [
      "claude:architect (3.2s)",
      "codex:qa (2.0s)",
      "qwen:performance (1.5s)",
      "droid:maintainer (1.2s)"
    ]) {
      expect(frame).toContain(expected);
    }
    expect(frame).toContain("~$0.42 in");
    unmount();
  });

  it("shows an input-token estimate when the request has no priced estimate", () => {
    const report = failReport();
    report.metadata.budget = {
      changedFiles: 1,
      changedLines: 4,
      addedLines: 4,
      removedLines: 0,
      skippedGeneratedFiles: [],
      promptBytes: 3_400,
      estimatedInputTokens: 850,
      providerEstimates: [],
      exceeded: []
    };

    const { lastFrame, unmount } = render(<VerdictReport report={report} />);
    expect(lastFrame() ?? "").toContain("~850 tok in");
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
    expect(frame).toContain("Convening council on");
    expect(frame).toContain("claude:architect");
    expect(frame).toContain("2 findings");
    expect(frame).toContain("running");
    expect(frame).toContain("queued");
    unmount();
  });

  it("shows a live preview on a running row and an error line on a failed row", () => {
    const rows: RunRow[] = [
      { providerId: "claude", role: "qa", state: "running", preview: "analyzing src/auth.ts" },
      {
        providerId: "codex",
        role: "security",
        state: "done",
        status: "error",
        note: "error",
        error: "spawn codex ENOENT"
      }
    ];
    const { lastFrame, unmount } = render(
      <RunningCard rows={rows} label="x" startedAt={Date.now()} maxWidth={80} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("analyzing src/auth.ts");
    expect(frame).toContain("spawn codex ENOENT");
    unmount();
  });

  it("drops the preview once a row is done", () => {
    const running: RunRow[] = [
      { providerId: "claude", role: "qa", state: "running", preview: "still-working-on-it" }
    ];
    const done: RunRow[] = [
      { providerId: "claude", role: "qa", state: "done", status: "ok", note: "1 finding", preview: "still-working-on-it" }
    ];
    const before = render(<RunningCard rows={running} label="x" startedAt={Date.now()} maxWidth={80} />);
    expect(before.lastFrame() ?? "").toContain("still-working-on-it");
    before.unmount();
    const after = render(<RunningCard rows={done} label="x" startedAt={Date.now()} maxWidth={80} />);
    expect(after.lastFrame() ?? "").not.toContain("still-working-on-it");
    after.unmount();
  });
});

describe("LaneStream", () => {
  it("renders the lane header, tail lines, and the observe-only footer", () => {
    const { lastFrame, unmount } = render(
      <LaneStream providerId="claude" role="qa" lines={["line a", "line b"]} maxWidth={80} startedAt={Date.now()} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("claude:qa");
    expect(frame).toContain("line a");
    expect(frame).toContain("line b");
    expect(frame).toContain("output only");
    unmount();
  });

  it("shows a waiting placeholder when there is no output yet", () => {
    const { lastFrame, unmount } = render(
      <LaneStream providerId="claude" role="qa" lines={[]} maxWidth={80} startedAt={Date.now()} />
    );
    expect(lastFrame() ?? "").toContain("waiting for output");
    unmount();
  });

  it("renders a streamed hyperlink line as plain text with no escape payload", () => {
    const { lastFrame, unmount } = render(
      <LaneStream
        providerId="claude"
        role="qa"
        lines={["\x1b]8;;https://evil.example/a\x1b\\click here\x1b]8;;\x1b\\ done"]}
        maxWidth={80}
        startedAt={Date.now()}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("click here done");
    // Neither the OSC payload (URL) nor a raw ESC byte may reach the terminal.
    expect(frame).not.toContain("evil.example");
    expect(frame).not.toContain("\x1b");
    unmount();
  });
});

describe("truncateLine", () => {
  it("strips ANSI, single-lines, and ellipsizes past maxCols", () => {
    expect(truncateLine("\x1b[31mhello world\x1b[0m", 8)).toMatch(/^hell/);
    expect(truncateLine("\x1b[31mhello world\x1b[0m", 8).length).toBeLessThanOrEqual(8);
    // Multi-line input collapses to the last non-blank segment.
    expect(truncateLine("first\n\nsecond", 80)).toBe("second");
    // ANSI is fully removed from short input.
    expect(truncateLine("\x1b[32mok\x1b[0m", 80)).toBe("ok");
  });
});

describe("stripAnsiEscapes", () => {
  it("unwraps an OSC-8 hyperlink to its inner text (both URL and close marker gone)", () => {
    const line = "see \x1b]8;;https://evil.example/a\x1b\\this doc\x1b]8;;\x1b\\ for details";
    expect(stripAnsiEscapes(line)).toBe("see this doc for details");
  });

  it("strips window-title and clipboard OSC writes, BEL- and ST-terminated", () => {
    expect(stripAnsiEscapes("\x1b]0;pwned title\x07body text")).toBe("body text");
    expect(stripAnsiEscapes("\x1b]2;pwned title\x1b\\body text")).toBe("body text");
    expect(stripAnsiEscapes("\x1b]52;c;Zm9v\x07after")).toBe("after");
  });

  it("swallows an unterminated OSC through end of line but keeps later lines", () => {
    expect(stripAnsiEscapes("keep\x1b]0;cut-off\nnext line")).toBe("keep\nnext line");
  });

  it("strips all CSI sequences (cursor, screen, mode), not just SGR color", () => {
    expect(stripAnsiEscapes("\x1b[31mred\x1b[0m")).toBe("red"); // the old, narrow behavior is a subset
    expect(stripAnsiEscapes("\x1b[2Aup\x1b[1Bdown")).toBe("updown");
    expect(stripAnsiEscapes("\x1b[?25lhidden\x1b[?25h")).toBe("hidden");
    expect(stripAnsiEscapes("\x1b[2J\x1b[Hcleared")).toBe("cleared");
    expect(stripAnsiEscapes("\x1b[38;2;10;20;30mtruecolor\x1b[0m")).toBe("truecolor");
  });

  it("strips other ESC-led controls (reverse index, cursor save/restore, reset)", () => {
    expect(stripAnsiEscapes("a\x1bMb")).toBe("ab");
    expect(stripAnsiEscapes("a\x1b7b\x1b8c")).toBe("abc");
    expect(stripAnsiEscapes("\x1bcfresh")).toBe("fresh");
    expect(stripAnsiEscapes("trailing esc\x1b")).toBe("trailing esc");
  });

  it("leaves plain text, newlines, and tabs untouched, and keeps non-ESC control bytes", () => {
    expect(stripAnsiEscapes("plain text")).toBe("plain text");
    expect(stripAnsiEscapes("line one\nline two\ttabbed")).toBe("line one\nline two\ttabbed");
    // Only ESC-led sequences are stripped; other control bytes pass through as-is.
    expect(stripAnsiEscapes("bell\x07back\x08space")).toBe("bell\x07back\x08space");
  });

  it("feeds the shared per-line and truncating sanitizers", () => {
    expect(stripAnsiLine("\x1b]8;;https://x.example\x1b\\docs\x1b]8;;\x1b\\", 80)).toBe("docs");
    expect(truncateLine("\x1b]0;busy\x07compiling src/a.ts", 80)).toBe("compiling src/a.ts");
  });
});

describe("VerdictReport degraded errors", () => {
  it("marks a failed reviewer in its row and keeps the raw error out of the card", () => {
    const report = failReport();
    report.metadata.degraded = true;
    report.verdict = "warn";
    report.providerResults = [
      { providerId: "claude", role: "architect", status: "ok", summary: "", findings: [], durationMs: 1000, providerType: "cli" },
      {
        providerId: "codex",
        role: "qa",
        status: "error",
        summary: "",
        findings: [],
        durationMs: 500,
        providerType: "cli",
        rawOutput: "Traceback (most recent call last):\n  File foo.py",
        error: "missing API key"
      }
    ];
    const { lastFrame, unmount } = render(<VerdictReport report={report} />);
    const frame = lastFrame() ?? "";
    // The failing reviewer is marked failed in its own row…
    expect(frame).toContain("codex:qa");
    expect(frame).toContain("failed");
    // …but the raw per-provider error never leaks into the verdict card.
    expect(frame).not.toContain("missing API key");
    // …and the footer points at /logs to read each agent.
    expect(frame).toContain("/logs to read each agent");
    unmount();
  });

  it("marks error and interrupted reviewers as failed but skipped ones as skipped", () => {
    const report = failReport();
    report.providerResults = [
      { providerId: "claude", role: "architect", status: "error", summary: "", findings: [], durationMs: 1000, providerType: "cli", error: "boom" },
      { providerId: "codex", role: "qa", status: "interrupted", summary: "", findings: [], durationMs: 500, providerType: "cli", error: "interrupted" },
      { providerId: "qwen", role: "performance", status: "skipped", summary: "", findings: [], durationMs: 0, providerType: "cli" }
    ];
    const { lastFrame, unmount } = render(<VerdictReport report={report} />);
    const frame = lastFrame() ?? "";
    // error + interrupted each render as failed; skipped renders as skipped.
    expect((frame.match(/failed/g) ?? []).length).toBe(2);
    expect(frame).toContain("skipped");
    unmount();
  });
});

describe("stripAnsiLine", () => {
  it("strips ANSI and keeps every line distinct (unlike truncateLine)", () => {
    expect(stripAnsiLine("\x1b[31mred line\x1b[0m", 80)).toBe("red line");
    // A blank line stays blank rather than collapsing to the last non-blank one.
    expect(stripAnsiLine("", 80)).toBe("");
    // Tabs become two spaces.
    expect(stripAnsiLine("a\tb", 80)).toBe("a  b");
    // Truncation with ellipsis past maxCols.
    expect(stripAnsiLine("0123456789", 5).length).toBeLessThanOrEqual(5);
  });
});

describe("LogsOverview", () => {
  it("lists each lane with its status and a read hint", () => {
    const lanes: ProviderResult[] = [
      { providerId: "claude", role: "architect", status: "ok", summary: "", findings: [], durationMs: 1200, providerType: "cli", rawOutput: "some output" },
      { providerId: "codex", role: "qa", status: "error", summary: "", findings: [], durationMs: 500, providerType: "cli", error: "boom" }
    ];
    const { lastFrame, unmount } = render(<LogsOverview lanes={lanes} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("claude:architect");
    expect(frame).toContain("codex:qa");
    expect(frame).toContain("/logs claude:architect to read");
    expect(frame).toContain("errored");
    unmount();
  });
});

describe("LogsDetailView", () => {
  it("renders the full error prominently and the captured body for a failed lane", () => {
    const result: ProviderResult = {
      providerId: "codex",
      role: "maintainer",
      status: "error",
      summary: "",
      findings: [],
      durationMs: 800,
      providerType: "cli",
      error: "spawn codex ENOENT: the headless profile is missing its required args",
      rawOutput: "\x1b[31mError:\x1b[0m boot failed\nstack trace line"
    };
    const { lastFrame, unmount } = render(<LogsDetailView result={result} maxWidth={120} />);
    const frame = lastFrame() ?? "";
    // The real error is shown verbatim (not truncated to a source line).
    expect(frame).toContain("spawn codex ENOENT: the headless profile is missing its required args");
    // The captured body is rendered, ANSI stripped.
    expect(frame).toContain("Error: boot failed");
    expect(frame).toContain("stack trace line");
    unmount();
  });

  it("shows a no-output placeholder when rawOutput is empty", () => {
    const result: ProviderResult = {
      providerId: "claude",
      role: "qa",
      status: "ok",
      summary: "",
      findings: [],
      durationMs: 600,
      providerType: "cli",
      rawOutput: ""
    };
    const { lastFrame, unmount } = render(<LogsDetailView result={result} maxWidth={120} />);
    expect(lastFrame() ?? "").toContain("no output captured");
    unmount();
  });
});

describe("RouteView", () => {
  it("flags an overridden role and calls out a role with no provider", () => {
    const { lastFrame, unmount } = render(
      <RouteView
        rows={[
          { role: "security", providers: ["codex"], overridden: true },
          { role: "architect", providers: ["claude"], overridden: false },
          { role: "qa", providers: [], overridden: false }
        ]}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("security");
    expect(frame).toContain("session override");
    expect(frame).toContain("config");
    expect(frame).toContain("won't run");
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
