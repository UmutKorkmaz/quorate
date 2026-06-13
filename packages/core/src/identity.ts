import { createHash } from "node:crypto";

import type { CouncilMode, Finding } from "./types.js";

/**
 * Canonical identity primitives for Quorate findings and review runs.
 *
 * These functions are the SINGLE source of truth for content-derived identity.
 * Baseline matching, suppression, SARIF `ruleId`s, and the GitHub Action's
 * inline-comment markers all key off them — so they MUST stay deterministic and
 * stable across releases. Changing the normalization or hashing below silently
 * invalidates every stored baseline/suppression and makes Code Scanning treat
 * previously-seen findings as brand new. A pinned golden-value test
 * (`identity.test.ts`) guards against accidental drift, including drift between
 * this source and the bundled GitHub Action.
 *
 * Keys are built with `JSON.stringify` over a fixed-shape array so the encoding
 * is inherently unambiguous (no "a b"+"c" vs "a"+"b c" delimiter collisions)
 * and contains no invisible control characters.
 *
 * The normalization is deliberately frozen and local — it does NOT import
 * `normalizeText` from `similarity.ts`, whose tokenization is free to evolve for
 * clustering without dragging identity along with it.
 *
 * KNOWN LIMITATION (by design): `fingerprintFinding` includes `severity`, so if
 * the same underlying issue is reported at a different severity across runs
 * (e.g. a critical-flagging provider is unavailable and the finding degrades to
 * high), its fingerprint changes and a stored baseline/suppression stops
 * matching. Severity is kept in the key so distinct severities remain distinct
 * suppressions; the escape hatch is re-baselining (`baseline --update`).
 */

const HEX = 16;
const RULE_HEX = 8;

/**
 * Frozen text normalization for identity. NFC-normalizes, lowercases, replaces
 * every run of non-(Unicode letter/number) characters with a single space, and
 * trims. Unicode-aware (`\p{L}\p{N}`) so CJK and accented titles are preserved
 * rather than stripped to a common prefix. Do not change this without a
 * deliberate identity-version bump — it is load-bearing.
 */
export function normalizeFingerprintText(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Title component of an identity key. Uses the frozen normalization, but falls
 * back to the raw (trimmed, lowercased) title when normalization yields an
 * empty string — i.e. titles made entirely of emoji or punctuation. Without the
 * fallback, all such titles would collapse to one fingerprint.
 */
function titleKey(title: string): string {
  const normalized = normalizeFingerprintText(title);
  return normalized.length > 0 ? normalized : `raw:${title.trim().toLowerCase()}`;
}

function hash(parts: readonly string[], length: number): string {
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex").slice(0, length);
}

/**
 * Stable INSTANCE identity for a single finding: keyed on severity + file +
 * normalized title. The same issue in two different files yields two distinct
 * fingerprints; a missing file is treated as the empty string. Body, line,
 * provider, and agreement are intentionally excluded so wording drift in the
 * body or a shifted line number does not break a stored baseline/suppression.
 *
 * Returns a 16-char lowercase hex string (64 bits — collision-safe at repo
 * scale). See the module-level KNOWN LIMITATION note re: severity changes.
 */
export function fingerprintFinding(finding: Finding): string {
  return hash([finding.severity, finding.file ?? "", titleKey(finding.title)], HEX);
}

/**
 * Stable CLASS identity for a finding, used as a SARIF `ruleId` (and any other
 * place that groups findings by kind rather than location). Keyed on severity +
 * normalized title only — NO file — so the same kind of finding across many
 * files maps to one rule, with the location carried separately by the consumer.
 *
 * NOTE: this is a 32-bit display id for grouping/SARIF only. Do NOT use it as a
 * suppression or baseline key — use `fingerprintFinding` for that. At thousands
 * of distinct finding classes its birthday-collision probability is non-trivial,
 * which is acceptable for a human-readable rule id but not for a gate key.
 */
export function findingRuleId(finding: Finding): string {
  return `quorate.${finding.severity}.${hash([finding.severity, titleKey(finding.title)], RULE_HEX)}`;
}

export interface ReviewIdInput {
  /** Always contributes to the id, so a plan-mode run never collides with a review-mode run on the same diff. */
  mode: CouncilMode;
  /** Used as the identity basis ONLY when `diff` is absent/blank; a present diff overrides it. */
  subject: string;
  /** The unified diff under review; absent for plan-mode runs. */
  diff?: string;
  /** Provider ids that participated (order-independent). */
  providerIds: string[];
  /** Council roles in play (order-independent). */
  councils: string[];
}

/**
 * Normalize a diff so cosmetic line-ending (CRLF or bare-CR) and trailing-
 * whitespace differences do not change the review identity, while genuine
 * content changes do.
 */
function normalizeDiff(diff: string): string {
  return diff
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();
}

/**
 * Stable, content-derived identity for a whole review run:
 * `SHA256(JSON([mode, basis, sortedProviders, sortedCouncils]))`, 16-char hex.
 *
 * The same diff reviewed by the same providers/councils in the same mode always
 * yields the same id — the foundation for review history, flake comparison
 * (identical-diff reruns), and CI artifact correlation. When a diff is present
 * the `subject` is intentionally excluded (so "PR #12" and "PR #13" with an
 * identical diff share an id); for plan-mode runs with no diff the basis is the
 * subject, so two plan runs of the same prompt collapse to one id.
 */
export function computeReviewId(input: ReviewIdInput): string {
  const basis =
    input.diff && input.diff.trim().length > 0 ? normalizeDiff(input.diff) : input.subject.trim();
  const providers = [...new Set(input.providerIds)].sort();
  const councils = [...new Set(input.councils)].sort();
  return createHash("sha256")
    .update(JSON.stringify([input.mode, basis, providers, councils]), "utf8")
    .digest("hex")
    .slice(0, HEX);
}
