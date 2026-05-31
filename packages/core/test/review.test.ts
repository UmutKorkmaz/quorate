import { describe, expect, it } from "vitest";
import { isEmptyReviewDiff } from "../src/review.js";

describe("isEmptyReviewDiff", () => {
  it("is true for a review with an undefined, empty, or whitespace-only diff", () => {
    expect(isEmptyReviewDiff("review", undefined)).toBe(true);
    expect(isEmptyReviewDiff("review", "")).toBe(true);
    expect(isEmptyReviewDiff("review", "   \n\t  ")).toBe(true);
  });

  it("is false for a review that has diff content", () => {
    expect(isEmptyReviewDiff("review", "diff --git a/x b/x\n+line")).toBe(false);
  });

  it("is false for plan mode regardless of diff (plans need no diff)", () => {
    expect(isEmptyReviewDiff("plan", undefined)).toBe(false);
    expect(isEmptyReviewDiff("plan", "")).toBe(false);
  });
});
