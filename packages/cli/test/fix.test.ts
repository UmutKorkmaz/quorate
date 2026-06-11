import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Finding } from "@quorate/core";
import { createFixSnapshot, finalizeFix, latestFix, listFixes, revertFix } from "../src/fix.js";
import { buildFixPrompt, extractHunk } from "../src/fix-prompt.js";

const FINDING: Finding = {
  severity: "high",
  title: "Missing null check",
  body: "value may be undefined",
  file: "src/app.ts",
  line: 2
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "quorate-fix-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "t@t.t"]);
  git(repo, ["config", "user.name", "t"]);
  // Keep line endings byte-identical on every platform: Windows git defaults
  // core.autocrlf=true, which rewrites \n -> \r\n on checkout/restore and would
  // break the exact-content assertions below after a revert.
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "core.eol", "lf"]);
  writeFileSync(join(repo, "a.txt"), "original\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "init"]);
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("fix snapshot + revert", () => {
  it("reverts agent edits to tracked files and deletes agent-created files", () => {
    const meta = createFixSnapshot(repo, FINDING, "claude");
    expect(meta.treeDirty).toBe(false);

    // The "agent" edits a tracked file and creates a new one.
    writeFileSync(join(repo, "a.txt"), "agent-broke-this\n");
    writeFileSync(join(repo, "agent-new.txt"), "new\n");
    const { changedStat, newUntracked } = finalizeFix(repo, meta.fixId);
    expect(changedStat).toContain("a.txt");
    expect(newUntracked).toEqual(["agent-new.txt"]);

    const reverted = revertFix(repo, meta.fixId);
    expect(reverted.status).toBe("reverted");
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("original\n");
    expect(existsSync(join(repo, "agent-new.txt"))).toBe(false);
  });

  it("restores the user's pre-fix uncommitted changes after revert", () => {
    // The user had uncommitted work before the fix.
    writeFileSync(join(repo, "a.txt"), "user-work-in-progress\n");
    const meta = createFixSnapshot(repo, FINDING, "codex");
    expect(meta.treeDirty).toBe(true);
    expect(meta.stashSha).toBeTruthy();

    writeFileSync(join(repo, "a.txt"), "agent-overwrote\n");
    finalizeFix(repo, meta.fixId);

    revertFix(repo, meta.fixId);
    // Not HEAD's "original" — the user's pre-fix WIP is back.
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("user-work-in-progress\n");
  });

  it("refuses to revert when the tree changed after the fix (then allows --force)", () => {
    const meta = createFixSnapshot(repo, FINDING, "claude");
    writeFileSync(join(repo, "a.txt"), "agent-fix\n");
    finalizeFix(repo, meta.fixId);

    // The user keeps editing after the fix.
    writeFileSync(join(repo, "a.txt"), "agent-fix\nplus-user-edit\n");
    expect(() => revertFix(repo, meta.fixId)).toThrow(/changed since fix/);

    const forced = revertFix(repo, meta.fixId, { force: true });
    expect(forced.status).toBe("reverted");
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("original\n");
  });

  it("is idempotent: refuses a second revert, lists fixes, finds the latest", () => {
    const meta = createFixSnapshot(repo, FINDING, "claude");
    writeFileSync(join(repo, "a.txt"), "x\n");
    finalizeFix(repo, meta.fixId);
    revertFix(repo, meta.fixId);
    expect(() => revertFix(repo, meta.fixId)).toThrow(/already reverted/);
    expect(listFixes(repo)).toHaveLength(1);
    expect(latestFix(repo)?.fixId).toBe(meta.fixId);
  });
});

describe("fix prompt", () => {
  it("includes the finding, suggestion, line focus, and no-commit rule", () => {
    const prompt = buildFixPrompt({ ...FINDING, suggestion: "add a guard" }, "@@ -1,2 +1,2 @@");
    expect(prompt).toContain("severity: high");
    expect(prompt).toContain("src/app.ts:2");
    expect(prompt).toContain("SUGGESTED FIX");
    expect(prompt).toContain("line 2");
    expect(prompt).toContain("Do NOT commit");
    expect(prompt).toContain("@@ -1,2 +1,2 @@");
  });

  it("extracts the hunk covering the finding line from a unified diff", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 111..222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      "+added",
      " line2",
      " line3",
      "diff --git a/other.ts b/other.ts",
      "@@ -9,2 +9,2 @@",
      " other"
    ].join("\n");
    const hunk = extractHunk(diff, "src/app.ts", 2);
    expect(hunk).toContain("@@ -1,3 +1,4 @@");
    expect(hunk).toContain("+added");
    expect(hunk).not.toContain("other.ts");
    expect(extractHunk(diff, "missing.ts", 1)).toBe("");
  });
});
