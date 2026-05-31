import type { CouncilMode } from "./types.js";

/**
 * A review needs a diff to inspect. Returns true when the request is a review
 * with no usable diff content, so callers can fail fast with an actionable
 * message instead of running the council on nothing (which silently degrades).
 */
export function isEmptyReviewDiff(mode: CouncilMode, diff?: string): boolean {
  return mode === "review" && (diff === undefined || diff.trim().length === 0);
}
