import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import { glyphs, PALETTE, roleColor, VERDICT_COLOR, type QuorateConfig } from "@quorate/core";
import { providerSnapshots, type ShellState } from "../session.js";
import { LaneStream, ProvidersGrid, RunRowView, truncateLine } from "./views.js";
import {
  type MonitorLane,
  blurLane,
  focusLaneAtCursor,
  initialMonitorState,
  moveLaneCursor,
  moveRunSelection,
  pollMonitorState,
  type MonitorRun,
  type MonitorState
} from "./monitor-state.js";

/**
 * `quorate monitor` — a live dashboard over the spool (~/.quorate/live).
 * Shows every council run on this machine (any terminal), its agents and
 * their provider×role subagent lanes, with a LaneStream drill-in per lane.
 * Read-only by design: the spool is the data plane, this is just a viewer.
 */

const POLL_MS = 500;

export interface MonitorAppProps {
  cwd: string;
  config: QuorateConfig;
  /** Spool dir override for tests. */
  dir?: string;
  /** Poll interval in ms; 0 polls exactly once (tests). Default 500. */
  pollMs?: number;
}

function statusColor(status: string): string {
  if (status === "running") return PALETTE.accent;
  if (status === "done") return PALETTE.pass;
  return status === "error" ? PALETTE.fail : PALETTE.dim;
}

function RunHeader({ run, selected }: { run: MonitorRun; selected: boolean }): React.ReactElement {
  const g = glyphs();
  const { entry } = run;
  const doneCount = run.lanes.filter((lane) => lane.row.state === "done").length;
  const verdictText = run.verdict
    ? ` ${g.separator} ${run.verdict.toUpperCase()}${run.degraded ? " (degraded)" : ""}`
    : "";
  return (
    <Text>
      <Text color={selected ? PALETTE.accent : PALETTE.dim}>{selected ? `${g.active} ` : "  "}</Text>
      <Text bold={selected}>{entry.repo}</Text>
      <Text color={PALETTE.dim}>{` ${g.separator} ${entry.mode} ${g.separator} `}</Text>
      <Text color={statusColor(entry.status)}>{entry.status}</Text>
      <Text color={PALETTE.dim}>{` ${g.separator} ${doneCount}/${run.lanes.length} lanes`}</Text>
      {run.verdict ? (
        <Text color={(VERDICT_COLOR as Record<string, string>)[run.verdict] ?? PALETTE.dim}>{verdictText}</Text>
      ) : null}
    </Text>
  );
}

function SelectedRunLanes({
  run,
  cursor,
  maxWidth
}: {
  run: MonitorRun;
  cursor: number;
  maxWidth: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      <Text color={PALETTE.dim}>{run.entry.subject}</Text>
      {run.lanes.length === 0 ? (
        <Text color={PALETTE.dim}>waiting for lanes…</Text>
      ) : (
        run.lanes.map((lane, index) => (
          <Box key={lane.laneKey}>
            <Text color={index === cursor ? PALETTE.accent : PALETTE.dim}>{index === cursor ? "› " : "  "}</Text>
            <RunRowView row={lane.row} maxWidth={Math.max(maxWidth - 4, 16)} />
          </Box>
        ))
      )}
    </Box>
  );
}

/** Drill-in tail for a lane whose run has settled — no spinner, no elapsed. */
function SettledLaneTail({ lane, maxWidth }: { lane: MonitorLane; maxWidth: number }): React.ReactElement {
  const g = glyphs();
  const tail = lane.tail.slice(-16);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={roleColor(lane.role)} bold>{`${lane.providerId}:${lane.role}`}</Text>
        <Text color={PALETTE.dim}>{`  ${lane.row.note ?? lane.row.status ?? "settled"}`}</Text>
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        {tail.length === 0 ? (
          <Text color={PALETTE.dim}>no output captured (chunk streaming off — set QUORATE_JSON_CHUNKS=1)</Text>
        ) : (
          tail.map((line, index) => (
            <Text key={index} color={PALETTE.dim}>{truncateLine(line, maxWidth - 4)}</Text>
          ))
        )}
      </Box>
      <Text color={PALETTE.dim}>{`${lane.providerId}:${lane.role} ${g.separator} settled ${g.separator} esc back`}</Text>
    </Box>
  );
}

export function MonitorApp(props: MonitorAppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const maxWidth = Math.max(Math.min(stdout?.columns ?? 80, 100), 20);
  // Filesystem reads happen only inside the effect below, never in render.
  const [state, setState] = useState<MonitorState>(initialMonitorState);
  const [showAgents, setShowAgents] = useState(false);

  const poll = useCallback(() => {
    setState((previous) => pollMonitorState(previous, { dir: props.dir }));
  }, [props.dir]);

  useEffect(() => {
    poll();
    // pollMs 0 means poll exactly once (tests); otherwise a steady interval.
    const pollMs = props.pollMs ?? POLL_MS;
    if (pollMs <= 0) return undefined;
    const interval = setInterval(poll, pollMs);
    return () => clearInterval(interval);
  }, [poll, props.pollMs]);

  // The installed-agents grid reuses the shell's provider readiness snapshot.
  const agents = useMemo(() => {
    const shellState: ShellState = { cwd: props.cwd, config: props.config, mode: "review", transcript: [] };
    return providerSnapshots(shellState);
  }, [props.cwd, props.config]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (input === "a") {
      setShowAgents((previous) => !previous);
      return;
    }
    if (state.focusedLane) {
      if (key.escape || key.leftArrow) setState(blurLane);
      return;
    }
    if (key.upArrow) setState((previous) => moveLaneCursor(previous, -1));
    if (key.downArrow) setState((previous) => moveLaneCursor(previous, 1));
    if (key.pageUp || input === "[") setState((previous) => moveRunSelection(previous, -1));
    if (key.pageDown || input === "]") setState((previous) => moveRunSelection(previous, 1));
    if (key.rightArrow || key.return) setState(focusLaneAtCursor);
  });

  const g = glyphs();
  const selected = state.runs.find((run) => run.entry.runId === state.selectedRun);
  const focused = selected?.lanes.find((lane) => lane.laneKey === state.focusedLane);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={PALETTE.accent}>Quorate monitor</Text>
        <Text color={PALETTE.dim}>{`  ${g.separator} live runs on this machine`}</Text>
      </Box>

      {showAgents ? <ProvidersGrid rows={agents} /> : null}

      {state.runs.length === 0 ? (
        <Box flexDirection="column">
          <Text color={PALETTE.dim}>No live runs yet.</Text>
          <Text color={PALETTE.dim}>{`Start one with `}
            <Text color={PALETTE.command} bold>quorate review --base main --head HEAD</Text>
            <Text color={PALETTE.dim}>{` in any terminal.`}</Text>
          </Text>
        </Box>
      ) : focused && selected ? (
        selected.entry.status === "running" && focused.row.state !== "done" ? (
          <LaneStream
            providerId={focused.providerId}
            role={focused.role}
            lines={focused.tail}
            maxWidth={maxWidth}
            startedAt={Date.parse(selected.entry.startedAt) || Date.now()}
          />
        ) : (
          <SettledLaneTail lane={focused} maxWidth={maxWidth} />
        )
      ) : (
        <Box flexDirection="column">
          {state.runs.map((run) => (
            <Box key={run.entry.runId} flexDirection="column">
              <RunHeader run={run} selected={run.entry.runId === state.selectedRun} />
              {run.entry.runId === state.selectedRun ? (
                <SelectedRunLanes run={run} cursor={state.laneCursor} maxWidth={maxWidth} />
              ) : null}
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={PALETTE.dim}>
          {focused
            ? `esc back ${g.separator} q quit`
            : `↑↓ lanes ${g.separator} →/enter watch ${g.separator} [ ] runs ${g.separator} a agents ${g.separator} q quit`}
        </Text>
      </Box>
    </Box>
  );
}

export interface LaunchMonitorOptions {
  cwd: string;
  config: QuorateConfig;
  dir?: string;
}

export async function launchMonitor(options: LaunchMonitorOptions): Promise<void> {
  const instance = render(
    React.createElement(MonitorApp, { cwd: options.cwd, config: options.config, dir: options.dir }),
    { exitOnCtrlC: false }
  );
  await instance.waitUntilExit();
}
