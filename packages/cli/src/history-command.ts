import { constants, createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

import {
  computeStats,
  dedupeHistoryEntries,
  isHistoryEntry,
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
 * `~/.quorate/history/<repoHash>.jsonl` (outside the repo, never in git).
 * Writes are best-effort; reads skip corrupt lines.
 */

const HISTORY_ROOT = join(homedir(), ".quorate", "history");
const HISTORY_DIR_MODE = 0o700;
const HISTORY_FILE_MODE = 0o600;
const READ_CHUNK_BYTES = 64 * 1024;
const MAX_TAIL_LINES_MULTIPLIER = 10;

export function historyPath(cwd: string): string {
  return join(HISTORY_ROOT, `${repoHash(cwd)}.jsonl`);
}

export const FEEDBACK_OUTCOMES = ["confirmed", "false-positive", "accepted-risk", "fixed"] as const;
export type FeedbackOutcome = (typeof FEEDBACK_OUTCOMES)[number];
export interface FindingFeedback {
  schema: 1;
  feedbackId: string;
  createdAt: string;
  reviewId: string;
  reportGeneratedAt: string;
  reportHash: string;
  fingerprint: string;
  outcome: FeedbackOutcome;
  reason: string;
}

/** Human labels are stored separately from history, policies, and suppressions. */
export function feedbackPath(cwd: string): string {
  return join(HISTORY_ROOT, `${repoHash(cwd)}.feedback.jsonl`);
}

export async function recordFindingFeedback(cwd: string, report: CouncilReport, options: {
  finding?: number;
  fingerprint?: string;
  outcome: string;
  reason: string;
}): Promise<FindingFeedback> {
  if (!FEEDBACK_OUTCOMES.includes(options.outcome as FeedbackOutcome)) throw new Error(`Outcome must be one of ${FEEDBACK_OUTCOMES.join(", ")}.`);
  const reason = options.reason.trim();
  if (!reason || reason.length > 5000) throw new Error("Feedback requires a reason of 1–5000 characters.");
  if ((options.finding === undefined) === (options.fingerprint === undefined)) throw new Error("Choose exactly one of --finding or --fingerprint; use feedback targets to list the saved findings.");
  if (!report.metadata?.reviewId || !Number.isFinite(Date.parse(report.metadata.generatedAt))) throw new Error("The report has no valid review identity. Run a new review first.");
  let fingerprint = options.fingerprint;
  if (options.finding !== undefined) {
    if (!Number.isSafeInteger(options.finding) || options.finding < 1 || options.finding > report.findings.length) throw new Error("Finding number is outside this report; use feedback targets.");
    fingerprint = report.findings[options.finding - 1].fingerprint;
  }
  if (!fingerprint || report.findings.filter((finding) => finding.fingerprint === fingerprint).length !== 1) throw new Error("The finding fingerprint is missing or ambiguous. Run a new review first.");
  const entry: FindingFeedback = {
    schema: 1, feedbackId: randomUUID(), createdAt: new Date().toISOString(),
    reviewId: report.metadata.reviewId, reportGeneratedAt: report.metadata.generatedAt,
    reportHash: createHash("sha256").update(JSON.stringify(report)).digest("hex"),
    fingerprint, outcome: options.outcome as FeedbackOutcome, reason
  };
  const path = feedbackPath(cwd);
  await mkdir(dirname(path), { recursive: true, mode: HISTORY_DIR_MODE });
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK, HISTORY_FILE_MODE);
  try {
    if (!(await handle.stat()).isFile()) throw new Error("Feedback destination must be a regular file.");
    await handle.chmod(HISTORY_FILE_MODE);
    await handle.appendFile(`${JSON.stringify(entry)}\n`, "utf8");
  } finally { await handle.close(); }
  return entry;
}

export async function readFindingFeedback(cwd: string): Promise<FindingFeedback[]> {
  let handle;
  try { handle = await open(feedbackPath(cwd), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error("Feedback store must be a regular file smaller than 8 MiB.");
    const lines = (await handle.readFile("utf8")).split(/\r?\n/).filter(Boolean);
    return lines.map((line, index) => {
      let row: Partial<FindingFeedback>;
      try { row = JSON.parse(line) as Partial<FindingFeedback>; }
      catch { throw new Error(`Invalid feedback record at line ${index + 1}.`); }
      if (!row || row.schema !== 1 || typeof row.feedbackId !== "string" || !row.feedbackId || typeof row.reviewId !== "string" || !row.reviewId ||
        typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)) ||
        typeof row.reportGeneratedAt !== "string" || !Number.isFinite(Date.parse(row.reportGeneratedAt)) ||
        typeof row.reportHash !== "string" || !/^[0-9a-f]{64}$/.test(row.reportHash) ||
        typeof row.fingerprint !== "string" || !row.fingerprint || !FEEDBACK_OUTCOMES.includes(row.outcome as FeedbackOutcome) ||
        typeof row.reason !== "string" || !row.reason.trim() || row.reason.length > 5000) throw new Error(`Invalid feedback record at line ${index + 1}.`);
      return row as FindingFeedback;
    }).reverse();
  } finally { await handle.close(); }
}

export async function appendHistoryNow(cwd: string, report: CouncilReport): Promise<void> {
  const entry = toHistoryEntry(report);
  const path = historyPath(cwd);
  await mkdir(dirname(path), { recursive: true, mode: HISTORY_DIR_MODE });
  const handle = await open(path, "a", HISTORY_FILE_MODE);
  try {
    await handle.appendFile(`${JSON.stringify(entry)}\n`, "utf8");
    await handle.chmod(HISTORY_FILE_MODE).catch(() => undefined);
  } finally {
    await handle.close();
  }
}

/** Append a report as one history line. Never throws (best-effort). */
export function appendHistory(cwd: string, report: CouncilReport): void {
  void appendHistoryNow(cwd, report).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`(history write skipped: ${reason})`);
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseHistoryLines(lines: string[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isHistoryEntry(parsed)) entries.push(parsed);
    } catch {
      // Skip corrupt / half-written lines rather than failing the read.
    }
  }
  return entries;
}

async function readAllHistory(path: string): Promise<HistoryEntry[]> {
  const input = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Infinity });
  const entries: HistoryEntry[] = [];
  for await (const line of rl) {
    entries.push(...parseHistoryLines([line]));
  }
  return dedupeHistoryEntries(entries);
}

async function readTailLines(path: string, limit: number): Promise<string[]> {
  const info = await stat(path);
  let position = info.size;
  let buffer = "";
  let lineBreaks = 0;
  const targetLines = Math.max(limit * MAX_TAIL_LINES_MULTIPLIER, limit);
  const handle = await open(path, "r");
  try {
    while (position > 0) {
      const size = Math.min(READ_CHUNK_BYTES, position);
      position -= size;
      const chunk = Buffer.allocUnsafe(size);
      const { bytesRead } = await handle.read(chunk, 0, size, position);
      const text = chunk.toString("utf8", 0, bytesRead);
      lineBreaks += (text.match(/\n/g) ?? []).length;
      buffer = `${text}${buffer}`;
      if (lineBreaks >= targetLines) break;
    }
  } finally {
    await handle.close();
  }
  return buffer.split(/\r?\n/).filter(Boolean).slice(-targetLines);
}

/**
 * Read history entries for this repo, newest-first. When `limit` is provided,
 * only a bounded tail of the JSONL file is read before parsing.
 */
export async function readHistory(cwd: string, options: { limit?: number } = {}): Promise<HistoryEntry[]> {
  const path = historyPath(cwd);
  if (!(await fileExists(path))) return [];
  const limit = options.limit;
  const entries =
    limit !== undefined
      ? parseHistoryLines(await readTailLines(path, limit))
      : await readAllHistory(path);
  const deduped = dedupeHistoryEntries(entries);
  return limit !== undefined ? deduped.slice(0, limit) : deduped;
}

const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function cleanCell(value: string, max = 180): string {
  const cleaned = value.replace(ANSI_RE, "").replace(CONTROL_RE, "").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

export function formatFindingFeedback(entries: FindingFeedback[]): string {
  return entries.length > 0 ? entries.map((row) => `${cleanCell(row.createdAt)} ${cleanCell(row.outcome)} ${cleanCell(row.fingerprint)}\n  ${cleanCell(row.reason, 500)}`).join("\n") : "No finding feedback recorded.";
}

const VERDICT_GLYPH: Record<Verdict, string> = { pass: "◆", warn: "▲", fail: "✖" };

/** Format history as a compact, newest-first table (text or JSON). */
export function formatHistoryTable(entries: HistoryEntry[], limit = 20): string {
  const shown = entries.slice(0, Math.max(0, limit));
  const rows = shown.map((entry) => {
    const total = Object.values(entry.findingCounts).reduce((sum, count) => sum + (count ?? 0), 0);
    const date = entry.generatedAt.replace("T", " ").slice(0, 19);
    return `${VERDICT_GLYPH[entry.verdict]} ${date}  ${entry.verdict.toUpperCase().padEnd(4)} ${String(total).padStart(3)} finding(s)  ${cleanCell(entry.subject)}`;
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
    for (const row of stats.topFiles.slice(0, 10)) lines.push(`  ${String(row.count).padStart(3)}  ${cleanCell(row.file)}`);
  }
  if (stats.topTitles.length > 0) {
    lines.push("Recurring findings:");
    for (const row of stats.topTitles.slice(0, 10)) lines.push(`  ${String(row.count).padStart(3)}  ${cleanCell(row.title)}`);
  }
  if (stats.providerFailureRates.length > 0) {
    lines.push("Provider reliability:");
    for (const row of stats.providerFailureRates) {
      const rate = row.runs > 0 ? Math.round((1 - row.failures / row.runs) * 100) : 100;
      lines.push(`  ${cleanCell(row.providerId)}: ${rate}% ok (${row.runs} runs)`);
    }
  }
  return lines.join("\n");
}

export { computeStats };
