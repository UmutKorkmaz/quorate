import {
  closeSync,
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

/** Atomic single-file write: temp + rename, cleaning the temp on failure. */
function writeFileAtomic(path: string, content: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, content, "utf8");
    renameSync(temp, path);
  } catch (error: unknown) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function writeMeta(dir: string, entry: LiveRunEntry): void {
  writeFileAtomic(liveRunMetaPath(entry.runId, dir), `${JSON.stringify(entry, null, 2)}\n`);
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
      updatedAt: nowIso()
    };
    const current = entry;
    guard(() => {
      mkdirSync(dir, { recursive: true });
      const path = liveRunFilePath(current.runId, dir);
      writeFileSync(path, "", "utf8"); // truncate any stale file for this runId
      fd = openSync(path, "a"); // O_APPEND: every write lands at EOF atomically
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
    if (typeof record.type === "string") {
      events.push(parsed as CouncilEvent);
    } else if (typeof record.verdict === "string" && Array.isArray(record.findings)) {
      report = parsed as CouncilReport;
    }
  }
  return { events, report, offset: from + lastNewline + 1, reset };
}
