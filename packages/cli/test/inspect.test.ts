import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "@quorate/core";
import { inspectText, type ShellState } from "../src/session.js";
import { handleShellLine, parseShellCommand } from "../src/shell.js";

function createState(cwd: string, overrides: Partial<ShellState> = {}): ShellState {
  return {
    cwd,
    config: createDefaultConfig([]),
    mode: "review",
    transcript: [],
    ...overrides
  };
}

describe("parseShellCommand", () => {
  it("parses /inspect as a slash command", () => {
    expect(parseShellCommand("/inspect")).toEqual({ kind: "inspect" });
  });
});

describe("inspectText", () => {
  it("reports config path, active agents, roles, and spawn status", () => {
    const cwd = mkdtempSync(join(tmpdir(), "quorate-inspect-"));
    const state = createState(cwd, {
      diffLabel: "sample.diff",
      activeProviders: ["heuristic"],
      activeRoles: ["security", "qa"]
    });

    const text = inspectText(state);

    expect(text).toContain("Inspect");
    expect(text).toContain("session diagnostics");
    expect(text).toContain(`Cwd: ${cwd}`);
    expect(text).toContain("Mode: review");
    expect(text).toContain("Diff: sample.diff");
    expect(text).toContain("Active agents: heuristic");
    expect(text).toContain("Roles: security, qa");
    expect(text).toContain("Provider spawn status:");
    expect(text).toContain("heuristic");
    expect(text).toContain("built-in");
  });

  it("shows heuristic fallback when no agents are active", () => {
    const cwd = mkdtempSync(join(tmpdir(), "quorate-inspect-empty-"));
    const text = inspectText(createState(cwd, { activeProviders: [] }));

    expect(text).toContain("Active agents: heuristic fallback");
    expect(text).toContain("no active agents");
  });
});

describe("handleShellLine /inspect", () => {
  it("emits inspect diagnostics in the classic shell", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-inspect-shell-"));
    const diffPath = join(dir, "sample.diff");
    writeFileSync(
      diffPath,
      `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1,2 @@
+a
`,
      "utf8"
    );

    const state = createState(dir);
    const output: string[] = [];
    const io = { write: (message: string) => output.push(message) };

    await handleShellLine(state, "/diff sample.diff", io);
    await handleShellLine(state, "/inspect", io);

    const joined = output.join("\n");
    expect(joined).toContain("Inspect");
    expect(joined).toContain("Active agents:");
    expect(joined).toContain("sample.diff");
    expect(joined).toContain("Provider spawn status:");
  });
});