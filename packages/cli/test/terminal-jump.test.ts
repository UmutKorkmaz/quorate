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


it("normalizes complete tty tokens and refuses malformed suffixes", async () => {
  const m=await import("../src/terminal-jump.js");
  expect(m.normalizeTty("/dev/ttys006")).toBe("ttys006");
  expect(m.normalizeTty("pts/3")).toBe("pts/3");
  expect(m.normalizeTty("/dev/ttys006junk")).toBeUndefined();
});
it("selects exact tmux session window and pane instead of a tty prefix", async () => {
  const m=await import("../src/terminal-jump.js"), calls:string[][]=[];
  const exec:import("../src/terminal-jump.js").Exec=(_cmd,args)=>{
    calls.push(args);
    return {status:0,stderr:"",stdout:args[0]==="list-panes" ? "/dev/ttys0060 owned:0.1\n/dev/ttys006 owned:0.0\n" : ""};
  };
  expect(m.selectTmuxPane("ttys006",exec)).toBe(true);
  expect(calls.slice(1)).toEqual([["switch-client","-t","owned"],["select-window","-t","owned:0"],["select-pane","-t","owned:0.0"]]);
  expect(m.selectTmuxPane("ttys006",()=>({status:1,stdout:"",stderr:"fail"}))).toBe(false);
});
