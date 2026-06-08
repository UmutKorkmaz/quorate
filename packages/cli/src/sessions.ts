import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { CouncilMode, CouncilReport, Finding, Verdict } from "@quorate/core";
import type { SessionState } from "./session.js";

const SESSIONS_ROOT = join(homedir(), ".quorate", "sessions");
const TRANSCRIPT_TAIL_LIMIT = 20;

export interface LastReportSummary {
  verdict: Verdict;
  summary: string;
  findings: number;
  degraded: boolean;
}

export interface TranscriptEntry {
  input: string;
  at: string;
}

export interface PersistedSession {
  id: string;
  name: string;
  timestamp: string;
  diffLabel?: string;
  diffHash?: string;
  activeProviders?: string[];
  activeRoles?: string[];
  mode: CouncilMode;
  lastReportSummary?: LastReportSummary;
  transcriptTail: TranscriptEntry[];
}

/** Stable short hash for a repo working directory. */
export function repoHash(cwd: string): string {
  return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 16);
}

/** Content hash for a loaded diff — used to detect stale sessions on resume. */
export function hashDiff(diff: string): string {
  return createHash("sha256").update(diff).digest("hex").slice(0, 16);
}

export function sessionsDir(cwd: string): string {
  return join(SESSIONS_ROOT, repoHash(cwd));
}

export function sessionPath(cwd: string, id: string): string {
  return join(sessionsDir(cwd), `${id}.json`);
}

export function createSessionId(): string {
  return randomUUID();
}

export function summarizeReport(report: CouncilReport): LastReportSummary {
  return {
    verdict: report.verdict,
    summary: report.summary,
    findings: report.findings.length,
    degraded: report.metadata.degraded
  };
}

export function sessionFromState(state: SessionState, options?: { id?: string; name?: string }): PersistedSession {
  const id = options?.id ?? state.sessionId ?? createSessionId();
  const name =
    options?.name ??
    state.sessionName ??
    state.diffLabel ??
    `Session ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

  return {
    id,
    name,
    timestamp: new Date().toISOString(),
    diffLabel: state.diffLabel,
    diffHash: state.diff ? hashDiff(state.diff) : undefined,
    activeProviders: state.activeProviders,
    activeRoles: state.activeRoles,
    mode: state.mode,
    lastReportSummary: state.lastReport ? summarizeReport(state.lastReport) : undefined,
    transcriptTail: (state.transcript ?? []).slice(-TRANSCRIPT_TAIL_LIMIT)
  };
}

export function saveSession(cwd: string, session: PersistedSession): void {
  const dir = sessionsDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(sessionPath(cwd, session.id), `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

export function loadSession(cwd: string, id: string): PersistedSession | undefined {
  const path = sessionPath(cwd, id);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PersistedSession;
  } catch {
    return undefined;
  }
}

export function listSessions(cwd: string): PersistedSession[] {
  const dir = sessionsDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => loadSession(cwd, entry.slice(0, -5)))
    .filter((session): session is PersistedSession => session !== undefined)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export function latestSession(cwd: string): PersistedSession | undefined {
  return listSessions(cwd)[0];
}

/** Map a persisted snapshot onto live session state (diff body is not stored). */
export function applyPersistedSession(session: PersistedSession): Partial<SessionState> {
  return {
    sessionId: session.id,
    sessionName: session.name,
    mode: session.mode,
    diffLabel: session.diffLabel,
    activeProviders: session.activeProviders,
    activeRoles: session.activeRoles,
    transcript: session.transcriptTail
  };
}

export function formatSessionLine(session: PersistedSession): string {
  const verdict = session.lastReportSummary?.verdict?.toUpperCase() ?? "—";
  const label = session.diffLabel ?? "no diff";
  return `${session.id.slice(0, 8)}  ${session.name}  ${label}  ${verdict}  ${session.timestamp}`;
}

export function sessionRecapLine(session: PersistedSession): string | undefined {
  const summary = session.lastReportSummary;
  if (!summary) return undefined;
  const degraded = summary.degraded ? " (degraded)" : "";
  return `Last verdict: ${summary.verdict.toUpperCase()}${degraded} — ${summary.summary}`;
}

function findingKey(finding: Finding): string {
  return [finding.severity, finding.file ?? "", finding.line ?? "", finding.title].join("|");
}

/** Load a council report JSON file from disk. */
export function loadCouncilReport(path: string): CouncilReport | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CouncilReport;
  } catch {
    return undefined;
  }
}

/** Human-readable diff between two saved session summaries. */
export function compareSessionSummaries(
  left: { label: string; summary?: LastReportSummary },
  right: { label: string; summary?: LastReportSummary }
): string {
  const lines = ["Compare sessions", `  A: ${left.label}`, `  B: ${right.label}`, ""];

  if (!left.summary && !right.summary) {
    lines.push("Neither session has a saved report summary.");
    return lines.join("\n");
  }
  if (!left.summary) {
    lines.push("A has no saved report summary.");
    return lines.join("\n");
  }
  if (!right.summary) {
    lines.push("B has no saved report summary.");
    return lines.join("\n");
  }

  lines.push(
    `Verdict:  ${left.summary.verdict.toUpperCase()} → ${right.summary.verdict.toUpperCase()}`,
    `Findings: ${left.summary.findings} → ${right.summary.findings}`,
    `Degraded: ${left.summary.degraded ? "yes" : "no"} → ${right.summary.degraded ? "yes" : "no"}`,
    "",
    "Summary A:",
    `  ${left.summary.summary}`,
    "Summary B:",
    `  ${right.summary.summary}`
  );
  return lines.join("\n");
}

/** Human-readable diff between two full council reports. */
export function compareCouncilReports(
  left: CouncilReport,
  right: CouncilReport,
  labels: { left: string; right: string }
): string {
  const leftKeys = new Set(left.findings.map(findingKey));
  const rightKeys = new Set(right.findings.map(findingKey));

  const onlyLeft = left.findings.filter((finding) => !rightKeys.has(findingKey(finding)));
  const onlyRight = right.findings.filter((finding) => !leftKeys.has(findingKey(finding)));
  const shared = left.findings.filter((finding) => rightKeys.has(findingKey(finding)));

  const lines = [
    "Compare reports",
    `  A: ${labels.left}`,
    `  B: ${labels.right}`,
    "",
    `Verdict:  ${left.verdict.toUpperCase()} → ${right.verdict.toUpperCase()}`,
    `Findings: ${left.findings.length} → ${right.findings.length} (${shared.length} shared)`,
    `Degraded: ${left.metadata.degraded ? "yes" : "no"} → ${right.metadata.degraded ? "yes" : "no"}`,
    "",
    `Only in A (${onlyLeft.length}):`,
    ...(onlyLeft.length > 0
      ? onlyLeft.map((finding) => `  [${finding.severity}] ${finding.title}`)
      : ["  (none)"]),
    "",
    `Only in B (${onlyRight.length}):`,
    ...(onlyRight.length > 0
      ? onlyRight.map((finding) => `  [${finding.severity}] ${finding.title}`)
      : ["  (none)"])
  ];
  return lines.join("\n");
}