import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDefaultConfig,
  type CouncilReport,
  type CouncilRequest,
  type ProviderResult
} from "@quorate/core";
import {
  commandRegistry,
  commandNames,
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

function makeReport(providerResults: ProviderResult[] = []): CouncilReport {
  return {
    verdict: "pass",
    summary: "ok",
    findings: [],
    providerResults,
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

function lane(overrides: Partial<ProviderResult> & Pick<ProviderResult, "providerId" | "role">): ProviderResult {
  return {
    status: "ok",
    summary: "",
    findings: [],
    durationMs: 1000,
    providerType: "cli",
    ...overrides
  };
}

function makeCtx(cwd: string, report?: CouncilReport): {
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
  if (report) {
    state = sessionReducer(state, { type: "setLastReport", report });
  }
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
      "providers", "doctor", "inspect", "setup", "status", "use", "enable", "disable", "roles",
      "route", "mode", "diff", "git", "pr", "review", "plan", "supply-chain", "last", "logs", "rerun",
      "history", "json", "markdown", "resume", "rename", "clear", "help", "exit"
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
    expect(resolveCommand("supplychain")?.name).toBe("supply-chain");
  });

  it("commandNames() lists doctor as its own command (not a providers alias)", () => {
    const names = commandNames();
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("doctor");
    expect(resolveCommand("doctor")?.name).toBe("doctor");
    expect(resolveCommand("providers")?.name).toBe("providers");
  });
});

describe("parseAndRun", () => {
  it("runs a SupplyChainGate scan and retains its report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-supply-chain-tui-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }) + "\n", "utf8");
    execSync("git init -q -b main", { cwd: dir });
    execSync("git add package.json && git -c user.email=test@example.com -c user.name='Quorate Test' commit -q -m baseline", { cwd: dir });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: { "left-pad": "^1.3.0" } }) + "\n",
      "utf8"
    );

    const { ctx, cells, getState } = makeCtx(dir);
    await parseAndRun(ctx, "/supply-chain scan --gate --fail-on high");

    expect(getState().lastReport).toBeDefined();
    expect(cells.some((cell) => cell.kind === "findings")).toBe(true);
    const textCells = cells.flatMap((cell) => (cell.kind === "text" ? [cell.text] : []));
    expect(textCells.some((cell) => /^SupplyChainGate policy: (PASS|FAIL)\.$/.test(cell))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it("keeps the Ink shell active when a SupplyChainGate scan has no changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-supply-chain-empty-tui-"));
    execSync("git init -q", { cwd: dir });
    const { ctx, cells, getState } = makeCtx(dir);

    await parseAndRun(ctx, "/supplychain scan");

    expect(getState().lastReport).toBeUndefined();
    expect(cells).toContainEqual(expect.objectContaining({
      kind: "text",
      text: "No changes to scan. Pass --diff, --base/--head, or --pr."
    }));
  });

  it("/help emits a help reference cell", async () => {
    const { ctx, cells } = makeCtx(process.cwd());
    await parseAndRun(ctx, "/help");
    expect(cells.some((cell) => cell.kind === "help")).toBe(true);
  });

  it("/skills emits a skills cell with the council roles", async () => {
    const { ctx, cells } = makeCtx(process.cwd());
    await parseAndRun(ctx, "/skills");
    const skills = cells.find((cell) => cell.kind === "skills");
    expect(skills).toBeDefined();
  });

  it("renders the design's system views via their commands", async () => {
    const { ctx, cells } = makeCtx(process.cwd());
    await parseAndRun(ctx, "/plugins");
    await parseAndRun(ctx, "/settings");
    await parseAndRun(ctx, "/theme");
    await parseAndRun(ctx, "/provider codex");
    const kinds = cells.map((cell) => cell.kind);
    expect(kinds).toContain("plugins");
    expect(kinds).toContain("settings");
    expect(kinds).toContain("theme");
    expect(kinds).toContain("providerDetail");
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

  it("/doctor emits the full readiness verdict (not the provider grid)", async () => {
    const { ctx, cells } = makeCtx(process.cwd());
    await parseAndRun(ctx, "/doctor");
    const text = cells.map((cell) => (cell.kind === "text" ? cell.text : "")).join("\n");
    expect(text).toContain("Quorate doctor");
    expect(text).toContain("Verdict");
    expect(cells.some((cell) => cell.kind === "providerStatus")).toBe(false);
  });

  it("/logs with no report yet explains how to produce one", async () => {
    const { ctx, cells } = makeCtx(process.cwd());
    await parseAndRun(ctx, "/logs");
    const text = cells.map((cell) => (cell.kind === "text" ? cell.text : "")).join("\n");
    expect(text).toContain("No report yet");
    expect(cells.some((cell) => cell.kind === "logs")).toBe(false);
  });

  it("/logs with no arg emits an overview cell listing every lane", async () => {
    const report = makeReport([
      lane({ providerId: "claude", role: "architect", rawOutput: "looks good" }),
      lane({ providerId: "codex", role: "qa", status: "error", error: "boom" })
    ]);
    const { ctx, cells } = makeCtx(process.cwd(), report);
    await parseAndRun(ctx, "/logs");
    const logs = cells.find((cell) => cell.kind === "logs");
    expect(logs?.kind).toBe("logs");
    if (logs?.kind === "logs" && logs.variant === "overview") {
      expect(logs.lanes).toHaveLength(2);
    } else {
      throw new Error("expected an overview logs cell");
    }
  });

  it("/logs codex:qa emits a detail cell with the verbatim error", async () => {
    const fullError = "spawn codex ENOENT: the headless profile is missing its required args";
    const report = makeReport([
      lane({ providerId: "claude", role: "architect", rawOutput: "ok" }),
      lane({ providerId: "codex", role: "maintainer", status: "error", error: fullError, rawOutput: "stack" })
    ]);
    const { ctx, cells } = makeCtx(process.cwd(), report);
    await parseAndRun(ctx, "/logs codex:maintainer");
    const logs = cells.find((cell) => cell.kind === "logs");
    if (logs?.kind === "logs" && logs.variant === "detail") {
      expect(logs.result.error).toBe(fullError);
      expect(logs.result.providerId).toBe("codex");
    } else {
      throw new Error("expected a detail logs cell");
    }
  });

  it("/logs <provider> covering multiple roles shows an overview + ambiguity hint", async () => {
    const report = makeReport([
      lane({ providerId: "codex", role: "maintainer", rawOutput: "a" }),
      lane({ providerId: "codex", role: "qa", rawOutput: "b" })
    ]);
    const { ctx, cells } = makeCtx(process.cwd(), report);
    await parseAndRun(ctx, "/logs codex");
    const logs = cells.find((cell) => cell.kind === "logs");
    expect(logs?.kind === "logs" && logs.variant === "overview").toBe(true);
    const text = cells.map((cell) => (cell.kind === "text" ? cell.text : "")).join("\n");
    expect(text).toContain("covers 2 roles");
  });

  it("/logs for an unknown lane reports no run with a suggestion suffix", async () => {
    const report = makeReport([lane({ providerId: "codex", role: "qa", rawOutput: "a" })]);
    const { ctx, cells } = makeCtx(process.cwd(), report);
    await parseAndRun(ctx, "/logs ghost");
    const text = cells.map((cell) => (cell.kind === "text" ? cell.text : "")).join("\n");
    expect(text).toContain('No run for "ghost"');
  });

  it("/route with no arg emits a route cell derived from config councils", async () => {
    const { ctx, cells } = makeCtx(process.cwd());
    await parseAndRun(ctx, "/route");
    const route = cells.find((cell) => cell.kind === "route");
    if (route?.kind === "route") {
      const roles = route.rows.map((r) => r.role);
      expect(roles).toEqual(["architect", "security", "qa", "performance", "maintainer"]);
    } else {
      throw new Error("expected a route cell");
    }
  });

  it("/route security codex dispatches setRoute and re-emits the table", async () => {
    const { ctx, cells, getState } = makeCtx(process.cwd());
    await parseAndRun(ctx, "/route security codex");
    expect(getState().roleOverrides?.security).toEqual(["codex"]);
    const route = cells.find((cell) => cell.kind === "route");
    if (route?.kind === "route") {
      const securityRow = route.rows.find((r) => r.role === "security");
      expect(securityRow?.overridden).toBe(true);
      expect(securityRow?.providers).toEqual(["codex"]);
    } else {
      throw new Error("expected a route cell");
    }
  });

  it("/route reset clears the overrides and confirms", async () => {
    const { ctx, cells, getState } = makeCtx(process.cwd());
    await parseAndRun(ctx, "/route security codex");
    await parseAndRun(ctx, "/route reset");
    expect(getState().roleOverrides).toBeUndefined();
    const text = cells.map((cell) => (cell.kind === "text" ? cell.text : "")).join("\n");
    expect(text.toLowerCase()).toContain("restored");
  });

  it("/route rejects an unknown role and an unknown provider", async () => {
    const { ctx, cells, getState } = makeCtx(process.cwd());
    await parseAndRun(ctx, "/route bogusrole codex");
    await parseAndRun(ctx, "/route security ghostprovider");
    const text = cells.map((cell) => (cell.kind === "text" ? cell.text : "")).join("\n");
    expect(text).toContain("Unknown role: bogusrole");
    expect(text).toContain("Unknown provider id");
    expect(getState().roleOverrides).toBeUndefined();
  });

  it("/review with implicit git diff dispatches setDiff and emits a diff cell", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-implicit-"));
    const filePath = join(dir, "x.txt");
    writeFileSync(filePath, "hello\n", "utf8");
    execSync("git init -q", { cwd: dir });
    execSync("git add x.txt", { cwd: dir });
    execSync('git -c user.email=test@example.com -c user.name=test commit -q -m init', { cwd: dir });
    writeFileSync(filePath, "hello world\n", "utf8");

    const { ctx, cells, actions } = makeCtx(dir);
    await parseAndRun(ctx, "/review");
    expect(actions.some((action) => action.type === "setDiff")).toBe(true);
    const diffCell = cells.find((cell) => cell.kind === "diff");
    expect(diffCell).toBeDefined();
    if (diffCell?.kind === "diff") {
      expect(diffCell.label).toBe("git working tree");
    }
  });
});
