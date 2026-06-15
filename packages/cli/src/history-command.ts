import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  computeStats,
  toHistoryEntry,
  type CouncilReport,
  type HistoryEntry,
  type HistoryStats,
  type Severity,
  type Verdict
} from "@quorate/core";
import { repoHash } from "./sessions.js";

/**
 * Append-only review history, one JSONL file per repo at
 * `~/.quorate/history/<repoHash>.jsonl` (outside the repo — never in git, never
 * in the working tree). One line per review, keyed by the K0 `reviewId`.
 *
 * The per-repo hash is shared with `sessions.ts` (canonicalized via `resolve`),
 * so a repo reached via a symlink or a non-canonical path always resolves to the
 * same history file.
 *
 * Writes are fire-and-forget and best-effort: a history failure must never break
 * a review. Reads skip corrupt lines so a half-written line never bricks `stats`.
 */

const HISTORY_ROOT = join(homedir(), ".quorate", "history");

export function historyPath(cwd: string): string {
  return join(HISTORY_ROOT, `${repoHash(cwd)}.jsonl`);
}

/** Append a report as one history line. Never throws (best-effort). */
export function appendHistory(cwd: string, report: CouncilReport): void {
  try {
    const entry = toHistoryEntry(report);
    const path = historyPath(cwd);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error: unknown) {
    // History is advisory; a write failure must not affect the review. Surface
    // one dim line so a permanent failure (read-only HOME, full disk) isn't
    // silently losing every record.
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`(history write skipped: ${reason})`);
  }
}

/**
 * Read all history entries for this repo, newest-first. Lines that fail to parse
 * or lack a verdict are skipped (a corrupt line never bricks the whole file).
 */
export function readHistory(cwd: string): HistoryEntry[] {
  const path = historyPath(cwd);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as HistoryEntry;
      if (isHistoryEntry(parsed)) entries.push(parsed);
    } catch {
      // Skip a corrupt/half-written line rather than failing the read.
    }
  }
  // newest-first so `--limit` shows recent runs.
  return entries.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as HistoryEntry).generatedAt === "string" &&
    typeof (value as HistoryEntry).verdict === "string"
  );
}

const VERDICT_GLYPH: Record<Verdict, string> = { pass: "◆", warn: "▲", fail: "✖" };

/** Format history as a compact, newest-first table (text or JSON). */
export function formatHistoryTable(entries: HistoryEntry[], limit = 20): string {
  const shown = entries.slice(0, Math.max(1, limit));
  const rows = shown.map((entry) => {
    const total = Object.values(entry.findingCounts).reduce((sum, count) => sum + (count ?? 0), 0);
    const date = entry.generatedAt.replace("T", " ").slice(0, 19);
    return `${VERDICT_GLYPH[entry.verdict]} ${date}  ${entry.verdict.toUpperCase().padEnd(4)} ${String(total).padStart(3)} finding(s)  ${entry.subject}`;
  });
  return rows.length > 0 ? rows.join("\n") : "No reviews recorded yet.";
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

/** Format aggregated stats as a readable report. */
export function formatStatsReport(stats: HistoryStats): string {
  const lines: string[] = [];
  lines.push(`${stats.runs} review${stats.runs === 1 ? "" : "s"} on record${stats.degradedRuns ? ` (${stats.degradedRuns} degraded)` : ""}.`);
  lines.push(`Verdicts: ${stats.verdictCounts.pass} pass · ${stats.verdictCounts.warn} warn · ${stats.verdictCounts.fail} fail`);

  const sev = SEVERITY_ORDER.filter((s) => stats.severityCounts[s]).map((s) => `${stats.severityCounts[s]} ${s}`);
  if (sev.length > 0) lines.push(`Findings by severity: ${sev.join(", ")}`);

  if (stats.topFiles.length > 0) {
    lines.push("Noisiest files:");
    for (const row of stats.topFiles.slice(0, 10)) lines.push(`  ${String(row.count).padStart(3)}  ${row.file}`);
  }
  if (stats.topTitles.length > 0) {
    lines.push("Recurring findings:");
    for (const row of stats.topTitles.slice(0, 10)) lines.push(`  ${String(row.count).padStart(3)}  ${row.title}`);
  }
  if (stats.providerFailureRates.length > 0) {
    lines.push("Provider reliability:");
    for (const row of stats.providerFailureRates) {
      const rate = row.runs > 0 ? Math.round((1 - row.failures / row.runs) * 100) : 100;
      lines.push(`  ${row.providerId}: ${rate}% ok (${row.runs} runs)`);
    }
  }
  return lines.join("\n");
}

export { computeStats };
