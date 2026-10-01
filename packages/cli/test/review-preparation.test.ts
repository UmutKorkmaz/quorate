import { describe, expect, it } from "vitest";
import { createDefaultConfig, type CouncilRequest } from "@quorate/core";
import { prepareReviewRequest } from "../src/review-preparation.js";

const LOCK_DIFF = [
  "diff --git a/package-lock.json b/package-lock.json",
  "--- a/package-lock.json",
  "+++ b/package-lock.json",
  "@@ -1 +1 @@",
  "-old",
  "+new"
].join("\n");

const SOURCE_DIFF = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new"
].join("\n");

function request(diff: string): CouncilRequest {
  return { mode: "review", subject: "review", repoPath: "/repo", diff };
}

function config() {
  const base = createDefaultConfig([]);
  return { ...base, budget: { ...base.budget, skipGenerated: true } };
}

describe("shared review preparation", () => {
  it("rejects a generated-only diff before either CLI surface convenes providers", () => {
    expect(() => prepareReviewRequest(request(LOCK_DIFF), config())).toThrow(
      "No reviewable changes remain after budget/generated-file filtering."
    );
  });

  it("keeps source changes, drops generated files, and preserves the full diff", () => {
    const fullDiff = `${LOCK_DIFF}\n${SOURCE_DIFF}`;

    const prepared = prepareReviewRequest(request(fullDiff), config());

    expect(prepared.diff).toContain("src/app.ts");
    expect(prepared.diff).not.toContain("package-lock.json");
    expect(prepared.fullDiff).toBe(fullDiff);
    expect(prepared.budget?.skippedGeneratedFiles).toEqual(["package-lock.json"]);
  });
});
