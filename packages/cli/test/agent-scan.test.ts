import { describe, expect, it } from "vitest";
import { matchAgentName, parsePsOutput, scanExternalAgents, truncateCommand } from "../src/agent-scan.js";

const PS_SAMPLE = [
  "    PID    PPID ELAPPED COMMAND",
  "   1234   1000    1:23 /usr/local/bin/claude --no-update",
  "   1235   1234    1:22 claude --no-update",
  "   2000   1000   10:00 /Users/u/.local/bin/codex",
  "   2001   1000    0:05 /opt/homebrew/bin/goose",
  "   3000   1000    0:05 node /repo/quorate/packages/cli/dist/index.js monitor --web",
  "   4000   1000    0:05 /bin/sh -c quorate hook-report --source claude",
  "   5000   1000    0:05 /usr/bin/vim notes.txt"
].join("\n");

describe("matchAgentName", () => {
  it("matches the basename of a known CLI invocation", () => {
    expect(matchAgentName("/usr/local/bin/claude --no-update")).toBe("claude");
    expect(matchAgentName("/Users/u/.local/bin/codex")).toBe("codex");
    expect(matchAgentName("/opt/homebrew/bin/goose")).toBe("goose");
  });

  it("does not match incidental substrings", () => {
    expect(matchAgentName("/usr/bin/vim notes.txt")).toBeUndefined();
    expect(matchAgentName("bash -c echo hello")).toBeUndefined();
  });
});

describe("truncateCommand", () => {
  it("truncates with an ellipsis past the cap", () => {
    const long = "x".repeat(300);
    const truncated = truncateCommand(long);
    expect(truncated.length).toBeLessThanOrEqual(201);
    expect(truncated.endsWith("…")).toBe(true);
  });
});

describe("parsePsOutput", () => {
  it("extracts agents, excludes self/quorate, dedups by name+command", () => {
    // Arrange — pretend our pid is the claude process so it gets excluded.
    const selfPid = 1234;
    // Act
    const agents = parsePsOutput(PS_SAMPLE, selfPid);

    // Assert — claude 1234 excluded (self), 1235 (same command) dedups against nothing,
    // the quorate monitor + quorate hook-report rows are excluded, vim excluded.
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["claude", "codex", "goose"]);
    const claudeRow = agents.find((a) => a.name === "claude");
    expect(claudeRow?.pid).toBe(1235);
    expect(agents.some((a) => /quorate/.test(a.command))).toBe(false);
  });

  it("returns empty for blank/garbage input", () => {
    expect(parsePsOutput("", 1)).toEqual([]);
    expect(parsePsOutput("\n\n  \n", 1)).toEqual([]);
  });
});

describe("scanExternalAgents with injected exec", () => {
  it("returns parsed agents on POSIX with a working exec", () => {
    // Arrange
    const exec = () => ({ stdout: "   4242   1000    0:01 /usr/local/bin/kimi" });

    // Act
    const agents = scanExternalAgents({ exec, selfPid: 1 });

    // Assert
    expect(agents.map((a) => a.name)).toEqual(["kimi"]);
  });

  it("returns empty when exec errors", () => {
    const exec = () => ({ error: "boom" });
    expect(scanExternalAgents({ exec, selfPid: 1 })).toEqual([]);
  });
});
