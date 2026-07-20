import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@quorate/core";
import { createLiveSpoolSink } from "../src/live-spool.js";
import {
  appendTail,
  applyEventToLanes,
  blurLane,
  buildRunTree,
  focusLaneAtCursor,
  initialMonitorState,
  laneKeyOf,
  MONITOR_TAIL_BYTES,
  MONITOR_TAIL_LINES,
  moveLaneCursor,
  moveRunSelection,
  pollMonitorState,
  type MonitorLane
} from "../src/tui/monitor-state.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "quorate-monitor-"));
}

function started(runId: string, at = "2026-07-20T00:00:00.000Z"): CouncilEvent {
  return {
    type: "council/started",
    councilRunId: runId,
    mode: "review",
    subject: "subject",
    planned: [
      { providerId: "claude", role: "security", providerType: "cli" },
      { providerId: "codex", role: "qa", providerType: "cli" }
    ],
    at
  };
}

function providerStarted(runId: string, providerId = "claude", role = "security"): CouncilEvent {
  return { type: "provider/started", councilRunId: runId, providerId, role, providerType: "cli", at: "now" };
}

function chunk(runId: string, text: string, stream: "stdout" | "stderr" = "stdout"): CouncilEvent {
  return { type: "provider/chunk", councilRunId: runId, providerId: "claude", role: "security", stream, text };
}

function providerDone(runId: string, status = "ok", findings = 2): CouncilEvent {
  return {
    type: "provider/done",
    councilRunId: runId,
    providerId: "claude",
    role: "security",
    result: {
      providerId: "claude",
      role: "security",
      providerType: "cli",
      status,
      findings: Array.from({ length: findings }, (_, index) => ({ id: `f${index}` })),
      durationMs: 10
    } as never
  };
}

describe("applyEventToLanes", () => {
  it("seeds queued lanes from council/started planned[]", () => {
    // Act
    const lanes = applyEventToLanes([], started("run-1"));

    // Assert
    expect(lanes.map((lane) => lane.laneKey)).toEqual(["claude:security", "codex:qa"]);
    expect(lanes.every((lane) => lane.row.state === "queued")).toBe(true);
  });

  it("walks a lane queued → running → done with finding note", () => {
    // Arrange
    let lanes = applyEventToLanes([], started("run-1"));

    // Act
    lanes = applyEventToLanes(lanes, providerStarted("run-1"));
    lanes = applyEventToLanes(lanes, providerDone("run-1", "ok", 2));

    // Assert
    const lane = lanes.find((entry) => entry.laneKey === "claude:security");
    expect(lane?.row.state).toBe("done");
    expect(lane?.row.note).toBe("2 findings");
    expect(lane?.row.status).toBe("ok");
  });

  it("adds unplanned lanes on the fly (deterministic gates)", () => {
    // Arrange
    const lanes = applyEventToLanes([], started("run-1"));

    // Act
    const next = applyEventToLanes(lanes, {
      ...providerStarted("run-1", "supply-chain", "supply-chain")
    });

    // Assert
    expect(next.map((lane) => lane.laneKey)).toContain("supply-chain:supply-chain");
  });

  it("keeps stdout tails bounded and derives the preview from the last meaningful line", () => {
    // Arrange
    let lanes = applyEventToLanes([], started("run-1"));
    lanes = applyEventToLanes(lanes, providerStarted("run-1"));

    // Act — blow past both caps with line-terminated chunks.
    for (let index = 0; index < MONITOR_TAIL_LINES + 50; index += 1) {
      lanes = applyEventToLanes(lanes, chunk("run-1", `line-${index}\n`));
    }

    // Assert
    const lane = lanes.find((entry) => entry.laneKey === "claude:security") as MonitorLane;
    expect(lane.tail.length).toBeLessThanOrEqual(MONITOR_TAIL_LINES);
    expect(lane.tail.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0)).toBeLessThanOrEqual(
      MONITOR_TAIL_BYTES
    );
    expect(lane.row.preview).toBe(`line-${MONITOR_TAIL_LINES + 49}`);
  });

  it("records the last stderr line as the lane error", () => {
    // Arrange
    let lanes = applyEventToLanes([], started("run-1"));
    lanes = applyEventToLanes(lanes, providerStarted("run-1"));

    // Act
    lanes = applyEventToLanes(lanes, chunk("run-1", "warning: rate limited\n", "stderr"));

    // Assert
    expect(lanes.find((lane) => lane.laneKey === "claude:security")?.row.error).toBe("warning: rate limited");
  });

  it("keeps accumulated lane state on a duplicate council/started", () => {
    // Arrange
    let lanes = applyEventToLanes([], started("run-1"));
    lanes = applyEventToLanes(lanes, providerStarted("run-1"));
    lanes = applyEventToLanes(lanes, chunk("run-1", "progress line\n"));

    // Act — a replayed/duplicate started event arrives.
    const after = applyEventToLanes(lanes, started("run-1"));

    // Assert — running state and tails survive.
    const lane = after.find((entry) => entry.laneKey === "claude:security");
    expect(lane?.row.state).toBe("running");
    expect(lane?.tail).toContain("progress line");
  });

  it("does not mutate the previous lane array", () => {
    // Arrange
    const before = applyEventToLanes([], started("run-1"));
    const snapshot = JSON.parse(JSON.stringify(before));

    // Act
    applyEventToLanes(before, providerStarted("run-1"));

    // Assert
    expect(before).toEqual(snapshot);
  });
});

describe("appendTail", () => {
  it("splits multi-line chunks and enforces the byte cap", () => {
    // Act
    const first = appendTail([], "a\nb\nc");
    const huge = appendTail(first.tail, "x".repeat(MONITOR_TAIL_BYTES * 2));

    // Assert
    expect(first.tail).toEqual(["a", "b", "c"]);
    expect(first.open).toBe(true); // "c" has no trailing newline yet
    expect(huge.tail.length).toBe(1); // the oversized line evicts everything before it
  });

  it("stitches non-line-aligned chunks back into whole lines", () => {
    // Arrange — a single logical line arriving as three stream fragments.
    const a = appendTail([], "compil");
    const b = appendTail(a.tail, "ing modu", a.open);
    const c = appendTail(b.tail, "le X\ndone\n", b.open);

    // Act & Assert
    expect(c.tail).toEqual(["compiling module X", "done"]);
    expect(c.open).toBe(false);
  });
});

describe("pollMonitorState over a real spool", () => {
  it("discovers runs, folds events incrementally, and keeps selection stable", () => {
    // Arrange — two runs written through the real spool sink.
    const dir = tempDir();
    const first = createLiveSpoolSink({ dir, includeChunks: true, pid: process.pid });
    first.handleEvent(started("run-a", "2026-07-20T01:00:00.000Z"));
    first.handleEvent(providerStarted("run-a"));
    const second = createLiveSpoolSink({ dir, includeChunks: true, pid: process.pid });
    second.handleEvent(started("run-b", "2026-07-20T02:00:00.000Z"));

    // Act — first poll discovers both (newest first).
    let state = pollMonitorState(initialMonitorState(), { dir });

    // Assert
    expect(state.runs.map((run) => run.entry.runId)).toEqual(["run-b", "run-a"]);
    expect(state.selectedRun).toBe("run-b");

    // Act — select the older run, then new events arrive and we re-poll.
    state = moveRunSelection(state, 1);
    first.handleEvent(chunk("run-a", "checking auth module"));
    first.handleEvent(providerDone("run-a"));
    state = pollMonitorState(state, { dir });

    // Assert — selection survived; incremental events were folded in.
    expect(state.selectedRun).toBe("run-a");
    const runA = state.runs.find((run) => run.entry.runId === "run-a");
    const lane = runA?.lanes.find((entry) => entry.laneKey === laneKeyOf("claude", "security"));
    expect(lane?.row.state).toBe("done");
    expect(lane?.tail).toContain("checking auth module");
  });

  it("returns empty state for an empty or missing spool dir", () => {
    // Act
    const state = pollMonitorState(initialMonitorState(), { dir: join(tempDir(), "missing") });

    // Assert
    expect(state.runs).toEqual([]);
    expect(state.selectedRun).toBeUndefined();
  });
});

describe("subagent run tree", () => {
  it("nests a child run under its parent and keeps orphans top-level", () => {
    // Arrange — parent, its child, and a child whose parent is unknown.
    const dir = tempDir();
    const parent = createLiveSpoolSink({ dir, pid: process.pid });
    parent.handleEvent(started("run-parent", "2026-07-20T03:00:00.000Z"));
    const child = createLiveSpoolSink({ dir, pid: process.pid });
    child.handleEvent({
      ...started("run-child", "2026-07-20T03:01:00.000Z"),
      parentRunId: "run-parent",
      parentLane: "claude:security"
    } as CouncilEvent);
    const orphan = createLiveSpoolSink({ dir, pid: process.pid });
    orphan.handleEvent({
      ...started("run-orphan", "2026-07-20T03:02:00.000Z"),
      parentRunId: "run-vanished",
      parentLane: "codex:qa"
    } as CouncilEvent);

    // Act
    const state = pollMonitorState(initialMonitorState(), { dir });

    // Assert — child folded under parent; orphan stays visible at top level.
    const topIds = state.runs.map((run) => run.entry.runId);
    expect(topIds).toContain("run-parent");
    expect(topIds).toContain("run-orphan");
    expect(topIds).not.toContain("run-child");
    const parentRun = state.runs.find((run) => run.entry.runId === "run-parent");
    expect(parentRun?.children?.[0]?.entry.runId).toBe("run-child");
    expect(parentRun?.children?.[0]?.entry.parentLane).toBe("claude:security");
  });

  it("keeps grandchildren visible at top level (single-hop nesting)", () => {
    // Arrange — parent <- child <- grandchild.
    const dir = tempDir();
    const parent = createLiveSpoolSink({ dir, pid: process.pid });
    parent.handleEvent(started("run-p", "2026-07-20T04:00:00.000Z"));
    const child = createLiveSpoolSink({ dir, pid: process.pid });
    child.handleEvent({
      ...started("run-c", "2026-07-20T04:01:00.000Z"),
      parentRunId: "run-p",
      parentLane: "claude:security"
    } as CouncilEvent);
    const grandchild = createLiveSpoolSink({ dir, pid: process.pid });
    grandchild.handleEvent({
      ...started("run-g", "2026-07-20T04:02:00.000Z"),
      parentRunId: "run-c",
      parentLane: "codex:qa"
    } as CouncilEvent);

    // Act
    const state = pollMonitorState(initialMonitorState(), { dir });

    // Assert — the grandchild's parent is itself folded, so it stays top-level.
    const topIds = state.runs.map((run) => run.entry.runId);
    expect(topIds).toContain("run-p");
    expect(topIds).toContain("run-g");
    expect(topIds).not.toContain("run-c");
  });

  it("buildRunTree ignores self-referential parents", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, pid: process.pid });
    sink.handleEvent({
      ...started("run-self"),
      parentRunId: "run-self",
      parentLane: "claude:security"
    } as CouncilEvent);
    const flat = pollMonitorState(initialMonitorState(), { dir }).runs;

    // Act
    const tree = buildRunTree(flat);

    // Assert — no infinite nesting; the run stays top-level.
    expect(tree.map((run) => run.entry.runId)).toContain("run-self");
    expect(tree[0]?.children).toBeUndefined();
  });

  it("events without parent fields behave exactly as before", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, pid: process.pid });
    sink.handleEvent(started("run-plain"));

    // Act
    const state = pollMonitorState(initialMonitorState(), { dir });

    // Assert
    expect(state.runs[0]?.entry.parentRunId).toBeUndefined();
    expect(state.runs[0]?.children).toBeUndefined();
  });
});

describe("keyboard state transitions", () => {
  function seeded() {
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, pid: process.pid });
    sink.handleEvent(started("run-k"));
    return pollMonitorState(initialMonitorState(), { dir });
  }

  it("moves the lane cursor within bounds", () => {
    // Arrange
    let state = seeded();

    // Act & Assert
    state = moveLaneCursor(state, 1);
    expect(state.laneCursor).toBe(1);
    state = moveLaneCursor(state, 5);
    expect(state.laneCursor).toBe(1); // clamped to last lane
    state = moveLaneCursor(state, -9);
    expect(state.laneCursor).toBe(0);
  });

  it("focuses the lane at the cursor and blurs back", () => {
    // Arrange
    let state = seeded();

    // Act
    state = focusLaneAtCursor(state);
    expect(state.focusedLane).toBe("claude:security");
    state = blurLane(state);

    // Assert
    expect(state.focusedLane).toBeUndefined();
  });

  it("run selection is a no-op at the edges", () => {
    // Arrange
    const state = seeded();

    // Act & Assert
    expect(moveRunSelection(state, -1)).toBe(state);
    expect(moveRunSelection(state, 1)).toBe(state);
  });
});
