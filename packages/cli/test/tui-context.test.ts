import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "@quorate/core";
import {
  createInitialSessionState,
  sessionReducer,
  type SessionState
} from "../src/tui/context.js";

function baseState(): SessionState {
  return createInitialSessionState({
    cwd: "/tmp/project",
    config: createDefaultConfig([]),
    mode: "review"
  });
}

describe("createInitialSessionState", () => {
  it("seeds cwd, mode, and config without mutation fields", () => {
    const state = createInitialSessionState({
      cwd: "/tmp/project",
      config: createDefaultConfig([]),
      providers: "claude,codex",
      mode: "plan"
    });
    expect(state.cwd).toBe("/tmp/project");
    expect(state.mode).toBe("plan");
    expect(state.activeProviders).toEqual(["claude", "codex"]);
    expect(state.diff).toBeUndefined();
    expect(state.lastReport).toBeUndefined();
  });

  it("leaves activeProviders undefined when no providers passed", () => {
    const state = baseState();
    expect(state.activeProviders).toBeUndefined();
  });
});

describe("sessionReducer", () => {
  it("setMode returns a new state with the mode changed and does not mutate the input", () => {
    const state = baseState();
    const next = sessionReducer(state, { type: "setMode", mode: "plan" });
    expect(next.mode).toBe("plan");
    expect(state.mode).toBe("review");
    expect(next).not.toBe(state);
  });

  it("setProviders replaces activeProviders immutably", () => {
    const state = baseState();
    const next = sessionReducer(state, { type: "setProviders", providers: ["claude"] });
    expect(next.activeProviders).toEqual(["claude"]);
    expect(state.activeProviders).toBeUndefined();
  });

  it("setRoles, setDiff, setLastRequest, setLastReport, and clear update the matching fields", () => {
    const state = baseState();
    const withRoles = sessionReducer(state, { type: "setRoles", roles: ["architect"] });
    expect(withRoles.activeRoles).toEqual(["architect"]);

    const withDiff = sessionReducer(withRoles, {
      type: "setDiff",
      diff: "diff --git a b",
      diffLabel: "sample.diff"
    });
    expect(withDiff.diff).toBe("diff --git a b");
    expect(withDiff.diffLabel).toBe("sample.diff");

    const withRequest = sessionReducer(withDiff, {
      type: "setLastRequest",
      request: { mode: "review", subject: "s", diff: "diff --git a b", repoPath: "/tmp/project" }
    });
    expect(withRequest.lastRequest?.subject).toBe("s");

    const report = {
      verdict: "pass" as const,
      summary: "ok",
      findings: [],
      providerResults: [],
      metadata: {
        generatedAt: "now",
        mode: "review" as const,
        subject: "s",
        providers: [],
        requestedProviders: [],
        ranProviders: [],
        degraded: false
      }
    };
    const withReport = sessionReducer(withRequest, { type: "setLastReport", report });
    expect(withReport.lastReport?.verdict).toBe("pass");

    const cleared = sessionReducer(withReport, { type: "clear" });
    expect(cleared.diff).toBeUndefined();
    expect(cleared.diffLabel).toBeUndefined();
    expect(cleared.lastReport).toBeUndefined();
    expect(cleared.lastRequest).toBeUndefined();
    expect(cleared.mode).toBe("review");
    expect(cleared.activeRoles).toEqual(["architect"]);
  });

  it("accumulates honest request-level token and priced-input estimates across the session", () => {
    const state = baseState();
    const first = {
      verdict: "pass" as const,
      summary: "ok",
      findings: [],
      providerResults: [],
      metadata: {
        generatedAt: "now",
        mode: "review" as const,
        subject: "s",
        providers: [],
        requestedProviders: [],
        ranProviders: [],
        degraded: false,
        budget: {
          changedFiles: 1, changedLines: 2, addedLines: 1, removedLines: 1,
          skippedGeneratedFiles: [], promptBytes: 2_000, estimatedInputTokens: 500,
          estimatedInputCostUsd: 0.12, providerEstimates: [], exceeded: []
        }
      }
    };
    const second = {
      ...first,
      metadata: {
        ...first.metadata,
        budget: { ...first.metadata.budget, estimatedInputTokens: 700, estimatedInputCostUsd: 0.2 }
      }
    };

    const afterFirst = sessionReducer(state, { type: "setLastReport", report: first });
    const afterSecond = sessionReducer(afterFirst, { type: "setLastReport", report: second });

    expect(afterSecond.sessionEstimatedInputTokens).toBe(1_200);
    expect(afterSecond.sessionEstimatedPricedInputCostUsd).toBeCloseTo(0.32);
  });
});
