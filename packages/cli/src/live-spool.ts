import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { CouncilEvent, CouncilReport } from "@quorate/core";
import { councilEventToNdjsonLine, isCouncilReportLine, type JsonStreamSink } from "./json-stream.js";

/**
 * Live run spool — the shared data plane for `quorate monitor` surfaces.
 *
 * Every council run appends its NDJSON `CouncilEvent`s to
 * `~/.quorate/live/<councilRunId>.ndjson` and maintains a registry entry in
 * `~/.quorate/live/<councilRunId>.meta.json`. Monitor UIs (TUI, web) tail
 * these files to render running agents (providers) and their subagents
 * (provider×role lanes) across terminals, without a daemon.
 *
 * Registry layout: one meta file per run, never a shared index. Each process
 * only writes its own meta file (atomic temp+rename), so concurrent runs in
 * separate processes cannot lose each other's entries — there is no shared
 * read-modify-write to race on. `listLiveRuns` is a directory scan.
 *
 * Design constraints, mirroring the council's own onEvent contract
 * (a misbehaving subscriber must never break a run — see runCouncil):
 * - every filesystem write is wrapped; failures degrade silently and are
 *   surfaced only via {@link LiveSpool.lastError} for diagnostics/tests.
 * - appends are single whole-line writes so readers never see interleaved
 *   fragments from one writer; readers additionally tolerate a trailing
 *   partial line from a writer killed mid-append (runs are group-killed).
 */

export type LiveRunStatus = "running" | "done" | "error" | "stale";

export interface LiveRunEntry {
  runId: string;
  pid: number;
  cwd: string;
  repo: string;
  mode: string;
  subject: string;
  startedAt: string;
  /** Planned lane keys, `providerId:role`. */
  planned: string[];
  status: LiveRunStatus;
  updatedAt: string;
  /** argv (after execPath) of the owning process — enables monitor rerun.
   *  Omitted entirely when any element looks secret-bearing. */
  argv?: string[];
  /** Set when this run is a nested subagent council of a parent run's lane. */
  parentRunId?: string;
  parentLane?: string;
  /** Origin of this run. Absent = native Quorate council; `"claude"` = a
   *  foreign Claude Code session ingested via the hook-report bridge. */
  source?: string;
  /** `external` marks a foreign-CLI run (no rerun, no direct control). */
  kind?: "external";
}

/** Flags whose values (or inline `=values`) may carry secrets — if any argv
 *  element matches, the whole argv is withheld from the on-disk meta. */
const SECRET_ARGV_PATTERN = /(key|token|secret|password|credential|bearer)/i;

export function sanitizeArgvForMeta(argv: string[]): string[] | undefined {
  return argv.some((part) => SECRET_ARGV_PATTERN.test(part)) ? undefined : argv;
}

/** Keep the registry bounded; oldest settled runs (and their spool files) are pruned. */
const MAX_INDEX_RUNS = 100;

/** councilRunId is a randomUUID today; enforce a safe charset before any path use. */
const SAFE_RUN_ID = /^[A-Za-z0-9._-]+$/;

export function defaultLiveDir(): string {
  return join(homedir(), ".quorate", "live");
}

export function liveRunFilePath(runId: string, dir: string = defaultLiveDir()): string {
  assertSafeRunId(runId);
  return join(dir, `${runId}.ndjson`);
}

export function liveRunMetaPath(runId: string, dir: string = defaultLiveDir()): string {
  assertSafeRunId(runId);
  return join(dir, `${runId}.meta.json`);
}

function assertSafeRunId(runId: string): void {
  if (!SAFE_RUN_ID.test(runId) || runId.includes("..")) {
    throw new Error(`Unsafe live run id: ${JSON.stringify(runId)}`);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Best-effort liveness: `kill(pid, 0)`. EPERM means the process exists but
 * belongs to another user. A recycled pid can read as alive — acceptable for
 * a monitor (the run shows as running until the next reap), not for control.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Spool contents (subjects, cwds, argv) are the user's own business —
 *  owner-only permissions on multi-user machines. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** Atomic single-file write: temp + rename, cleaning the temp on failure. */
function writeFileAtomic(path: string, content: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, content, { encoding: "utf8", mode: FILE_MODE });
    renameSync(temp, path);
  } catch (error: unknown) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function writeMeta(dir: string, entry: LiveRunEntry): void {
  writeFileAtomic(liveRunMetaPath(entry.runId, dir), `${JSON.stringify(entry, null, 2)}\n`);
}

/**
 * Atomic registry write for a foreign-agent run (Claude Code via the hook
 * bridge). Public so {@link hook-report} can manage external runs without the
 * native council sink. Enforces the same owner-only mode and charset gate.
 */
export function writeRunMeta(entry: LiveRunEntry, dir: string = defaultLiveDir()): void {
  assertSafeRunId(entry.runId);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  writeFileAtomic(liveRunMetaPath(entry.runId, dir), `${JSON.stringify(entry, null, 2)}\n`);
}

/**
 * Append one pre-serialized NDJSON line to a run's spool file (owner-only,
 * opened O_APPEND so concurrent writers don't interleave). Used by
 * {@link hook-report} for foreign runs whose events are not native CouncilEvents.
 */
export function appendRunEventLine(runId: string, line: string, dir: string = defaultLiveDir()): void {
  assertSafeRunId(runId);
  const path = liveRunFilePath(runId, dir);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const fd = openSync(path, "a", FILE_MODE);
  try {
    writeSync(fd, `${line}\n`);
  } finally {
    closeSync(fd);
  }
}

/** Read a run's registry entry; `undefined` if absent or corrupt. */
export function readRunMeta(runId: string, dir: string = defaultLiveDir()): LiveRunEntry | undefined {
  assertSafeRunId(runId);
  return readMeta(liveRunMetaPath(runId, dir));
}

function readMeta(path: string): LiveRunEntry | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LiveRunEntry>;
    if (
      typeof parsed?.runId === "string" &&
      SAFE_RUN_ID.test(parsed.runId) &&
      typeof parsed.pid === "number" &&
      typeof parsed.startedAt === "string" &&
      typeof parsed.status === "string"
    ) {
      return parsed as LiveRunEntry;
    }
  } catch {
    // Corrupt or half-written meta — skip it; the spool file stays on disk.
  }
  return undefined;
}

/**
 * Bound the registry: keep the newest {@link MAX_INDEX_RUNS} entries plus any
 * run whose owner pid is still alive. Deletion is per-run and best-effort, so
 * two processes pruning concurrently just repeat idempotent `rm -f`s.
 */
function pruneLiveDir(dir: string): void {
  // Reap temp files orphaned by killed writers (atomic writes that never
  // renamed). Age-gated so we never race a live writer's in-flight temp.
  try {
    const cutoff = Date.now() - 60_000;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".tmp")) continue;
      const path = join(dir, name);
      try {
        if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
      } catch {
        // Already gone or unreadable — either way, nothing to do.
      }
    }
  } catch {
    // Best-effort hygiene only.
  }
  const entries = scanMetas(dir);
  if (entries.length <= MAX_INDEX_RUNS) return;
  const byAge = [...entries].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const entry of byAge.slice(MAX_INDEX_RUNS)) {
    if (entry.status === "running" && isPidAlive(entry.pid)) continue;
    rmSync(liveRunMetaPath(entry.runId, dir), { force: true });
    rmSync(liveRunFilePath(entry.runId, dir), { force: true });
  }
}

function scanMetas(dir: string): LiveRunEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const entries: LiveRunEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".meta.json")) continue;
    const entry = readMeta(join(dir, name));
    if (entry) entries.push(entry);
  }
  return entries;
}

export interface LiveSpoolOptions {
  /** Spool directory; defaults to `~/.quorate/live`. */
  dir?: string;
  /** Working directory recorded for the run; defaults to `process.cwd()`. */
  cwd?: string;
  /** Owner pid recorded for liveness reaping; defaults to `process.pid`. */
  pid?: number;
  /**
   * Whether `provider/chunk` events are written (live per-lane tails).
   * Defaults to the same `QUORATE_JSON_CHUNKS` gate used by `--json` streaming.
   */
  includeChunks?: boolean;
}

export interface LiveSpool extends JsonStreamSink {
  /** Direct event tee for in-process runs (the TUI path). */
  handleEvent(event: CouncilEvent): void;
  /** Seal the registry entry when the run settles outside the event stream. */
  finish(status: Extract<LiveRunStatus, "done" | "error">): void;
  /** Last swallowed filesystem error, for diagnostics/tests. */
  readonly lastError: Error | undefined;
}

export function liveChunksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ["1", "true", "yes"].includes((env.QUORATE_JSON_CHUNKS ?? "").toLowerCase());
}

/** Spooling is on by default; QUORATE_LIVE=0 opts a machine or CI job out entirely. */
export function liveSpoolEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !["0", "false", "no", "off"].includes((env.QUORATE_LIVE ?? "").toLowerCase());
}

/** Registry metadata keeps only a short subject preview, not full prompt text. */
const MAX_SUBJECT_CHARS = 200;

/**
 * Create a spool sink for one council run. It learns the runId, mode, subject,
 * and planned lanes from the `council/started` event, so callers only provide
 * ambient context. Usable both as a {@link JsonStreamSink} (pre-serialized
 * NDJSON lines) and as a direct event subscriber via {@link LiveSpool.handleEvent}.
 */
export function createLiveSpoolSink(options: LiveSpoolOptions = {}): LiveSpool {
  if (!liveSpoolEnabled()) {
    return {
      lastError: undefined,
      handleEvent() {},
      writeStdout() {},
      writeStderr() {},
      finish() {}
    };
  }
  const dir = options.dir ?? defaultLiveDir();
  const cwd = options.cwd ?? process.cwd();
  const pid = options.pid ?? process.pid;
  const includeChunks = options.includeChunks ?? liveChunksEnabled();

  let entry: LiveRunEntry | undefined;
  let lastError: Error | undefined;
  let fd: number | undefined;
  let broken = false;

  const guard = (operation: () => void): void => {
    try {
      operation();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  };

  const closeFd = (): void => {
    if (fd === undefined) return;
    const current = fd;
    fd = undefined;
    guard(() => closeSync(current));
  };

  const appendLine = (line: string): void => {
    // One persistent fd per run (chunk streams are hot paths), and a broken
    // spool short-circuits instead of re-throwing on every subsequent event.
    if (!entry || broken || fd === undefined) return;
    const current = fd;
    try {
      writeSync(current, `${line}\n`);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      broken = true;
      closeFd();
    }
  };

  const setStatus = (status: LiveRunStatus): void => {
    if (!entry || entry.status === status) return;
    entry = { ...entry, status, updatedAt: nowIso() };
    const current = entry;
    guard(() => writeMeta(dir, current));
  };

  const start = (event: Extract<CouncilEvent, { type: "council/started" }>): void => {
    if (!SAFE_RUN_ID.test(event.councilRunId)) {
      lastError = new Error(`Unsafe live run id: ${JSON.stringify(event.councilRunId)}`);
      return;
    }
    entry = {
      runId: event.councilRunId,
      pid,
      cwd,
      repo: basename(cwd),
      mode: event.mode,
      subject: event.subject.length > MAX_SUBJECT_CHARS ? `${event.subject.slice(0, MAX_SUBJECT_CHARS)}…` : event.subject,
      startedAt: event.at,
      planned: event.planned.map((lane) => `${lane.providerId}:${lane.role}`),
      status: "running",
      updatedAt: nowIso(),
      argv: sanitizeArgvForMeta(process.argv.slice(1)),
      ...(event.parentRunId &&
      SAFE_RUN_ID.test(event.parentRunId) &&
      typeof event.parentLane === "string" &&
      event.parentLane.length > 0 &&
      event.parentLane.length <= 200
        ? { parentRunId: event.parentRunId, parentLane: event.parentLane }
        : {})
    };
    const current = entry;
    guard(() => {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE });
      const path = liveRunFilePath(current.runId, dir);
      writeFileSync(path, "", { encoding: "utf8", mode: FILE_MODE }); // truncate any stale file
      fd = openSync(path, "a", FILE_MODE); // O_APPEND: every write lands at EOF atomically
      writeMeta(dir, current);
      pruneLiveDir(dir);
    });
    if (fd === undefined) broken = true;
  };

  const consumeEvent = (event: CouncilEvent, line: string | null): void => {
    if (event.type === "council/started") start(event);
    if (line) appendLine(line);
    if (event.type === "verdict") setStatus("done");
  };

  return {
    get lastError() {
      return lastError;
    },
    handleEvent(event: CouncilEvent) {
      consumeEvent(event, councilEventToNdjsonLine(event, includeChunks));
    },
    writeStdout(line: string) {
      // The final report line is not a CouncilEvent; append it verbatim so a
      // spool file is self-contained, and treat it as the run settling.
      if (isCouncilReportLine(line)) {
        appendLine(line);
        setStatus("done");
        return;
      }
      let event: CouncilEvent | undefined;
      try {
        event = JSON.parse(line) as CouncilEvent;
      } catch {
        return; // Not an event line — ignore rather than corrupt the spool.
      }
      if (typeof event?.type !== "string") return;
      // Lines from runCouncilWithJsonStream are already chunk-gated upstream.
      consumeEvent(event, line);
    },
    writeStderr() {
      // Human progress text — never spooled.
    },
    finish(status: Extract<LiveRunStatus, "done" | "error">) {
      // Only seal a live run; done/error are terminal (a verdict already
      // settled it). The fd closes here in every case — the verdict event
      // precedes the final report line, so closing on setStatus would drop it.
      if (entry?.status === "running") setStatus(status);
      closeFd();
    }
  };
}

/** Fan one JSON stream out to several sinks (e.g. stdout + live spool). */
export function teeJsonStreamSink(...sinks: JsonStreamSink[]): JsonStreamSink {
  return {
    writeStdout(line: string) {
      for (const sink of sinks) sink.writeStdout(line);
    },
    writeStderr(line: string) {
      for (const sink of sinks) sink.writeStderr(line);
    }
  };
}

export interface ListLiveRunsOptions {
  dir?: string;
  /** Mark `running` entries with dead owner pids as `stale` (default true). */
  reap?: boolean;
}

/** Registry snapshot, newest first, with dead runs reaped to `stale`. */
export function listLiveRuns(options: ListLiveRunsOptions = {}): LiveRunEntry[] {
  const dir = options.dir ?? defaultLiveDir();
  const reap = options.reap ?? true;
  const runs = scanMetas(dir).map((run) => {
    if (reap && run.status === "running" && !isPidAlive(run.pid)) {
      const stale: LiveRunEntry = { ...run, status: "stale", updatedAt: nowIso() };
      try {
        // Owner is dead, so this last-write-wins persist cannot race a writer.
        writeMeta(dir, stale);
      } catch {
        // Persisting the reap is best-effort; the returned snapshot is authoritative.
      }
      return stale;
    }
    return run;
  });
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.runId.localeCompare(b.runId));
}

export interface ReadRunEventsOptions {
  dir?: string;
  /** Byte offset of the first unread line (from a previous read). */
  fromOffset?: number;
}

export interface LiveRunEvents {
  events: CouncilEvent[];
  /** The final report line, when the run has settled. */
  report?: CouncilReport;
  /** Byte offset after the last complete line — pass back as `fromOffset` to tail. */
  offset: number;
  /** True when the file shrank under the caller's offset: `events` is a full
   *  replay from the start, so accumulated state must be rebuilt, not appended. */
  reset?: boolean;
}

/**
 * Incremental, partial-line-tolerant reader for one run's spool file.
 * A trailing line without `\n` (writer killed mid-append) is left unconsumed
 * so the next read retries it; malformed complete lines are skipped. A file
 * shorter than the caller's offset (truncated/recreated) resets the tail.
 */
/**
 * CouncilEvent `type` discriminants the spool reader accepts. Lines carrying
 * any other `type` (e.g. the hook-report bridge's `approval/pending` /
 * `approval/resolved` annotations) are dropped silently here so the lane
 * reducer never sees them. This is the guard the build plan calls out: foreign
 * runs enrich the same per-run NDJSON file, but only council/provider events
 * drive lane state.
 */
const KNOWN_EVENT_TYPES = new Set([
  "council/started",
  "provider/started",
  "provider/chunk",
  "provider/done",
  "council/done",
  "verdict"
]);

export function readRunEvents(runId: string, options: ReadRunEventsOptions = {}): LiveRunEvents {
  const dir = options.dir ?? defaultLiveDir();
  const requested = options.fromOffset ?? 0;
  // One fd for stat+read so size and content can't diverge (no TOCTOU), and
  // only the unread suffix is read — polling stays O(new bytes), not O(file).
  let slice: Buffer;
  let from = requested;
  try {
    const fd = openSync(liveRunFilePath(runId, dir), "r");
    try {
      const size = fstatSync(fd).size;
      // An offset beyond the file means it was truncated/recreated — restart at 0.
      if (requested > size) from = 0;
      const length = size - from;
      slice = Buffer.alloc(length);
      let filled = 0;
      while (filled < length) {
        const got = readSync(fd, slice, filled, length - filled, from + filled);
        if (got === 0) break;
        filled += got;
      }
      slice = slice.subarray(0, filled);
    } finally {
      closeSync(fd);
    }
  } catch {
    return { events: [], offset: requested };
  }
  const reset = from === 0 && requested > 0;
  const lastNewline = slice.lastIndexOf(0x0a);
  if (lastNewline === -1) return { events: [], offset: from, reset };
  const complete = slice.subarray(0, lastNewline).toString("utf8");
  const events: CouncilEvent[] = [];
  let report: CouncilReport | undefined;
  for (const line of complete.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // Skip malformed complete lines rather than failing the tail.
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.type === "string" && KNOWN_EVENT_TYPES.has(record.type)) {
      events.push(parsed as CouncilEvent);
    } else if (typeof record.verdict === "string" && Array.isArray(record.findings)) {
      report = parsed as CouncilReport;
    }
  }
  return { events, report, offset: from + lastNewline + 1, reset };
}

/* -------------------------------------------------------------------------- */
/* Foreign-agent approvals + monitor discovery (the monitor, v1.4.0)       */
/* -------------------------------------------------------------------------- */

/**
 * Approvals bridge for foreign agents (Claude Code today). A `PermissionRequest`
 * hook in the foreign CLI writes a pending request here, the monitor writes a
 * decision, and the hook polls for it. Same charset/atomic-write/mode rules as
 * the run registry: owner-only, single whole-line writes, no shared index.
 *
 * Layout: `~/.quorate/live/approvals/<id>.json` (request) and
 * `<id>.decision.json` (decision). Pending requests are garbage-collected by
 * {@link reapExpiredApprovals} once past their `expiresAt`.
 */

export interface ApprovalRequest {
  id: string;
  runId: string;
  source: string;
  toolName: string;
  summary: string;
  cwd: string;
  createdAt: string;
  expiresAt: string;
}

export type ApprovalDecision = "allow" | "deny";

export interface ApprovalDecisionRecord {
  id: string;
  decision: ApprovalDecision;
  reason?: string;
  decidedAt: string;
}

export interface MonitorDiscovery {
  url: string;
  token: string;
  pid: number;
  heartbeatAt: string;
}

const APPROVAL_SUMMARY_MAX = 300;
/** Default monitor heartbeat freshness window for `isMonitorAttached`. */
const DEFAULT_MONITOR_MAX_AGE_MS = 6_000;

function approvalsDir(dir: string = defaultLiveDir()): string {
  return join(dir, "approvals");
}

function approvalRequestPath(id: string, dir: string = defaultLiveDir()): string {
  assertApprovalId(id);
  return join(approvalsDir(dir), `${id}.json`);
}

function approvalDecisionPath(id: string, dir: string = defaultLiveDir()): string {
  assertApprovalId(id);
  return join(approvalsDir(dir), `${id}.decision.json`);
}

export function monitorDiscoveryPath(dir: string = defaultLiveDir()): string {
  return join(dir, "monitor.json");
}

function assertApprovalId(id: string): void {
  if (!SAFE_RUN_ID.test(id) || id.includes("..")) {
    throw new Error(`Unsafe approval id: ${JSON.stringify(id)}`);
  }
}

function truncateSummary(summary: string): string {
  const trimmed = summary.trim();
  return trimmed.length <= APPROVAL_SUMMARY_MAX ? trimmed : `${trimmed.slice(0, APPROVAL_SUMMARY_MAX)}…`;
}

function ensureApprovalsDir(dir: string): void {
  mkdirSync(approvalsDir(dir), { recursive: true, mode: DIR_MODE });
}

/** Write a pending approval request atomically (owner-only). */
export function writeApprovalRequest(request: ApprovalRequest, dir: string = defaultLiveDir()): void {
  assertApprovalId(request.id);
  ensureApprovalsDir(dir);
  const record: ApprovalRequest = { ...request, summary: truncateSummary(request.summary) };
  writeFileAtomic(approvalRequestPath(request.id, dir), `${JSON.stringify(record, null, 2)}\n`);
}

/** Write the monitor's decision for a request, removing the pending request file. */
export function writeApprovalDecision(
  decision: ApprovalDecisionRecord,
  dir: string = defaultLiveDir()
): void {
  assertApprovalId(decision.id);
  ensureApprovalsDir(dir);
  writeFileAtomic(approvalDecisionPath(decision.id, dir), `${JSON.stringify(decision, null, 2)}\n`);
}

/** Read a decision if one has been written; `undefined` while still pending. */
export function readApprovalDecision(id: string, dir: string = defaultLiveDir()): ApprovalDecisionRecord | undefined {
  assertApprovalId(id);
  try {
    const parsed = JSON.parse(readFileSync(approvalDecisionPath(id, dir), "utf8")) as Partial<ApprovalDecisionRecord>;
    if (
      typeof parsed?.id === "string" &&
      (parsed.decision === "allow" || parsed.decision === "deny") &&
      typeof parsed.decidedAt === "string"
    ) {
      return parsed as ApprovalDecisionRecord;
    }
  } catch {
    // No decision yet, or unreadable — still pending.
  }
  return undefined;
}

/** Remove a resolved/deferred request and its decision (idempotent). */
export function deleteApproval(id: string, dir: string = defaultLiveDir()): void {
  assertApprovalId(id);
  rmSync(approvalRequestPath(id, dir), { force: true });
  rmSync(approvalDecisionPath(id, dir), { force: true });
}

/** Pending requests, oldest first. A request that already has a decision
 *  file is excluded (the hook deletes both on resolve, but a killed hook can
 *  orphan a decision file — don't show those as still-pending). */
export function listPendingApprovals(dir: string = defaultLiveDir()): ApprovalRequest[] {
  let names: string[];
  try {
    names = readdirSync(approvalsDir(dir));
  } catch {
    return [];
  }
  const pending: ApprovalRequest[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.endsWith(".decision.json")) continue;
    const id = name.slice(0, -".json".length);
    // Skip if a decision already exists (resolved but not cleaned up). Use a
    // stat check, not a full read — cheaper under the per-tick poll pattern.
    if (existsSync(join(approvalsDir(dir), `${id}.decision.json`))) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(approvalsDir(dir), name), "utf8")) as Partial<ApprovalRequest>;
      if (
        typeof parsed?.id === "string" &&
        typeof parsed.runId === "string" &&
        typeof parsed.source === "string" &&
        typeof parsed.toolName === "string" &&
        typeof parsed.summary === "string" &&
        typeof parsed.createdAt === "string" &&
        typeof parsed.expiresAt === "string"
      ) {
        pending.push(parsed as ApprovalRequest);
      }
    } catch {
      // Half-written or corrupt — skip; the writer will retry/replace.
    }
  }
  return pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Delete expired PENDING requests (no decision yet). Returns the ids reaped.
 * A monitor with a slow human lets requests expire so the blocked hook defers
 * (exit 0) instead of hanging. Decided-but-undeleted orphans are excluded from
 * {@link listPendingApprovals} separately (by decision-file presence), and
 * their request files are left as audit context for the next resolve cycle.
 */
export function reapExpiredApprovals(now: Date = new Date(), dir: string = defaultLiveDir()): string[] {
  const nowMs = now.getTime();
  const reaped: string[] = [];
  for (const request of listPendingApprovals(dir)) {
    const expiry = Date.parse(request.expiresAt);
    if (Number.isFinite(expiry) && expiry < nowMs) {
      deleteApproval(request.id, dir);
      reaped.push(request.id);
    }
  }
  return reaped;
}

/**
 * Reap expired pending requests AND return the surviving pending list in one
 * readdir pass — the monitor poll hot path. Equivalent to
 * `reapExpiredApprovals()` followed by `listPendingApprovals()` but without
 * the second directory scan.
 */
export function reapAndListPendingApprovals(now: Date = new Date(), dir: string = defaultLiveDir()): { reaped: string[]; survivors: ApprovalRequest[] } {
  const nowMs = now.getTime();
  const reaped: string[] = [];
  const survivors: ApprovalRequest[] = [];
  for (const request of listPendingApprovals(dir)) {
    const expiry = Date.parse(request.expiresAt);
    if (Number.isFinite(expiry) && expiry < nowMs) {
      deleteApproval(request.id, dir);
      reaped.push(request.id);
    } else {
      survivors.push(request);
    }
  }
  return { reaped, survivors };
}

/** Atomically write the monitor discovery file (loopback URL + heartbeat). */
export function writeMonitorDiscovery(discovery: MonitorDiscovery, dir: string = defaultLiveDir()): void {
  writeFileAtomic(monitorDiscoveryPath(dir), `${JSON.stringify(discovery, null, 2)}\n`);
}

/** Read the discovery file if present and well-formed. */
export function readMonitorDiscovery(dir: string = defaultLiveDir()): MonitorDiscovery | undefined {
  try {
    const parsed = JSON.parse(readFileSync(monitorDiscoveryPath(dir), "utf8")) as Partial<MonitorDiscovery>;
    if (
      typeof parsed?.url === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.pid === "number" &&
      typeof parsed.heartbeatAt === "string"
    ) {
      return parsed as MonitorDiscovery;
    }
  } catch {
    // Absent or corrupt — no monitor attached.
  }
  return undefined;
}

/** Remove the discovery file (idempotent) — called by the monitor on close. */
export function removeMonitorDiscovery(dir: string = defaultLiveDir()): void {
  rmSync(monitorDiscoveryPath(dir), { force: true });
}

/**
 * Is a monitor currently attached to this spool? True iff a discovery file
 * exists, its owner pid is alive, and its heartbeat is fresh. Foreign-agent
 * `PermissionRequest` hooks use this to decide whether to defer (exit 0, zero
 * overhead) or block waiting for a human's approve/deny.
 */
export function isMonitorAttached(
  options: { dir?: string; maxAgeMs?: number; now?: Date; pidAlive?: (pid: number) => boolean } = {}
): boolean {
  const discovery = readMonitorDiscovery(options.dir);
  if (!discovery) return false;
  const pidAlive = options.pidAlive ?? ((pid: number) => isPidAlive(pid));
  if (!pidAlive(discovery.pid)) return false;
  const heartbeat = Date.parse(discovery.heartbeatAt);
  if (!Number.isFinite(heartbeat)) return false;
  const now = (options.now ?? new Date()).getTime();
  return now - heartbeat <= (options.maxAgeMs ?? DEFAULT_MONITOR_MAX_AGE_MS);
}
