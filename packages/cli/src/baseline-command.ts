import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  DEFAULT_BASELINE_PATH,
  applyBaseline,
  createBaseline,
  isBaselineStale,
  parseBaseline,
  serializeBaseline,
  type BaselineStore,
  type CouncilReport
} from "@quorate/core";

const LAST_REPORT_PATH = ".quorate/last-report.json";

export interface BaselineWriteOptions {
  cwd: string;
  /** Source report to baseline from (default `.quorate/last-report.json`). */
  reportPath?: string;
  /** Where to write the baseline (default `.quorate.baseline.json`, committed). */
  baselinePath?: string;
  /** Allow overwriting an existing baseline. */
  update?: boolean;
  /** Advisory expiry in days. */
  expiresDays?: number;
}

export interface BaselineWriteResult {
  path: string;
  count: number;
  overwritten: boolean;
}

/**
 * Create or refresh the committed baseline from a finished report. Refuses to
 * clobber an existing baseline unless `update` is set, so a stray `quorate
 * baseline` can't silently widen the accepted-issue set.
 */
export function writeBaselineFromReport(options: BaselineWriteOptions): BaselineWriteResult {
  const reportPath = resolve(options.cwd, options.reportPath ?? LAST_REPORT_PATH);
  if (!existsSync(reportPath)) {
    throw new Error(
      `No report found at ${reportPath}. Run \`quorate review\` first, or pass --report <path>.`
    );
  }
  let report: CouncilReport;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8")) as CouncilReport;
  } catch {
    throw new Error(`Could not parse report at ${reportPath} as JSON.`);
  }
  if (!Array.isArray(report.findings)) {
    throw new Error(`Report at ${reportPath} has no findings array — is it a Quorate report?`);
  }

  const baselinePath = resolve(options.cwd, options.baselinePath ?? DEFAULT_BASELINE_PATH);
  const overwritten = existsSync(baselinePath);
  if (overwritten && !options.update) {
    throw new Error(`Baseline already exists at ${baselinePath}. Use --update to overwrite it.`);
  }

  const store = createBaseline(report.findings ?? [], { expiresAfterDays: options.expiresDays });
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, serializeBaseline(store), "utf8");
  return { path: baselinePath, count: store.findings.length, overwritten };
}

/** Load a baseline from disk, or null when none exists. Throws on a malformed file. */
export function loadBaseline(cwd: string, baselinePath?: string): BaselineStore | null {
  const path = resolve(cwd, baselinePath ?? DEFAULT_BASELINE_PATH);
  if (!existsSync(path)) return null;
  return parseBaseline(readFileSync(path, "utf8"));
}

export interface BaselineApplication {
  report: CouncilReport;
  /** Notes to surface to the user on stderr (missing baseline, staleness, counts). */
  notes: string[];
}

/**
 * Apply the committed baseline to a report for a gated review. Returns the
 * (possibly filtered) report plus human-facing notes. A missing baseline is a
 * soft no-op so `review --baseline` never hard-fails just because the file is
 * absent on a first run.
 */
export function applyBaselineToReport(
  report: CouncilReport,
  cwd: string,
  baselinePath?: string,
  nowMs: number = Date.now()
): BaselineApplication {
  const notes: string[] = [];
  let store: BaselineStore | null;
  try {
    store = loadBaseline(cwd, baselinePath);
  } catch (error: unknown) {
    notes.push(error instanceof Error ? error.message : String(error));
    return { report, notes };
  }
  if (!store) {
    notes.push(
      `No baseline found at ${resolve(cwd, baselinePath ?? DEFAULT_BASELINE_PATH)} — gating on all findings. Create one with \`quorate baseline\`.`
    );
    return { report, notes };
  }
  if (isBaselineStale(store, nowMs)) {
    notes.push(
      `Baseline is past its ${store.expiresAfterDays}-day expiry (generated ${store.generatedAt}) — consider \`quorate baseline --update\`.`
    );
  }
  const filtered = applyBaseline(report, store);
  if (filtered.metadata.baselinedFindings) {
    notes.push(`Suppressed ${filtered.metadata.baselinedFindings} finding(s) matching the baseline.`);
  }
  return { report: filtered, notes };
}
