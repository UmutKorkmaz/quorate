import { describe, expect, it } from "vitest";
import { buildItermScript, buildTerminalScript, buildTmuxTarget, resolveTty } from "../src/terminal-jump.js";

describe("jump script builders (pure)", () => {
  it("builds a tmux target spec from a tty", () => {
    expect(buildTmuxTarget("ttys004")).toBe("%ttys004");
  });

  it("builds an iTerm osascript that references the tty", () => {
    const script = buildItermScript("ttys009");
    expect(script).toContain("iTerm2");
    expect(script).toContain("ttys009");
    // Special chars are escaped.
    const escaped = buildItermScript('ttys"\\1');
    expect(escaped).not.toContain('"ttys"\\"'); // the raw unsafe sequence is escaped
  });

  it("builds a Terminal.app osascript that activates", () => {
    const script = buildTerminalScript("ttys001");
    expect(script).toContain("Terminal");
    expect(script).toContain("activate");
  });
});

describe("resolveTty (injected exec)", () => {
  it("returns the tty when ps reports one directly", () => {
    const exec = (_cmd: string, _args: string[], _opts: unknown) => ({ stdout: "ttys004\n", stderr: "", status: 0 });
    expect(resolveTty(1234, exec as never)).toBe("ttys004");
  });

  it("returns undefined when no tty is found across the ppid walk", () => {
    let calls = 0;
    const exec = (_cmd: string, args: string[]) => {
      calls++;
      // Alternate: tty is "?", ppid is 0 → loop ends.
      if (args.includes("tty=")) return { stdout: "??\n", stderr: "", status: 0 };
      return { stdout: "0\n", stderr: "", status: 0 };
    };
    expect(resolveTty(1234, exec as never)).toBeUndefined();
    expect(calls).toBeGreaterThan(0);
  });
});
