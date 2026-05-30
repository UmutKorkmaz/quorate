import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDiff } from "../src/diff.js";

describe("readDiff", () => {
  it("reads a diff from an explicit file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-cli-"));
    const diffPath = join(dir, "change.diff");
    writeFileSync(diffPath, "diff --git a/a b/a\n", "utf8");

    expect(readDiff({ diff: diffPath })).toBe("diff --git a/a b/a\n");
  });
});
