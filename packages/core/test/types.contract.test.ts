import { describe, expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";
import type {
  CouncilEvent,
  ProviderResult,
  ProviderRunStatus,
  RunCouncilOptions
} from "../src/types.js";

describe("core type contract", () => {
  it("heuristic producer sets providerType to mock and status ok", () => {
    const result = runHeuristicReview({ mode: "review", subject: "fixture", diff: "" }, "maintainer");
    expect(result.providerType).toBe("mock");
    expect(result.status).toBe("ok");
  });

  it("ProviderRunStatus admits interrupted", () => {
    const statuses: ProviderRunStatus[] = ["ok", "error", "skipped", "interrupted"];
    expect(statuses).toHaveLength(4);
  });

  it("ProviderResult carries providerType and the widened status", () => {
    const result: ProviderResult = {
      providerId: "codex",
      role: "qa",
      providerType: "cli",
      status: "interrupted",
      summary: "interrupted",
      findings: [],
      durationMs: 0
    };
    expect(result.providerType).toBe("cli");
    expect(result.status).toBe("interrupted");
  });

  it("CouncilEvent council/started carries planned lanes with providerType", () => {
    const event: CouncilEvent = {
      type: "council/started",
      councilRunId: "id",
      mode: "review",
      subject: "fixture",
      planned: [{ providerId: "heuristic", role: "maintainer", providerType: "mock" }],
      at: new Date().toISOString()
    };
    expect(event.type).toBe("council/started");
    if (event.type === "council/started") {
      expect(event.planned[0].providerType).toBe("mock");
    }
  });

  it("CouncilEvent provider/chunk carries stream and text", () => {
    const event: CouncilEvent = {
      type: "provider/chunk",
      councilRunId: "id",
      providerId: "codex",
      role: "qa",
      stream: "stdout",
      text: "partial"
    };
    expect(event.type).toBe("provider/chunk");
  });

  it("CouncilEvent verdict carries the full report", () => {
    const event: CouncilEvent = {
      type: "verdict",
      councilRunId: "id",
      report: {
        verdict: "warn",
        summary: "summary",
        findings: [],
        providerResults: [],
        metadata: {
          generatedAt: "now",
          mode: "review",
          subject: "fixture",
          providers: [],
          requestedProviders: [],
          ranProviders: [],
          degraded: true
        }
      }
    };
    expect(event.type).toBe("verdict");
    if (event.type === "verdict") {
      expect(event.report.verdict).toBe("warn");
    }
  });

  it("RunCouncilOptions exposes onEvent and signal", () => {
    const seen: CouncilEvent[] = [];
    const options: RunCouncilOptions = {
      onEvent: (event) => seen.push(event),
      signal: new AbortController().signal
    };
    options.onEvent?.({ type: "council/done", councilRunId: "id", report: {
      verdict: "pass",
      summary: "",
      findings: [],
      providerResults: [],
      metadata: {
        generatedAt: "now",
        mode: "review",
        subject: "fixture",
        providers: [],
        requestedProviders: [],
        ranProviders: [],
        degraded: true
      }
    } });
    expect(seen).toHaveLength(1);
  });
});
