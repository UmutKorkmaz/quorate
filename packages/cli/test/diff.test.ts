import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDiff, run } from "../src/diff.js";

describe("readDiff", () => {
  it("reads a diff from an explicit file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-cli-"));
    const diffPath = join(dir, "change.diff");
    writeFileSync(diffPath, "diff --git a/a b/a\n", "utf8");

    expect(readDiff({ diff: diffPath })).toBe("diff --git a/a b/a\n");
  });

  it("throws a validation error for a non-numeric pr without spawning gh", () => {
    expect(() => readDiff({ pr: "abc" })).toThrow(
      "Invalid PR number: 'abc'. Use a numeric PR id, e.g. /pr 123."
    );
  });

  it("throws a validation error for an empty/whitespace pr value", () => {
    expect(() => readDiff({ pr: "12a" })).toThrow(
      "Invalid PR number: '12a'. Use a numeric PR id, e.g. /pr 123."
    );
  });

  it("throws a clean error outside git when no explicit diff source is provided", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-cli-non-git-"));

    expect(() => readDiff({}, dir)).toThrow(/No git repository found/);
  });
});

describe("run", () => {
  it("throws a helpful not-found error when the command is missing (ENOENT)", () => {
    expect(() => run("quorate-nonexistent-cmd", ["--version"], tmpdir())).toThrow(
      /not found on PATH/
    );
  });

  it("includes the command and args in a non-zero exit error", () => {
    expect(() => run("git", ["definitely-not-a-git-subcommand"], tmpdir())).toThrow(
      /git definitely-not-a-git-subcommand failed:/
    );
  });
});
