import type { Finding } from "./types.js";

/**
 * Default Jaccard similarity threshold for treating two findings' text as
 * describing the same topic. Exported so callers and tests can reuse it.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.6;

/**
 * Normalizes free text for token comparison: lowercases, strips punctuation
 * (anything that is not a letter, digit, or whitespace), and collapses runs of
 * whitespace into a single space. Trims the result.
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenizes text into a list of normalized word tokens. Empty input yields an
 * empty array.
 */
export function tokenize(s: string): string[] {
  const normalized = normalizeText(s);
  if (!normalized) return [];
  return normalized.split(" ");
}

/**
 * Jaccard similarity between two token sets: |A ∩ B| / |A ∪ B|.
 * Two empty sets are considered identical (1). One empty + one non-empty is 0.
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Jaccard similarity over the tokenized `title + " " + body` of two findings.
 */
export function titleBodySimilarity(a: Finding, b: Finding): number {
  const aTokens = new Set(tokenize(`${a.title} ${a.body}`));
  const bTokens = new Set(tokenize(`${b.title} ${b.body}`));
  return jaccard(aTokens, bTokens);
}

/**
 * Two findings share a location when they reference the same file (or both
 * reference no file) and their line numbers fall within `lineWindow` of each
 * other. A missing line number is treated as a wildcard that matches any line
 * on the same file.
 */
export function sameLocation(a: Finding, b: Finding, lineWindow = 3): boolean {
  const fileA = a.file ?? undefined;
  const fileB = b.file ?? undefined;
  if (fileA !== fileB) return false;

  // Missing line on either side is a wildcard match on the same file.
  if (a.line === undefined || b.line === undefined) return true;

  return Math.abs(a.line - b.line) <= lineWindow;
}

/**
 * Whether two findings describe the same underlying issue. Severity is NOT
 * required to match (different providers may rate the same bug differently);
 * clustering is by topic and location. Requires `sameLocation` AND a title/body
 * similarity at or above `threshold`.
 */
/**
 * Relaxed text threshold when two findings point at the SAME file and (nearly)
 * the same line: five reviewers phrase one stray console.log five ways, but
 * "console logging added" and "remove stray debug logging" share only a few
 * tokens. An exact-location match plus a little topical overlap is enough; the
 * remaining text check still keeps two genuinely different issues on one line
 * (e.g. a debug log AND a leaked secret) from collapsing.
 */
export const TIGHT_LOCATION_THRESHOLD = 0.18;

export function areSameFinding(
  a: Finding,
  b: Finding,
  threshold = DEFAULT_SIMILARITY_THRESHOLD
): boolean {
  if (!sameLocation(a, b)) return false;
  const tight =
    a.file !== undefined &&
    a.file === b.file &&
    a.line !== undefined &&
    b.line !== undefined &&
    Math.abs(a.line - b.line) <= 1;
  const effective = tight ? Math.min(threshold, TIGHT_LOCATION_THRESHOLD) : threshold;
  return titleBodySimilarity(a, b) >= effective;
}
