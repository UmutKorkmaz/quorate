import { z } from "zod";

import { finalVerdict } from "./council.js";
import { fingerprintFinding } from "./identity.js";
import type { CouncilReport, Finding } from "./types.js";

/**
 * Suppression management — the committed "accept this risk" record.
 *
 * Distinct from inline `quorate-ignore` comments (ephemeral, parsed from the
 * diff for heuristic findings) and from the baseline (which *removes* accepted
 * findings): suppression **tags** a finding `status: "suppressed"` and keeps it
 * VISIBLE, while the verdict and merge gate ignore it. A suppressed critical
 * therefore never fails the gate, but reviewers always see it was accepted — so
 * it can never pass *silently*.
 *
 * The committed store lives at `.quorate/suppressions.json` (gitignored by
 * `quorate init`; commit it with `git add -f`). In CI it must be read from the
 * PR BASE ref, never the head — a PR must not suppress its own new findings.
 */

export const SUPPRESSION_VERSION = 1;
export const DEFAULT_SUPPRESSION_PATH = ".quorate/suppressions.json";

/** A reason is ALWAYS required — silent suppression is never allowed. */
export interface SuppressionEntry {
  fingerprint: string;
  reason: string;
  /** Creation time (ISO). */
  createdAt: string;
  /** Optional hard expiry; once passed the finding is active again. */
  expires?: string;
}

export interface SuppressionStore {
  version: number;
  suppressions: SuppressionEntry[];
}

const entrySchema = z.object({
  fingerprint: z.string().min(1),
  reason: z.string().min(1),
  createdAt: z.string().min(1),
  expires: z.string().optional()
});

const storeSchema = z.object({
  version: z.number().int(),
  suppressions: z.array(entrySchema)
});

export function createSuppressionStore(): SuppressionStore {
  return { version: SUPPRESSION_VERSION, suppressions: [] };
}

export function serializeSuppressionStore(store: SuppressionStore): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

/**
 * Parse and validate a suppression store. Throws a user-facing Error on
 * malformed JSON, a wrong version, or any entry missing a reason — a bad store
 * must fail loud, never silently widen the gate.
 */
export function parseSuppressionStore(raw: string): SuppressionStore {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Invalid suppression store: not valid JSON.");
  }
  const parsed = storeSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Invalid suppression store: ${parsed.error.issues[0]?.message ?? "schema mismatch"}.`
    );
  }
  if (parsed.data.version !== SUPPRESSION_VERSION) {
    throw new Error(
      `Unsupported suppression store version ${parsed.data.version} (expected ${SUPPRESSION_VERSION}). Regenerate with \`quorate suppress\`.`
    );
  }
  return parsed.data;
}

export interface AddSuppressionInput {
  fingerprint: string;
  reason: string;
  createdAt: string;
  expires?: string;
}

/**
 * Add (or replace) a suppression by fingerprint. Immutable — returns a new
 * store. Requires a non-blank reason; deduplicates by fingerprint (latest wins).
 */
export function addSuppression(store: SuppressionStore, input: AddSuppressionInput): SuppressionStore {
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new Error("A non-empty reason is required to suppress a finding.");
  }
  const entry: SuppressionEntry = {
    fingerprint: input.fingerprint,
    reason,
    createdAt: input.createdAt,
    ...(input.expires !== undefined ? { expires: input.expires } : {})
  };
  const rest = store.suppressions.filter((e) => e.fingerprint !== input.fingerprint);
  // Stable order by fingerprint so the committed file has a clean diff.
  const suppressions = [...rest, entry].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  return { ...store, suppressions };
}

/** Remove a suppression by fingerprint. Immutable; a no-op if absent. */
export function removeSuppression(store: SuppressionStore, fingerprint: string): SuppressionStore {
  return { ...store, suppressions: store.suppressions.filter((e) => e.fingerprint !== fingerprint) };
}

/** True when the store has an unexpired entry for this fingerprint. */
export function isSuppressed(
  store: SuppressionStore,
  fingerprint: string,
  nowMs: number = Date.now()
): boolean {
  return store.suppressions.some((entry) => {
    if (entry.fingerprint !== fingerprint) return false;
    if (entry.expires !== undefined && Date.parse(entry.expires) <= nowMs) return false;
    return true;
  });
}

/** Entries that have passed their expiry — for `suppress audit`. */
export function listExpired(store: SuppressionStore, nowMs: number = Date.now()): SuppressionEntry[] {
  return store.suppressions.filter(
    (entry) => entry.expires !== undefined && Date.parse(entry.expires) <= nowMs
  );
}

/**
 * Apply a suppression store to a finished report: tag matching findings
 * `status: "suppressed"` (they STAY visible) and recompute the verdict on the
 * remaining active set, preserving the degraded→warn override. Returns the
 * original report unchanged (same reference) when nothing matched.
 */
export function applySuppressions(
  report: CouncilReport,
  store: SuppressionStore,
  nowMs: number = Date.now()
): CouncilReport {
  if (store.suppressions.length === 0) return report;

  let tagged = 0;
  const findings = report.findings.map((finding) => {
    const fingerprint = finding.fingerprint ?? fingerprintFinding(finding);
    if (isSuppressed(store, fingerprint, nowMs)) {
      tagged += 1;
      return { ...finding, fingerprint, status: "suppressed" as const };
    }
    return finding;
  });

  if (tagged === 0) return report;

  // Verdict is recomputed over the ACTIVE findings only; suppressed findings
  // remain in the array for visibility but do not affect the verdict or gate.
  const active = findings.filter((finding) => finding.status !== "suppressed");
  const verdict = finalVerdict(active, report.providerResults, report.metadata.degraded);
  const activeCount = active.length;
  const summary = `${activeCount} active finding${activeCount === 1 ? "" : "s"} (${tagged} suppressed).`;
  return {
    ...report,
    verdict,
    summary,
    findings,
    metadata: { ...report.metadata, suppressedFindings: tagged }
  };
}
