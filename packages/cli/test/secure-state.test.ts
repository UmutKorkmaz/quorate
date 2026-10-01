import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
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

  it("rejects a temporary path replaced with a symlink after fsync without publishing that symlink", () => {
    const victim = join(outside, "victim.json");
    const destination = join(workspace, ".quorate", "last-report.json");
    writeFileSync(victim, "outside remains intact\n", "utf8");

    expect(() => writeSecureWorkspaceState(workspace, ".quorate/last-report.json", "secret report\n", {
      fault: (point) => {
        if (point !== "after-temp-fsync") return;
        const parent = join(workspace, ".quorate");
        const temporary = readdirSync(parent).find((entry) => entry.startsWith(".quorate-state-"));
        if (!temporary) throw new Error("expected temporary state file");
        rmSync(join(parent, temporary));
        symlinkSync(victim, join(parent, temporary));
      }
    })).toThrow(/temporary state file changed/i);

    expect(readFileSync(victim, "utf8")).toBe("outside remains intact\n");
    expect(existsSync(destination)).toBe(false);
  });

  it.skipIf(platform() === "win32")("zeros a moved temporary file when its parent is replaced after fsync", () => {
    const stateDir = join(workspace, ".quorate");
    const movedStateDir = join(workspace, ".quorate-moved");

    expect(() => writeSecureWorkspaceState(workspace, ".quorate/last-report.json", "secret report\n", {
      fault: (point) => {
        if (point !== "after-temp-fsync") return;
        renameSync(stateDir, movedStateDir);
        mkdirSync(stateDir);
      }
    })).toThrow();

    for (const entry of readdirSync(movedStateDir)) {
      expect(readFileSync(join(movedStateDir, entry), "utf8")).toBe("");
    }
  });

  it.skipIf(platform() === "win32")("preserves the workspace directory mode while making only state descendants private", () => {
    chmodSync(workspace, 0o755);

    writeSecureWorkspaceState(workspace, ".quorate/last-report.json", "report\n");

    expect(statSync(workspace).mode & 0o777).toBe(0o755);
    expect(statSync(join(workspace, ".quorate")).mode & 0o777).toBe(0o700);
  });

  it.each(["EINVAL", "ENOTSUP", "EOPNOTSUPP"])("succeeds when directory fsync is unsupported with %s", (code) => {
    expect(() => writeSecureWorkspaceState(workspace, ".quorate/last-report.json", "report\n", {
      fault: (point) => {
        if ((point as string) === "before-directory-fsync") {
          throw Object.assign(new Error(`injected ${code}`), { code });
        }
      }
    })).not.toThrow();
    expect(readFileSync(join(workspace, ".quorate", "last-report.json"), "utf8")).toBe("report\n");
  });

  it.skipIf(platform() === "win32")("does not confirm publication when the parent changes before directory fsync", () => {
    const stateDir = join(workspace, ".quorate");
    const movedStateDir = join(workspace, ".quorate-moved");
    const destination = join(stateDir, "last-report.json");
    const movedDestination = join(movedStateDir, "last-report.json");

    expect(() => writeSecureWorkspaceState(workspace, ".quorate/last-report.json", "secret report\n", {
      fault: (point) => {
        if (point !== "before-directory-fsync") return;
        renameSync(stateDir, movedStateDir);
        mkdirSync(stateDir);
      }
    })).toThrow(/state directory changed/i);

    expect(existsSync(destination)).toBe(false);
    expect(readFileSync(movedDestination, "utf8")).toBe("");
  });

  it.skipIf(platform() === "win32")("propagates a real directory fsync EIO", () => {
    expect(() => writeSecureWorkspaceState(workspace, ".quorate/last-report.json", "report\n", {
      fault: (point) => {
        if ((point as string) === "before-directory-fsync") {
          throw Object.assign(new Error("injected EIO"), { code: "EIO" });
        }
      }
    })).toThrow("injected EIO");
    expect(readFileSync(join(workspace, ".quorate", "last-report.json"), "utf8")).toBe("report\n");
  });
});
