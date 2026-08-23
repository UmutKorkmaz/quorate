import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeSecureWorkspaceState } from "../src/secure-state.js";

let workspace: string;
let outside: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "quorate-secure-state-workspace-"));
  outside = mkdtempSync(join(tmpdir(), "quorate-secure-state-outside-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("writeSecureWorkspaceState", () => {
  it("rejects a symlinked state directory without changing the outside victim", () => {
    const victim = join(outside, "latest.json");
    writeFileSync(victim, "outside remains intact\n", "utf8");
    symlinkSync(outside, join(workspace, ".quorate"));

    expect(() => writeSecureWorkspaceState(workspace, ".quorate/contract/latest.json", "replacement\n")).toThrow(/symbolic link/i);
    expect(readFileSync(victim, "utf8")).toBe("outside remains intact\n");
  });

  it("rejects a symlinked destination without changing the outside victim", () => {
    const victim = join(outside, "report.json");
    writeFileSync(victim, "outside remains intact\n", "utf8");
    writeSecureWorkspaceState(workspace, ".quorate/seed.json", "seed\n");
    symlinkSync(victim, join(workspace, ".quorate", "last-report.json"));

    expect(() => writeSecureWorkspaceState(workspace, ".quorate/last-report.json", "replacement\n")).toThrow(/symbolic link/i);
    expect(readFileSync(victim, "utf8")).toBe("outside remains intact\n");
  });

  it("rejects a non-directory state component", () => {
    writeFileSync(join(workspace, ".quorate"), "not a directory\n", "utf8");

    expect(() => writeSecureWorkspaceState(workspace, ".quorate/last-report.json", "replacement\n")).toThrow(/not a directory/i);
  });

  it.each(["", ".", "../outside.json", "/tmp/outside.json"])("rejects an unsafe fixed relative target: %j", (target) => {
    expect(() => writeSecureWorkspaceState(workspace, target, "replacement\n")).toThrow(/relative target/i);
  });

  it("does not publish a partial destination when publication fails after the temporary file is synced", () => {
    const destination = resolve(workspace, ".quorate", "last-report.json");

    expect(() =>
      writeSecureWorkspaceState(workspace, ".quorate/last-report.json", "complete report\n", {
        fault: (point) => {
          if (point === "after-temp-fsync") throw new Error("injected publication failure");
        }
      })
    ).toThrow("injected publication failure");

    expect(existsSync(destination)).toBe(false);
    expect(existsSync(resolve(workspace, ".quorate"))).toBe(true);
    expect(lstatSync(resolve(workspace, ".quorate")).isDirectory()).toBe(true);
  });
});
