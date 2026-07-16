import { z } from "zod";

import { finalVerdict } from "./council.js";
import { fingerprintFinding } from "./identity.js";
import { severities } from "./types.js";
import type { CouncilReport, Finding, Severity } from "./types.js";

/**
 * Baseline mode lets a team adopt Quorate on an existing codebase without being
 * blocked by legacy findings: a committed baseline records the fingerprints of
 * known issues, and a review gated against it only fails on NEW findings.
 *
 * The baseline file is committed to the repo (so teammates and CI share it), so
 * it lives at the repo root as `.quorate.baseline.json` — NOT inside `.quorate/`,
 * which `quorate init` gitignores wholesale. In CI it must be read from the PR
 * BASE ref, never the head, or a pull request could baseline its own new
 * findings to weaken the gate.
 */

/** Current on-disk schema version. Bump only on a breaking format change. */
export const BASELINE_VERSION = 1;

/** Default committed location, a sibling of `.quorate.yml`. */
export const DEFAULT_BASELINE_PATH = ".quorate.baseline.json";

/** One baselined finding. `fingerprint` is the match key; the rest is for humans. */
export interface BaselineEntry {
  fingerprint: string;
  severity: Severity;
  title: string;
  file?: string;
}

export interface BaselineStore {
  version: number;
  generatedAt: string;
  /** Optional expiry. Consumers may reject stale baselines; the Action does. */
  expiresAfterDays?: number;
  findings: BaselineEntry[];
}

export interface BaselineFilterResult {
  /** Findings NOT in the baseline — the ones a gated review acts on. */
  kept: Finding[];
  /** Findings matched against the baseline and therefore suppressed. */
  suppressed: Finding[];
}

const baselineEntrySchema = z.object({
  fingerprint: z.string().min(1),
  severity: z.enum(severities),
  title: z.string(),
  file: z.string().optional()
});

const baselineStoreSchema = z.object({
  version: z.number().int(),
  generatedAt: z.string().datetime({ offset: true }),
  expiresAfterDays: z.number().int().positive().optional(),
  findings: z.array(baselineEntrySchema)
});

/** Stable fingerprint for a finding, using the stamped value when present. */
function fingerprintOf(finding: Finding): string {
  return finding.fingerprint ?? fingerprintFinding(finding);
}

export interface CreateBaselineOptions {
  expiresAfterDays?: number;
  /** Injected for determinism in tests; defaults to now. */
  generatedAt?: string;
}

/**
 * Build a baseline from a set of findings — one entry per distinct fingerprint,
 * sorted by fingerprint so the committed file has a stable, review-friendly diff.
 */
export function createBaseline(findings: Finding[], options: CreateBaselineOptions = {}): BaselineStore {
  const byFingerprint = new Map<string, BaselineEntry>();
  for (const finding of findings) {
    const fingerprint = fingerprintOf(finding);
    if (byFingerprint.has(fingerprint)) continue;
    byFingerprint.set(fingerprint, {
      fingerprint,
      severity: finding.severity,
      title: finding.title,
      ...(finding.file !== undefined ? { file: finding.file } : {})
    });
  }
  const sorted = [...byFingerprint.values()].sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint)
  );
  return {
    version: BASELINE_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ...(options.expiresAfterDays !== undefined ? { expiresAfterDays: options.expiresAfterDays } : {}),
    findings: sorted
  };
}

/** Serialize a baseline to pretty JSON with a trailing newline. */
export function serializeBaseline(store: BaselineStore): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

/**
 * Parse and validate a baseline file. Throws a user-facing Error on malformed
 * JSON or an unsupported version (a forward-incompatible file must fail loudly,
 * not silently suppress nothing).
 */
export function parseBaseline(raw: string): BaselineStore {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Invalid baseline file: not valid JSON.");
  }
  const parsed = baselineStoreSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid baseline file: ${parsed.error.issues[0]?.message ?? "schema mismatch"}.`);
  }
  if (parsed.data.version !== BASELINE_VERSION) {
    throw new Error(
      `Unsupported baseline version ${parsed.data.version} (expected ${BASELINE_VERSION}). Regenerate with \`quorate baseline --update\`.`
    );
  }
  return parsed.data;
}

/** Partition findings into those not in the baseline (kept) and those in it (suppressed). */
export function filterBaselineFindings(findings: Finding[], store: BaselineStore): BaselineFilterResult {
  const baselined = new Set(store.findings.map((entry) => entry.fingerprint));
  const kept: Finding[] = [];
  const suppressed: Finding[] = [];
  for (const finding of findings) {
    if (baselined.has(fingerprintOf(finding))) {
      suppressed.push(finding);
    } else {
      kept.push(finding);
    }
  }
  return { kept, suppressed };
}

/**
 * Apply a baseline to a finished report: drop baselined findings and RECOMPUTE
 * the verdict on the remaining set (so a report that was `fail` only because of
 * already-accepted issues becomes `pass`). The degraded→warn override is
 * preserved — a heuristic-only run never yields a confident green. Returns the
 * original report unchanged (same reference) when nothing matched.
 *
 * Only the canonical, clustered `report.findings` list is filtered — this is the
 * list gating, rendering, and exports use. Per-lane `providerResults[i].findings`
 * is intentionally left as the RAW record of what each provider reported, so the
 * provider-runs view still reflects the actual run.
 */
export function applyBaseline(report: CouncilReport, store: BaselineStore): CouncilReport {
  const { kept, suppressed } = filterBaselineFindings(report.findings, store);
  if (suppressed.length === 0) return report;

  const verdict = finalVerdict(kept, report.providerResults, report.metadata.degraded);
  const summary = `Quorate found ${kept.length} finding${kept.length === 1 ? "" : "s"} after suppressing ${suppressed.length} baselined.`;
  return {
    ...report,
    verdict,
    summary,
    findings: kept,
    metadata: { ...report.metadata, baselinedFindings: suppressed.length }
  };
}

/** True when the baseline has an expiry and that window has elapsed (advisory only). */
export function isBaselineStale(store: BaselineStore, nowMs: number = Date.now()): boolean {
  if (store.expiresAfterDays === undefined) return false;
  const generated = Date.parse(store.generatedAt);
  if (Number.isNaN(generated)) return false;
  return generated + store.expiresAfterDays * 86_400_000 <= nowMs;
}
