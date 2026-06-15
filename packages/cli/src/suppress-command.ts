import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  DEFAULT_SUPPRESSION_PATH,
  addSuppression,
  applySuppressions,
  createSuppressionStore,
  listExpired,
  parseSuppressionStore,
  removeSuppression,
  serializeSuppressionStore,
  type CouncilReport,
  type SuppressionStore
} from "@quorate/core";

const LAST_REPORT_PATH = ".quorate/last-report.json";

export interface SuppressAddResult {
  path: string;
  fingerprint: string;
}

export interface SuppressStoreApplication {
  report: CouncilReport;
  /** The loaded store, or null when no committed store exists. */
  store: SuppressionStore | null;
  /** Notes for the user (missing store, malformed store, suppressed count). */
  notes: string[];
}

/** Load a committed suppression store, or null when none exists. Throws on malformed. */
export function loadSuppressionStore(cwd: string, storePath?: string): SuppressionStore | null {
  const path = resolve(cwd, storePath ?? DEFAULT_SUPPRESSION_PATH);
  if (!existsSync(path)) return null;
  return parseSuppressionStore(readFileSync(path, "utf8"));
}

/** Add a suppression to the committed store and write it. Requires --force to overwrite. */
export function writeSuppression(
  cwd: string,
  fingerprint: string,
  reason: string,
  options: { storePath?: string; expires?: string; createdAt: string }
): SuppressAddResult {
  const path = resolve(cwd, options.storePath ?? DEFAULT_SUPPRESSION_PATH);
  const existing = existsSync(path) ? parseSuppressionStore(readFileSync(path, "utf8")) : createSuppressionStore();
  const store = addSuppression(existing, {
    fingerprint,
    reason,
    createdAt: options.createdAt,
    ...(options.expires !== undefined ? { expires: options.expires } : {})
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeSuppressionStore(store), "utf8");
  return { path, fingerprint };
}

/** Remove a suppression from the committed store by fingerprint; returns whether it existed. */
export function removeSuppressionFromStore(
  cwd: string,
  fingerprint: string,
  storePath?: string
): boolean {
  const path = resolve(cwd, storePath ?? DEFAULT_SUPPRESSION_PATH);
  if (!existsSync(path)) return false;
  const existing = parseSuppressionStore(readFileSync(path, "utf8"));
  const had = existing.suppressions.some((e) => e.fingerprint === fingerprint);
  if (!had) return false;
  const store = removeSuppression(existing, fingerprint);
  writeFileSync(path, serializeSuppressionStore(store), "utf8");
  return true;
}

/**
 * Apply the committed suppression store to a report. A missing store is a soft
 * no-op; a malformed store warns and falls back to the unfiltered report (a bad
 * store must never silently widen the gate, but it also must not crash a review).
 */
export function applySuppressionStore(
  report: CouncilReport,
  cwd: string,
  storePath?: string,
  nowMs: number = Date.now()
): SuppressStoreApplication {
  const notes: string[] = [];
  let store: SuppressionStore | null;
  try {
    store = loadSuppressionStore(cwd, storePath);
  } catch (error: unknown) {
    notes.push(error instanceof Error ? error.message : String(error));
    return { report, store: null, notes };
  }
  if (!store) return { report, store: null, notes };

  const expired = listExpired(store, nowMs);
  if (expired.length > 0) {
    notes.push(
      `${expired.length} suppression(s) have expired and no longer apply (re-triage with \`quorate suppress audit\`).`
    );
  }
  const out = applySuppressions(report, store, nowMs);
  if (out.metadata.suppressedFindings) {
    notes.push(`${out.metadata.suppressedFindings} finding(s) suppressed by the committed store.`);
  }
  return { report: out, store, notes };
}

/** Read the last report so `suppress` can look up a finding by its number. */
export function loadLastReport(cwd: string, reportPath?: string): CouncilReport | null {
  const path = resolve(cwd, reportPath ?? LAST_REPORT_PATH);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as CouncilReport;
}
