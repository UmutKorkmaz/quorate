import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultConfig, type CouncilReport, type CouncilRequest } from "@quorate/core";
import {
  commandRegistry,
  resolveCommand,
  parseAndRun
} from "../src/tui/commands.js";
import {
  createInitialSessionState,
  sessionReducer,
  type SessionAction,
  type SessionState,
  type ShellContext,
  type TranscriptCell
} from "../src/tui/context.js";

function makeReport(): CouncilReport {
  return {
    verdict: "pass",
    summary: "ok",
    findings: [],
    providerResults: [],
    metadata: {
      generatedAt: "now",
      mode: "review",
      subject: "s",
      providers: [],
      requestedProviders: [],
      ranProviders: [],
      degraded: false
    }
  };
}

function makeCtx(cwd: string): {
  ctx: ShellContext;
  cells: TranscriptCell[];
  actions: SessionAction[];
  getState: () => SessionState;
} {
  let state = createInitialSessionState({
    cwd,
    config: createDefaultConfig([]),
    mode: "review"
  });
  const cells: TranscriptCell[] = [];
  const actions: SessionAction[] = [];
  const ctx: ShellContext = {
    getState: () => state,
    dispatch: (action) => {
      actions.push(action);
      state = sessionReducer(state, action);
    },
    emit: (cell) => cells.push(cell),
    runReview: async (request: CouncilRequest) => makeReport()
  };
  return { ctx, cells, actions, getState: () => state };
}

describe("commandRegistry", () => {
  it("declares the canonical command names", () => {
    const names = commandRegistry.map((c) => c.name);
    for (const expected of [
      "providers", "doctor", "status", "use", "enable", "disable", "roles",
      "mode", "diff", "git", "pr", "review", "plan", "last", "rerun",
      "history", "json", "markdown", "clear", "help", "exit"
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("resolves aliases to canonical commands", () => {
    expect(resolveCommand("reset")?.name).toBe("clear");
    expect(resolveCommand("q")?.name).toBe("exit");
    expect(resolveCommand("quit")?.name).toBe("exit");
    expect(resolveCommand("?")?.name).toBe("help");
    expect(resolveCommand("ask")?.name).toBe("plan");
    expect(resolveCommand("md")?.name).toBe("markdown");
  });
});

describe("parseAndRun", () => {
  it("/help emits a text cell listing commands", async () => {
    const { ctx, cells } = makeCtx(process.cwd());
    await parseAndRun(ctx, "/help");
    const text = cells.map((cell) => (cell.kind === "text" ? cell.text : "")).join("\n");
    expect(text).toContain("/review");
    expect(text).toContain("/mode");
  });

  it("/mode plan dispatches setMode and confirms", async () => {
    const { ctx, cells, getState } = makeCtx(process.cwd());
    await parseAndRun(ctx, "/mode plan");
    expect(getState().mode).toBe("plan");
    const text = cells.map((cell) => (cell.kind === "text" ? cell.text : "")).join("\n");
    expect(text.toLowerCase()).toContain("plan");
  });

  it("bare text in review mode runs a review and emits a findings cell", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-cmd-"));
    const diffPath = join(dir, "s.diff");
    writeFileSync(diffPath, "diff --git a/x b/x\n", "utf8");
    const { ctx, cells, getState } = makeCtx(dir);
    await parseAndRun(ctx, "/diff s.diff");
    await parseAndRun(ctx, "review the change");
    expect(getState().lastReport?.verdict).toBe("pass");
    expect(cells.some((cell) => cell.kind === "findings")).toBe(true);
  });

  it("unknown command emits a helpful text cell", async () => {
    const { ctx, cells } = makeCtx(process.cwd());
    await parseAndRun(ctx, "/bogus");
    const text = cells.map((cell) => (cell.kind === "text" ? cell.text : "")).join("\n");
    expect(text).toContain("Unknown command");
  });
});
