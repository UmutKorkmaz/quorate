import { severities, verdicts } from "./types.js";
import type { CouncilReport, Finding, ProviderRunStatus, Severity, Verdict } from "./types.js";

/**
 * Review history — a compact, append-only record of past runs so a team can see
 * trends (verdict distribution, noisiest files/titles, provider failure rates)
 * without external tooling.
 *
 * The store lives OUTSIDE the repo at `~/.quorate/history/<repoHash>.jsonl` (one
 * JSONL line per run), so it never pollutes the working tree or git. Each entry
 * is keyed by the K0 `reviewId` (stable for the same diff+config) — two reviews
 * of the same PR collapse to the same id, useful for flake comparison.
 *
 * Pure projections live here (no fs); the CLI module owns the append/read I/O.
 */

/** Max buckets retained per file/title map in a single entry (bounds line size). */
const TOP_N = 50;

/** One review, projected compactly from a CouncilReport. */
export interface HistoryEntry {
  reviewId?: string;
  generatedAt: string;
  verdict: Verdict;
  degraded: boolean;
  mode: string;
  subject: string;
  /** Ran provider:role lanes (order-independent identity of the run). */
  providers: string[];
  /** Active (non-suppressed) findings per severity. */
  findingCounts: Partial<Record<Severity, number>>;
  /** Active findings grouped by file (findings without a file are omitted). */
  byFile: Record<string, number>;
  /** Active findings grouped by normalized title. */
  byTitle: Record<string, number>;
  /** Per-provider run status, for failure-rate stats. */
  providerResults: Array<{ providerId: string; status: ProviderRunStatus }>;
}

function countBy<T>(items: T[], keyOf: (item: T) => string, cap?: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  if (cap === undefined) return out;
  // Keep only the top-N buckets so a single review with hundreds of findings
  // does not bloat the history line.
  return Object.fromEntries(
    Object.entries(out)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, cap)
  );
}

/**
 * Project a finished report into a history entry. Only ACTIVE (non-suppressed)
 * findings are counted — suppressed findings don't gate, so they shouldn't skew
 * noise/trend stats.
 */
export function toHistoryEntry(report: CouncilReport): HistoryEntry {
  const active = report.findings.filter((finding) => finding.status !== "suppressed");
  const located = active.filter((finding): finding is Finding & { file: string } => Boolean(finding.file));

  return {
    reviewId: report.metadata.reviewId,
    generatedAt: report.metadata.generatedAt,
    verdict: report.verdict,
    degraded: report.metadata.degraded,
    mode: report.metadata.mode,
    subject: report.metadata.subject,
    providers: report.metadata.providers,
    findingCounts: countBy(active, (finding) => finding.severity) as Partial<Record<Severity, number>>,
    byFile: countBy(located, (finding) => finding.file, TOP_N),
    byTitle: countBy(active, (finding) => finding.title, TOP_N),
    providerResults: report.providerResults.map((result) => ({
      providerId: result.providerId,
      status: result.status
    }))
  };
}

const allowedVerdicts = new Set<string>(verdicts);
const allowedSeverities = new Set<string>(severities);
const allowedProviderStatuses = new Set<string>(["ok", "error", "skipped", "interrupted"]);

function isCountMap(value: unknown, allowedKeys?: Set<string>): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [key, count] of Object.entries(value)) {
    if (allowedKeys && !allowedKeys.has(key)) return false;
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return false;
  }
  return true;
}

export function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as HistoryEntry;
  return (
    (entry.reviewId === undefined || typeof entry.reviewId === "string") &&
    typeof entry.generatedAt === "string" &&
    Number.isFinite(Date.parse(entry.generatedAt)) &&
    allowedVerdicts.has(entry.verdict) &&
    typeof entry.degraded === "boolean" &&
    typeof entry.mode === "string" &&
    typeof entry.subject === "string" &&
    Array.isArray(entry.providers) &&
    entry.providers.every((provider) => typeof provider === "string") &&
    isCountMap(entry.findingCounts, allowedSeverities) &&
    isCountMap(entry.byFile) &&
    isCountMap(entry.byTitle) &&
    Array.isArray(entry.providerResults) &&
    entry.providerResults.every(
      (result) =>
        result &&
        typeof result === "object" &&
        typeof result.providerId === "string" &&
        typeof result.status === "string" &&
        allowedProviderStatuses.has(result.status)
    )
  );
}

/** Keep the newest entry per stable review id; entries without review ids stay distinct. */
export function dedupeHistoryEntries(entries: HistoryEntry[]): HistoryEntry[] {
  const sorted = [...entries].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const seen = new Set<string>();
  const deduped: HistoryEntry[] = [];
  for (const entry of sorted) {
    if (entry.reviewId) {
      if (seen.has(entry.reviewId)) continue;
      seen.add(entry.reviewId);
    }
    deduped.push(entry);
  }
  return deduped;
}

export interface HistoryStats {
  runs: number;
  verdictCounts: Record<Verdict, number>;
  degradedRuns: number;
  severityCounts: Partial<Record<Severity, number>>;
  /** Files with the most findings across the window, descending. */
  topFiles: Array<{ file: string; count: number }>;
  /** Finding titles that recur most across the window, descending. */
  topTitles: Array<{ title: string; count: number }>;
  /** Per-provider run/failure counts (failures = status !== "ok"), descending by runs. */
  providerFailureRates: Array<{ providerId: string; runs: number; failures: number }>;
}

export interface ComputeStatsOptions {
  /** ISO date; entries generated strictly before this are excluded. */
  since?: string;
  /** Max rows retained in topFiles/topTitles. */
  limit?: number;
}

/** Aggregate history entries into trend stats. */
export function computeStats(entries: HistoryEntry[], options: ComputeStatsOptions = {}): HistoryStats {
  const sinceMs = options.since !== undefined ? Date.parse(options.since) : Number.NaN;
  const candidates = Number.isNaN(sinceMs)
    ? entries
    : entries.filter((entry) => Date.parse(entry.generatedAt) >= sinceMs);
  const windowed = dedupeHistoryEntries(candidates);

  const verdictCounts: Record<Verdict, number> = { pass: 0, warn: 0, fail: 0 };
  const severityCounts: Partial<Record<Severity, number>> = {};
  const files: Record<string, number> = {};
  const titles: Record<string, number> = {};
  const providers: Record<string, { runs: number; failures: number }> = {};
  let degradedRuns = 0;

  for (const entry of windowed) {
    verdictCounts[entry.verdict] += 1;
    if (entry.degraded) degradedRuns += 1;
    for (const [severity, count] of Object.entries(entry.findingCounts)) {
      severityCounts[severity as Severity] = (severityCounts[severity as Severity] ?? 0) + (count ?? 0);
    }
    for (const [file, count] of Object.entries(entry.byFile)) {
      files[file] = (files[file] ?? 0) + count;
    }
    for (const [title, count] of Object.entries(entry.byTitle)) {
      titles[title] = (titles[title] ?? 0) + count;
    }
    for (const result of entry.providerResults) {
      const bucket = providers[result.providerId] ?? { runs: 0, failures: 0 };
      bucket.runs += 1;
      if (result.status !== "ok") bucket.failures += 1;
      providers[result.providerId] = bucket;
    }
  }

  const rank = (record: Record<string, number>): Array<{ key: string; count: number }> => {
    const limit = Math.max(1, options.limit ?? 25);
    return Object.entries(record)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, limit);
  };

  return {
    runs: windowed.length,
    verdictCounts,
    degradedRuns,
    severityCounts,
    topFiles: rank(files).map((row) => ({ file: row.key, count: row.count })),
    topTitles: rank(titles).map((row) => ({ title: row.key, count: row.count })),
    providerFailureRates: Object.entries(providers)
      .map(([providerId, bucket]) => ({ providerId, runs: bucket.runs, failures: bucket.failures }))
      .sort((a, b) => b.runs - a.runs)
  };
}
