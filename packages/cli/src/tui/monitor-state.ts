import type { CouncilEvent } from "@quorate/core";
import { listLiveRuns, readRunEvents, type LiveRunEntry } from "../live-spool.js";
import type { RunRow } from "./views.js";

/**
 * Pure state model for `quorate monitor`: a poll-driven reduction of the live
 * spool (~/.quorate/live) into renderable rows. All functions here are pure or
 * filesystem-read-only so the TUI layer stays a thin shell over tested logic.
 *
 * Tree shape mirrors the product model: a RUN (council) contains AGENTS
 * (providers) which contain SUBAGENT lanes (provider×role).
 */

export const MONITOR_TAIL_LINES = 200;
export const MONITOR_TAIL_BYTES = 16_384;

export interface MonitorLane {
  laneKey: string;
  providerId: string;
  role: string;
  row: RunRow;
  /** Bounded stdout tail for the drill-in view. */
  tail: string[];
  /** True when the last chunk ended mid-line — the next chunk continues it. */
  tailOpen?: boolean;
}

export interface MonitorRun {
  entry: LiveRunEntry;
  lanes: MonitorLane[];
  verdict?: string;
  degraded?: boolean;
  /** Spool file read offset — passed back to readRunEvents to tail. */
  offset: number;
}

export interface MonitorState {
  runs: MonitorRun[];
  /** runId of the selected run. */
  selectedRun?: string;
  /** laneKey drill-in within the selected run. */
  focusedLane?: string;
  laneCursor: number;
}

export function initialMonitorState(): MonitorState {
  return { runs: [], laneCursor: 0 };
}

export function laneKeyOf(providerId: string, role: string): string {
  return `${providerId}:${role}`;
}

function laneFromKey(laneKey: string): MonitorLane {
  const colon = laneKey.indexOf(":");
  const providerId = colon === -1 ? laneKey : laneKey.slice(0, colon);
  const role = colon === -1 ? "" : laneKey.slice(colon + 1);
  return {
    laneKey,
    providerId,
    role,
    row: { providerId, role, state: "queued" },
    tail: []
  };
}

/**
 * Bounded append mirroring the shell's tailRef caps (200 lines / 16KB).
 * Chunks are arbitrary stream fragments, not line-aligned: when the previous
 * chunk ended mid-line (`open`), the first part continues the last tail line.
 * Returns the new tail plus whether this chunk itself ended mid-line.
 */
export function appendTail(tail: string[], text: string, open = false): { tail: string[]; open: boolean } {
  const next = [...tail];
  const parts = text.split("\n");
  const first = parts.shift() ?? "";
  if (open && next.length > 0) next[next.length - 1] = `${next[next.length - 1]}${first}`;
  else next.push(first);
  for (const part of parts) next.push(part);
  // A trailing "" means the chunk ended exactly on a newline; drop the empty
  // continuation slot but remember the line is closed.
  const endsOpen = !text.endsWith("\n");
  if (!endsOpen && next[next.length - 1] === "") next.pop();
  while (next.length > MONITOR_TAIL_LINES) next.shift();
  let bytes = next.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);
  while (bytes > MONITOR_TAIL_BYTES && next.length > 1) bytes -= Buffer.byteLength(next.shift() ?? "") + 1;
  return { tail: next, open: endsOpen };
}

function lastMeaningful(lines: string[]): string | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (line) return line;
  }
  return undefined;
}

/** Reduce one CouncilEvent into a run's lane list (immutable). */
export function applyEventToLanes(lanes: MonitorLane[], event: CouncilEvent): MonitorLane[] {
  if (event.type === "council/started") {
    // Idempotent: a duplicate/late started event must not wipe accumulated
    // lane state — only add planned lanes we have not seen yet.
    const known = new Set(lanes.map((lane) => lane.laneKey));
    const added = event.planned
      .map((planned) => laneKeyOf(planned.providerId, planned.role))
      .filter((key) => !known.has(key))
      .map(laneFromKey);
    return lanes.length === 0 ? added : [...lanes, ...added];
  }
  if (event.type !== "provider/started" && event.type !== "provider/chunk" && event.type !== "provider/done") {
    return lanes;
  }
  const key = laneKeyOf(event.providerId, event.role);
  const known = lanes.some((lane) => lane.laneKey === key);
  // Lanes can appear that were not in planned[] (e.g. deterministic gates).
  const base = known ? lanes : [...lanes, laneFromKey(key)];
  return base.map((lane) => {
    if (lane.laneKey !== key) return lane;
    if (event.type === "provider/started") {
      return { ...lane, row: { ...lane.row, state: "running" as const } };
    }
    if (event.type === "provider/chunk") {
      if (event.stream === "stdout") {
        const appended = appendTail(lane.tail, event.text, lane.tailOpen);
        const preview = lastMeaningful(appended.tail);
        return {
          ...lane,
          tail: appended.tail,
          tailOpen: appended.open,
          row: preview ? { ...lane.row, preview } : lane.row
        };
      }
      const errorLine = event.text
        .split("\n")
        .map((segment) => segment.trim())
        .filter(Boolean)
        .pop();
      return errorLine ? { ...lane, row: { ...lane.row, error: errorLine } } : lane;
    }
    const count = event.result.findings.length;
    const note = event.result.status === "ok" ? `${count} finding${count === 1 ? "" : "s"}` : event.result.status;
    return {
      ...lane,
      row: {
        ...lane.row,
        state: "done" as const,
        note,
        status: event.result.status,
        error: event.result.error ?? lane.row.error
      }
    };
  });
}

export interface PollOptions {
  dir?: string;
  /** Cap on how many runs the dashboard tracks (newest first). */
  maxRuns?: number;
}

/**
 * One poll tick: rescan the registry, tail each tracked run's spool file from
 * its last offset, and fold new events into the existing state. Selection and
 * focus survive re-polls; a vanished selected run falls back to the newest.
 */
export function pollMonitorState(previous: MonitorState, options: PollOptions = {}): MonitorState {
  const maxRuns = options.maxRuns ?? 20;
  const entries = listLiveRuns({ dir: options.dir }).slice(0, maxRuns);
  const previousById = new Map(previous.runs.map((run) => [run.entry.runId, run]));

  const runs = entries.map((entry) => {
    const existing = previousById.get(entry.runId);
    const { events, report, offset, reset } = readRunEvents(entry.runId, {
      dir: options.dir,
      fromOffset: existing?.offset ?? 0
    });
    // `reset` = the file shrank under our offset (truncated/recreated): the
    // returned events are a full replay, so rebuild lanes from scratch.
    let lanes = reset || !existing ? [] : existing.lanes;
    for (const event of events) lanes = applyEventToLanes(lanes, event);
    const verdict = reset ? report?.verdict : report?.verdict ?? existing?.verdict;
    const degraded = reset ? report?.metadata?.degraded : report?.metadata?.degraded ?? existing?.degraded;
    return { entry, lanes, verdict, degraded, offset } satisfies MonitorRun;
  });

  const selectedRun = runs.some((run) => run.entry.runId === previous.selectedRun)
    ? previous.selectedRun
    : runs[0]?.entry.runId;
  const selected = runs.find((run) => run.entry.runId === selectedRun);
  const focusedLane = selected?.lanes.some((lane) => lane.laneKey === previous.focusedLane)
    ? previous.focusedLane
    : undefined;
  const laneCursor = selected ? Math.min(previous.laneCursor, Math.max(selected.lanes.length - 1, 0)) : 0;

  return { runs, selectedRun, focusedLane, laneCursor };
}

/** Cursor/selection transitions for the monitor's keyboard model. */
export function moveRunSelection(state: MonitorState, delta: number): MonitorState {
  if (state.runs.length === 0) return state;
  const index = state.runs.findIndex((run) => run.entry.runId === state.selectedRun);
  const next = Math.min(Math.max(index + delta, 0), state.runs.length - 1);
  const selected = state.runs[next];
  if (!selected || selected.entry.runId === state.selectedRun) return state;
  return { ...state, selectedRun: selected.entry.runId, focusedLane: undefined, laneCursor: 0 };
}

export function moveLaneCursor(state: MonitorState, delta: number): MonitorState {
  const selected = state.runs.find((run) => run.entry.runId === state.selectedRun);
  if (!selected || selected.lanes.length === 0) return state;
  const next = Math.min(Math.max(state.laneCursor + delta, 0), selected.lanes.length - 1);
  return next === state.laneCursor ? state : { ...state, laneCursor: next };
}

export function focusLaneAtCursor(state: MonitorState): MonitorState {
  const selected = state.runs.find((run) => run.entry.runId === state.selectedRun);
  const lane = selected?.lanes[state.laneCursor];
  return lane ? { ...state, focusedLane: lane.laneKey } : state;
}

export function blurLane(state: MonitorState): MonitorState {
  return state.focusedLane === undefined ? state : { ...state, focusedLane: undefined };
}
