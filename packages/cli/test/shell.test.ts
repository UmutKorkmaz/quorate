import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "@quorate/core";
import {
  handleShellLine,
  parseShellCommand,
  validateProviderSelection,
  type ShellState
} from "../src/shell.js";

const riskyDiff = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,5 @@
+const apiKey = "sk-example-secret-value";
+test.only("focused", () => {});
`;

const dependencyDiff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,4 +1,7 @@
 {
   "name": "fixture",
+  "dependencies": {
+    "left-pad": "^1.3.0"
+  },
   "version": "1.0.0"
 }
`;

function createState(cwd: string): ShellState {
  return {
    cwd,
    config: createDefaultConfig([]),
    mode: "review",
    transcript: []
  };
}

describe("parseShellCommand", () => {
  it("parses slash commands and bare text based on mode", () => {
    expect(parseShellCommand("/use claude,codex")).toEqual({
      kind: "use",
      providers: ["claude", "codex"]
    });
    expect(parseShellCommand("/enable qwen")).toEqual({
      kind: "enable",
      providers: ["qwen"]
    });
    expect(parseShellCommand("/mode plan")).toEqual({ kind: "mode", mode: "plan" });
    expect(parseShellCommand("/pr 42")).toEqual({ kind: "pr", number: "42" });
    expect(parseShellCommand("/supply-chain scan --base main --json")).toEqual({
      kind: "supply-chain",
      args: "scan --base main --json"
    });
    expect(parseShellCommand("/supplychain scan")).toEqual({ kind: "supply-chain", args: "scan" });
    expect(parseShellCommand("check this migration", "plan")).toEqual({
      kind: "plan",
      prompt: "check this migration"
    });
    expect(parseShellCommand("review auth changes", "review")).toEqual({
      kind: "review",
      subject: "review auth changes"
    });
  });

});

describe("handleShellLine", () => {
  it("runs a SupplyChainGate scan without exiting the classic shell", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-supply-chain-shell-"));
    writeFileSync(join(dir, "dependency.diff"), dependencyDiff, "utf8");
    const state = createState(dir);
    const output: string[] = [];
    const io = { write: (message: string) => output.push(message) };

    const result = await handleShellLine(state, "/supply-chain scan --diff dependency.diff --gate --fail-on high", io);

    expect(result.exit).toBe(false);
    expect(state.lastReport).toBeDefined();
    expect(state.lastRequest).toBeUndefined();
    expect(output.join("\n")).toContain("Quorate Report");
    expect(output.join("\n")).toContain("SupplyChainGate policy: FAIL.");
    expect(process.exitCode).toBeUndefined();
  });

  it("keeps the classic shell active when a SupplyChainGate scan has no changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-supply-chain-empty-shell-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const state = createState(dir);
    const output: string[] = [];

    const result = await handleShellLine(state, "/supplychain scan", { write: (message) => output.push(message) });

    expect(result.exit).toBe(false);
    expect(state.lastReport).toBeUndefined();
    expect(output.join("\n")).toContain("No changes to scan. Pass --diff, --base/--head, or --pr.");
  });

  it("loads a diff, runs a review, and saves JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-shell-"));
    const diffPath = join(dir, "sample.diff");
    writeFileSync(diffPath, riskyDiff, "utf8");
    const state = createState(dir);
    const output: string[] = [];
    const io = { write: (message: string) => output.push(message) };

    await handleShellLine(state, "/diff sample.diff", io);
    await handleShellLine(state, "/review shell smoke", io);
    await handleShellLine(state, "/markdown report.md", io);
    await handleShellLine(state, "/json report.json", io);
    await handleShellLine(state, "/rerun", io);

    expect(state.diffLabel).toBe("sample.diff");
    expect(state.lastReport?.verdict).toBe("fail");
    expect(state.lastReport?.findings.map((finding) => finding.title)).toContain("Possible secret in added code");
    expect(readFileSync(join(dir, "report.json"), "utf8")).toContain('"verdict": "fail"');
    expect(readFileSync(join(dir, "report.md"), "utf8")).toContain("Quorate Report");
    expect(output.join("\n")).toContain("Quorate Report");
  });

  it("tracks session provider and role selections without editing config defaults", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-shell-"));
    const state = createState(dir);
    const output: string[] = [];
    const io = { write: (message: string) => output.push(message) };

    await handleShellLine(state, "/use claude,codex", io);
    await handleShellLine(state, "/enable qwen", io);
    await handleShellLine(state, "/disable claude", io);
    await handleShellLine(state, "/roles architect,qa", io);
    await handleShellLine(state, "/status", io);
    await handleShellLine(state, "/history", io);

    expect(state.activeProviders).toEqual(["codex", "qwen"]);
    expect(state.activeRoles).toEqual(["architect", "qa"]);
    expect(output.join("\n")).toContain("Providers: codex, qwen");
    expect(output.join("\n")).toContain("/status");
  });

  it("rejects unknown providers and roles without mutating session state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-shell-"));
    const state = createState(dir);
    const output: string[] = [];
    const io = { write: (message: string) => output.push(message) };

    await handleShellLine(state, "/use nope", io);
    await handleShellLine(state, "/roles fake-role", io);
    await handleShellLine(state, "/use default", io);

    expect(state.activeProviders).toBeUndefined();
    expect(state.activeRoles).toBeUndefined();
    expect(output.join("\n")).toContain("Unknown provider id: nope");
    expect(output.join("\n")).toContain("Unknown role: fake-role");
    expect(output.join("\n")).toContain("Using providers from config.");
  });

  it("uses only runnable providers for /use available", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-shell-"));
    const state = createState(dir);
    const output: string[] = [];
    const io = { write: (message: string) => output.push(message) };

    await handleShellLine(state, "/use available", io);

    expect(state.activeProviders).toContain("heuristic");
    expect(state.activeProviders).not.toContain("hermes");
    expect(output.join("\n")).toContain("Active providers:");
  });

  it("refuses to review when the loaded diff is empty and tells you how to load one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-shell-"));
    const emptyPath = join(dir, "empty.diff");
    writeFileSync(emptyPath, "", "utf8");
    const state = createState(dir);
    const output: string[] = [];
    const io = { write: (message: string) => output.push(message) };

    await handleShellLine(state, "/diff empty.diff", io);
    await handleShellLine(state, "/review", io);

    expect(state.lastReport).toBeUndefined();
    expect(output.join("\n")).toContain("No changes to review");
    expect(output.join("\n")).toContain("/git");
  });

  it("preflights selected providers before running a council request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-shell-"));
    const state = createState(dir);
    const output: string[] = [];
    const io = { write: (message: string) => output.push(message) };

    await handleShellLine(state, "/use hermes", io);
    await handleShellLine(state, "/plan shell safety", io);

    expect(state.lastReport).toBeUndefined();
    expect(output.join("\n")).toContain("Provider preflight failed");
    // Either failure is valid and blocks the run; which one depends on whether the
    // `hermes` CLI happens to be installed on the machine running the tests (it is
    // not on CI), so accept both rather than assuming a PATH-dependent outcome.
    expect(output.join("\n")).toMatch(
      /hermes (is not available on PATH|has no runnable headless profile)/
    );
  });

  it("keeps the shell alive when a command fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-shell-"));
    const state = createState(dir);
    const output: string[] = [];
    const io = { write: (message: string) => output.push(message) };

    const result = await handleShellLine(state, "/diff missing.diff", io);

    expect(result.exit).toBe(false);
    expect(output.join("\n")).toContain("Error:");
    expect(state.transcript[0].input).toBe("/diff missing.diff");
  });

  it("validates startup provider selections", () => {
    const config = createDefaultConfig([]);

    expect(validateProviderSelection(config, "heuristic,codex")).toEqual([]);
    expect(validateProviderSelection(config, "nope,codex")).toEqual(["nope"]);
  });
});
