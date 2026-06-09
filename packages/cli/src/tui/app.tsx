import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdin, useStdout } from "ink";
import {
  findConfigPath,
  glyphs,
  PALETTE,
  renderMarkdownReport,
  runCouncil,
  VERDICT_COLOR,
  type QuorateConfig,
  type CouncilEvent,
  type CouncilMode,
  type CouncilReport,
  type CouncilRequest
} from "@quorate/core";
import {
  composerPlaceholder,
  createInitialSessionState,
  formatActiveAgentLabel,
  idleFooterHint,
  inputHistory,
  recallHistoryInput,
  resolveActiveAgents,
  sessionReducer,
  sessionUxHints,
  statusHeuristicHint,
  type SessionState,
  type ShellContext,
  type TranscriptCell
} from "./context.js";
import {
  splitWords,
  withProviderSelection,
  withRoleSelection,
  withRouteOverrides,
  providerRunPreflight,
  providerSnapshots,
  type ProviderSnapshot
} from "../session.js";
import { loadProjectMemory, projectDefaultsLine } from "../project-memory.js";
import { sessionRecapLine, type PersistedSession } from "../sessions.js";
import {
  commandCompletesWithoutArgs,
  matchCommands,
  parseAndRun
} from "./commands.js";
import { SlashPalette } from "./SlashPalette.js";
import { Spinner, Elapsed, BusyLabel, Cursor } from "./Spinner.js";
import { readVersion } from "../version.js";
import {
  Welcome,
  DiffCard,
  VerdictReport,
  RunningCard,
  LaneStream,
  ProvidersGrid,
  HelpView,
  SkillsView,
  PluginsView,
  ProviderDetailView,
  SettingsView,
  ThemeView,
  LogsOverview,
  LogsDetailView,
  RouteView,
  type RunRow
} from "./views.js";

const execFileAsync = promisify(execFile);

/** Per-lane live-output tail bounds. Memory stays flat: at most ~200 lines or
 *  ~16KB per provider:role lane, dropped from the front as new output arrives. */
const MAX_TAIL_LINES = 200;
const MAX_TAIL_BYTES = 16_384;

function laneKey(providerId: string, role: string): string {
  return `${providerId}:${role}`;
}

/** The last non-blank, carriage-return-stripped line in a lane buffer — the
 *  meaningful activity line, immune to progress-redraw churn and blank flushes. */
function lastMeaningful(buf: string[]): string | undefined {
  for (let i = buf.length - 1; i >= 0; i--) {
    const line = buf[i].replace(/\r/g, "").trim();
    if (line) return line;
  }
  return undefined;
}

/** Live per-provider progress for the running card. */
interface RunProgress {
  label: string;
  rows: RunRow[];
}

async function runBangCommand(commandLine: string, cwd: string): Promise<string> {
  const parts = splitWords(commandLine);
  if (parts.length === 0) {
    throw new Error("Empty command.");
  }
  const [command, ...args] = parts;
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      maxBuffer: 1_000_000,
      timeout: 60_000
    });
    const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
    return combined || "(no output)";
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      signal?: NodeJS.Signals;
    };
    const combined = [execError.stdout, execError.stderr].filter(Boolean).join("\n").trim();
    const detail = combined || (error instanceof Error ? error.message : String(error));
    const code =
      execError.code !== undefined
        ? `exit ${execError.code}`
        : execError.signal
          ? `signal ${execError.signal}`
          : "failed";
    throw new Error(`${code}\n${detail}`);
  }
}

/** A one-time welcome cell, prepended to the transcript so it scrolls into the
 *  permanent log above the live composer. Derived from a single provider scan. */
function welcomeCell(
  cwd: string,
  config: QuorateConfig,
  snapshots: ProviderSnapshot[],
  options?: { projectDefaults?: string; restoredSession?: PersistedSession; active?: string[] }
): TranscriptCell {
  const real = snapshots.filter((snapshot) => snapshot.id !== "heuristic");
  return {
    id: "welcome",
    kind: "welcome",
    version: readVersion(),
    cwd,
    available: snapshots.filter((snapshot) => snapshot.available).length,
    detected: real.filter((snapshot) => snapshot.available).map((snapshot) => snapshot.id),
    totalAgents: real.length,
    councils: config.councils,
    firstRun: !findConfigPath(cwd),
    projectDefaultsLine: options?.projectDefaults,
    sessionRecap: options?.restoredSession ? sessionRecapLine(options.restoredSession) : undefined,
    active: options?.active
  };
}

export interface AppProps {
  cwd: string;
  config: QuorateConfig;
  mode?: CouncilMode;
  providers?: string;
  restoredSession?: PersistedSession;
}

const PALETTE_TOKEN = /^\/\S*$/;
const TERMINAL_CLEAR = "\u001Bc";

function effectiveConfig(state: SessionState): QuorateConfig {
  // Apply the session route override BEFORE the /roles filter so an active /roles
  // narrowing still wins (and a routed-in provider isn't silently re-widened).
  return withRoleSelection(
    withRouteOverrides(
      withProviderSelection(state.config, state.activeProviders),
      state.roleOverrides
    ),
    state.activeRoles
  );
}

function filterHistoryInputs(
  transcript: SessionState["transcript"],
  query: string
): string[] {
  const recent = [...(transcript ?? [])].reverse().map((entry) => entry.input);
  if (!query) return recent;
  const normalized = query.toLowerCase();
  return recent.filter((input) => input.toLowerCase().includes(normalized));
}

function copyToClipboard(text: string): boolean {
  if (process.platform === "darwin") {
    return spawnSync("pbcopy", [], { input: text }).status === 0;
  }
  if (process.platform === "win32") {
    return spawnSync("clip", [], { input: text, shell: true }).status === 0;
  }
  for (const [command, args] of [
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]]
  ] as const) {
    if (spawnSync("which", [command]).status === 0) {
      return spawnSync(command, [...args], { input: text }).status === 0;
    }
  }
  return false;
}

function writeReportFallback(markdown: string): string {
  const dir = mkdtempSync(join(tmpdir(), "quorate-report-"));
  const path = join(dir, "last-report.md");
  writeFileSync(path, markdown, "utf8");
  return path;
}

function cycleShiftTabMode(
  state: SessionState,
  dispatch: React.Dispatch<import("./context.js").SessionAction>
): void {
  if (state.heuristicOnly) {
    dispatch({ type: "setHeuristicOnly", heuristicOnly: false });
    dispatch({ type: "setMode", mode: "review" });
    return;
  }
  if (state.mode === "review") {
    dispatch({ type: "setMode", mode: "plan" });
    return;
  }
  dispatch({ type: "setHeuristicOnly", heuristicOnly: true });
}

export function App({ cwd, config, mode, providers, restoredSession }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdin } = useStdin();
  const { write: writeStdout, stdout } = useStdout();
  const [state, dispatch] = useReducer(sessionReducer, undefined, () =>
    createInitialSessionState({ cwd, config, providers, mode, restoredSession })
  );
  const snapshots = useMemo(
    () => providerSnapshots({ cwd, config, mode: "review", transcript: [] }),
    [cwd, config]
  );
  const detectedCount = snapshots.filter((snapshot) => snapshot.available).length;
  const [cells, setCells] = useState<TranscriptCell[]>(() => {
    const initial = createInitialSessionState({ cwd, config, providers, mode, restoredSession });
    return [
      welcomeCell(cwd, config, snapshots, {
        projectDefaults: projectDefaultsLine(loadProjectMemory(cwd)),
        restoredSession,
        active: resolveActiveAgents(initial)
      })
    ];
  });
  const [buffer, setBuffer] = useState("");
  const [selected, setSelected] = useState(0);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const idRef = useRef(0);
  const nextId = useCallback(() => `c${idRef.current++}`, []);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const queuedInputRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  // Bounded per-lane stdout tail (keyed providerId:role). Lives in a ref so chunk
  // churn never re-renders; only the derived preview line goes onto RunRow.
  const tailRef = useRef<Map<string, string[]>>(new Map());
  // Last meaningful stderr line per lane, for the error case.
  const stderrRef = useRef<Map<string, string>>(new Map());
  // Drill-in focus: which lane the user is watching, and the overview cursor.
  const [focusedLane, setFocusedLane] = useState<{ providerId: string; role: string } | null>(null);
  const [laneCursor, setLaneCursor] = useState(0);
  const focusedLaneRef = useRef(focusedLane);
  focusedLaneRef.current = focusedLane;

  const emit = useCallback(
    (cell: TranscriptCell) => {
      setCells((prev) => [...prev, cell]);
    },
    []
  );

  const runReview = useCallback(
    async (request: CouncilRequest): Promise<CouncilReport> => {
      const current = effectiveConfig(stateRef.current);
      const errors = providerRunPreflight(current);
      if (errors.length > 0) {
        // Thrown (not emitted) so submit()'s catch surfaces it exactly once.
        throw new Error(`Provider preflight failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
      }
      const setRow = (providerId: string, role: string, patch: Partial<RunRow>): void => {
        setProgress((prev) =>
          prev
            ? {
                ...prev,
                rows: prev.rows.map((row) =>
                  row.providerId === providerId && row.role === role ? { ...row, ...patch } : row
                )
              }
            : prev
        );
      };
      const onEvent = (event: CouncilEvent): void => {
        if (event.type === "council/started") {
          setProgress({
            label: stateRef.current.diffLabel ?? event.subject ?? event.mode,
            rows: event.planned.map((entry) => ({
              providerId: entry.providerId,
              role: entry.role,
              state: "queued"
            }))
          });
        } else if (event.type === "provider/started") {
          tailRef.current.set(laneKey(event.providerId, event.role), []);
          setRow(event.providerId, event.role, { state: "running" });
        } else if (event.type === "provider/chunk") {
          const key = laneKey(event.providerId, event.role);
          if (event.stream === "stdout") {
            const buf = tailRef.current.get(key) ?? [];
            for (const part of event.text.split("\n")) buf.push(part);
            while (buf.length > MAX_TAIL_LINES) buf.shift();
            // O(n) byte cap: total once, then drop from the front while over.
            let bytes = buf.reduce((sum, line) => sum + line.length + 1, 0);
            while (bytes > MAX_TAIL_BYTES && buf.length > 1) bytes -= (buf.shift()?.length ?? 0) + 1;
            tailRef.current.set(key, buf);
            const preview = lastMeaningful(buf);
            if (preview) setRow(event.providerId, event.role, { preview });
          } else {
            const line = event.text
              .split("\n")
              .map((segment) => segment.trim())
              .filter(Boolean)
              .pop();
            if (line) {
              stderrRef.current.set(key, line);
              setRow(event.providerId, event.role, { error: line });
            }
          }
        } else if (event.type === "provider/done") {
          const count = event.result.findings.length;
          const note =
            event.result.status === "ok" ? `${count} finding${count === 1 ? "" : "s"}` : event.result.status;
          setRow(event.providerId, event.role, {
            state: "done",
            note,
            status: event.result.status,
            error: event.result.error ?? stderrRef.current.get(laneKey(event.providerId, event.role))
          });
        }
      };
      const controller = new AbortController();
      abortRef.current = controller;
      return runCouncil(request, current, { onEvent, signal: controller.signal });
    },
    [emit, nextId]
  );

  const ctx: ShellContext = useMemo(
    () => ({ getState: () => stateRef.current, dispatch, emit, runReview }),
    [emit, runReview]
  );

  const submit = useCallback(
    async (line: string) => {
      const trimmed = line.trim();
      setBuffer("");
      setSelected(0);
      setHistoryIndex(null);
      if (!trimmed) return;
      emit({ id: nextId(), kind: "text", text: `› ${trimmed}` });
      dispatch({ type: "recordInput", input: trimmed });
      if (trimmed === "/exit" || trimmed === "/quit" || trimmed === "/q") {
        exit();
        return;
      }
      if (trimmed.startsWith("!")) {
        const commandLine = trimmed.slice(1).trim();
        if (!commandLine) return;
        startedAtRef.current = Date.now();
        setBusy(true);
        try {
          const output = await runBangCommand(commandLine, stateRef.current.cwd);
          emit({ id: nextId(), kind: "text", text: output });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          emit({ id: nextId(), kind: "text", text: message });
        } finally {
          setBusy(false);
        }
        return;
      }
      startedAtRef.current = Date.now();
      setBusy(true);
      try {
        await parseAndRun(ctx, trimmed);
      } catch (error) {
        // Surface the failure instead of swallowing it — an interrupted run or a
        // thrown error would otherwise leave the user with no feedback at all.
        const g = glyphs();
        const message = abortRef.current?.signal.aborted
          ? `${g.warn} Interrupted — no verdict returned.`
          : error instanceof Error
            ? error.message
            : String(error);
        emit({ id: nextId(), kind: "text", text: message });
      } finally {
        setBusy(false);
        // Clear live progress so an interrupted or errored run leaves no stale
        // tally; the next run repopulates it from council/started.
        setProgress(null);
        // Drop drill-in focus and the bounded tail buffers so a finished or
        // interrupted run leaves no stale focus or buffered provider output.
        setFocusedLane(null);
        setLaneCursor(0);
        tailRef.current.clear();
        stderrRef.current.clear();
        abortRef.current = null;
        const queued = queuedInputRef.current;
        queuedInputRef.current = null;
        if (queued) {
          void submit(queued);
        }
      }
    },
    [ctx, emit, exit, nextId]
  );

  const paletteOpen = PALETTE_TOKEN.test(buffer);
  const query = paletteOpen ? buffer.slice(1) : "";
  const matches = useMemo(() => (paletteOpen ? matchCommands(query, cwd) : []), [paletteOpen, query, cwd]);
  const clampedSelected = matches.length > 0 ? Math.min(selected, matches.length - 1) : 0;

  // Ink debounces a lone ESC (to disambiguate from escape sequences), so a raw
  // listener clears the composer immediately. It only acts on ESC; every other
  // key still flows through useInput below.
  useEffect(() => {
    if (!stdin) return;
    const onData = (chunk: Buffer | string) => {
      if (String(chunk) === String.fromCharCode(27)) {
        // While a lane is focused during a run, let useInput's two-stage Esc own
        // the keypress — clearing here would double-handle and skip stage one.
        if (busyRef.current && focusedLaneRef.current) return;
        setBuffer("");
        setSelected(0);
        setHistoryIndex(null);
      }
    };
    stdin.on("data", onData);
    return () => {
      stdin.off("data", onData);
    };
  }, [stdin]);

  useInput((char, key) => {
    if (key.escape && busy) {
      // Two-stage Esc: a focused lane catches the first Esc (return to overview);
      // at the overview (or unfocused) Esc still aborts on the first press.
      if (focusedLane) {
        setFocusedLane(null);
        return;
      }
      abortRef.current?.abort();
      return;
    }
    if (key.shift && key.tab) {
      cycleShiftTabMode(stateRef.current, dispatch);
      return;
    }
    if (key.ctrl && char === "r") {
      const matches = filterHistoryInputs(stateRef.current.transcript, buffer);
      if (matches.length > 0) {
        setBuffer(matches[0]);
        setHistoryIndex(null);
      }
      return;
    }
    if (key.ctrl && char === "o") {
      const report = stateRef.current.lastReport;
      if (report) {
        const markdown = renderMarkdownReport(report);
        const copied = copyToClipboard(markdown);
        emit({
          id: nextId(),
          kind: "text",
          text: copied
            ? "Copied last report to clipboard."
            : `Report saved to ${writeReportFallback(markdown)}`
        });
      }
      return;
    }
    if (key.ctrl && char === "l") {
      writeStdout(TERMINAL_CLEAR);
      return;
    }
    if (busy && key.tab && buffer.trim()) {
      queuedInputRef.current = buffer.trim();
      setBuffer("");
      setSelected(0);
      emit({ id: nextId(), kind: "text", text: `Queued: ${queuedInputRef.current}` });
      return;
    }
    // Drill-in navigation (non-printing keys only). Gated behind busy + a live
    // panel + an empty composer + no open palette, so typing and Tab-queue still
    // flow to the composer. Each branch early-returns so arrows/Enter never leak
    // into the palette, history recall, or submit.
    const rows = progress?.rows ?? [];
    const composerEmpty = buffer.trim().length === 0;
    const drillAvailable = busy && rows.length > 0 && composerEmpty && !(paletteOpen && matches.length > 0);
    if (drillAvailable) {
      if (focusedLane) {
        if (key.leftArrow) {
          setFocusedLane(null);
          return;
        }
        if (key.upArrow || key.downArrow) return; // reserved for tail scroll
        if (key.return || key.rightArrow) return; // no submit/recall while focused
      } else {
        if (key.upArrow) {
          setLaneCursor((index) => (index - 1 + rows.length) % rows.length);
          return;
        }
        if (key.downArrow) {
          setLaneCursor((index) => (index + 1) % rows.length);
          return;
        }
        if (key.rightArrow || key.return) {
          const row = rows[Math.min(laneCursor, rows.length - 1)];
          if (row) setFocusedLane({ providerId: row.providerId, role: row.role });
          return;
        }
      }
    }
    if (paletteOpen && matches.length > 0) {
      if (key.upArrow) {
        setSelected((index) => (index - 1 + matches.length) % matches.length);
        return;
      }
      if (key.downArrow) {
        setSelected((index) => (index + 1) % matches.length);
        return;
      }
      if (key.tab) {
        setBuffer(`/${matches[clampedSelected].name} `);
        setSelected(0);
        return;
      }
      if (key.return) {
        const command = matches[clampedSelected];
        if (commandCompletesWithoutArgs(command)) {
          void submit(`/${command.name}`);
        } else {
          setBuffer(`/${command.name} `);
          setSelected(0);
        }
        return;
      }
    }
    if (!(paletteOpen && matches.length > 0)) {
      const history = inputHistory(stateRef.current);
      if (key.upArrow && history.length > 0) {
        const recalled = recallHistoryInput(history, historyIndex, "up");
        setHistoryIndex(recalled.index);
        setBuffer(recalled.value);
        return;
      }
      if (key.downArrow && historyIndex !== null) {
        const recalled = recallHistoryInput(history, historyIndex, "down");
        setHistoryIndex(recalled.index);
        setBuffer(recalled.value);
        return;
      }
    }
    if (key.escape || char === "\u001B") {
      setBuffer("");
      setSelected(0);
      setHistoryIndex(null);
      return;
    }
    if (key.ctrl && char === "c") {
      if (buffer.length > 0) {
        setBuffer("");
        setSelected(0);
        setHistoryIndex(null);
        return;
      }
      exit();
      return;
    }
    if (key.return) {
      void submit(buffer);
      return;
    }
    if (key.backspace || key.delete) {
      setBuffer((prev) => prev.slice(0, -1));
      setSelected(0);
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      setHistoryIndex(null);
      setBuffer((prev) => prev + char);
      setSelected(0);
    }
  });

  const g = glyphs();
  const ux = sessionUxHints(state, detectedCount);
  const activeAgentLabel = formatActiveAgentLabel(state);
  const degraded = Boolean(state.lastReport?.metadata.degraded);
  const placeholder = composerPlaceholder(state, ux);
  const footerHint = idleFooterHint(state, ux, g.separator);
  const heuristicHint = statusHeuristicHint(ux);

  const startedAt = startedAtRef.current || Date.now();
  const maxWidth = stdout?.columns ?? 80;
  // The status-line affordance for drill-in only makes sense when the composer is
  // empty (otherwise Up/Down feed the composer / Tab queues, not lane navigation).
  const composerEmptyForHint = buffer.trim().length === 0;
  const focusedTail = focusedLane
    ? tailRef.current.get(laneKey(focusedLane.providerId, focusedLane.role)) ?? []
    : [];
  return (
    <Box flexDirection="column">
      <Static items={cells}>{(cell) => <TranscriptItem key={cell.id} cell={cell} />}</Static>
      <Box flexDirection="column" marginTop={1}>
        {busy && progress && progress.rows.length > 0 ? (
          focusedLane ? (
            <>
              <Text color={PALETTE.dim}>
                {progress.rows
                  .map(
                    (row) =>
                      `${row.providerId} ${
                        row.state === "done"
                          ? row.status && row.status !== "ok"
                            ? g.cross
                            : g.check
                          : row.state === "running"
                            ? "…"
                            : "queued"
                      }`
                  )
                  .join(` ${g.separator} `)}
              </Text>
              <LaneStream
                providerId={focusedLane.providerId}
                role={focusedLane.role}
                lines={focusedTail}
                maxWidth={maxWidth}
                startedAt={startedAt}
              />
              <StatusLine
                mode={state.mode}
                activeAgents={activeAgentLabel}
                detectedCount={detectedCount}
                diffLabel={progress.label}
                degraded={degraded}
                runningSince={startedAt}
              />
            </>
          ) : (
            <>
              <RunningCard
                rows={progress.rows}
                label={progress.label}
                startedAt={startedAt}
                maxWidth={maxWidth}
              />
              <StatusLine
                mode={state.mode}
                activeAgents={activeAgentLabel}
                detectedCount={detectedCount}
                diffLabel={progress.label}
                degraded={degraded}
                runningSince={startedAt}
                drillHint={composerEmptyForHint ? " · ↑/↓ pick · → watch a lane" : undefined}
              />
            </>
          )
        ) : busy ? (
          <Text>
            <Spinner />
            <BusyLabel since={startedAt} />
            <Text dimColor>{` ${g.separator} convening the council ${g.separator} `}</Text>
            <Elapsed since={startedAt} />
            <Text dimColor>{` ${g.separator} esc to interrupt`}</Text>
          </Text>
        ) : (
          <StatusLine
            mode={state.mode}
            activeAgents={activeAgentLabel}
            detectedCount={detectedCount}
            diffLabel={state.diffLabel}
            heuristicHint={heuristicHint}
            degraded={degraded}
            lastReport={state.lastReport}
          />
        )}
        <Box borderStyle="round" borderColor={paletteOpen ? PALETTE.command : PALETTE.dim} paddingX={1}>
          <Text>
            <Text color={PALETTE.command} bold>{"› "}</Text>
            <Text>{buffer}</Text>
            <Cursor />
            {buffer.length === 0 ? <Text dimColor>{placeholder}</Text> : null}
          </Text>
        </Box>
        {paletteOpen ? (
          <SlashPalette matches={matches} selectedIndex={clampedSelected} />
        ) : busy ? null : (
          <FooterHint hint={footerHint} />
        )}
      </Box>
    </Box>
  );
}

function TranscriptItem({ cell }: { cell: TranscriptCell }): React.ReactElement {
  switch (cell.kind) {
    case "welcome":
      return (
        <Welcome
          version={cell.version}
          cwd={cell.cwd}
          available={cell.available}
          detected={cell.detected}
          totalAgents={cell.totalAgents}
          councils={cell.councils}
          firstRun={cell.firstRun}
          projectDefaultsLine={cell.projectDefaultsLine}
          sessionRecap={cell.sessionRecap}
          active={cell.active}
        />
      );
    case "diff":
      return <DiffCard label={cell.label} diff={cell.diff} />;
    case "text":
      return <Text>{cell.text}</Text>;
    case "markdown":
      return <Text>{cell.markdown}</Text>;
    case "findings":
      return <VerdictReport report={cell.report} maxWidth={process.stdout.columns ?? 80} />;
    case "providerStatus":
      return <ProvidersGrid rows={cell.rows} />;
    case "help":
      return <HelpView />;
    case "skills":
      return <SkillsView roles={cell.roles} />;
    case "plugins":
      return <PluginsView items={cell.items} />;
    case "providerDetail":
      return <ProviderDetailView provider={cell.provider} available={cell.available} enabled={cell.enabled} />;
    case "settings":
      return <SettingsView config={cell.config} />;
    case "theme":
      return <ThemeView />;
    case "logs":
      return cell.variant === "detail" ? (
        <LogsDetailView result={cell.result} maxWidth={process.stdout.columns ?? 80} />
      ) : (
        <LogsOverview lanes={cell.lanes} />
      );
    case "route":
      return <RouteView rows={cell.rows} />;
    default:
      return <Text> </Text>;
  }
}

interface StatusLineProps {
  mode: CouncilMode;
  activeAgents: string;
  detectedCount: number;
  diffLabel?: string;
  heuristicHint?: string;
  degraded: boolean;
  lastReport?: CouncilReport;
  runningSince?: number;
  /** Appended after the running spinner to advertise drill-in navigation. */
  drillHint?: string;
}

/** Semantic color per mode, like Claude Code's mode footer: review is the active
 *  blue "doing" mode, plan is green (read-only thinking). The `!` shell escape is
 *  rendered red elsewhere as a "this runs a real command" cue. */
function modeColor(mode: CouncilMode): string {
  return mode === "plan" ? PALETTE.pass : PALETTE.command;
}

/** The dim footer hint, with the `! shell` escape highlighted red — it runs a
 *  real local command, so it gets the same danger cue as a shell mode. */
function FooterHint({ hint }: { hint: string }): React.ReactElement {
  const marker = "! shell";
  const at = hint.indexOf(marker);
  if (at < 0) return <Text dimColor>{hint}</Text>;
  return (
    <Text dimColor>
      {hint.slice(0, at)}
      <Text color={PALETTE.fail}>{marker}</Text>
      {hint.slice(at + marker.length)}
    </Text>
  );
}

/** The status line: mode · active agents · diff (when loaded) · then either a
 *  live spinner+elapsed while a council runs, or the verdict/degraded/hint tail. */
function StatusLine(props: StatusLineProps): React.ReactElement {
  const g = glyphs();
  const { mode, activeAgents, diffLabel, heuristicHint, degraded, runningSince, drillHint } = props;
  const verdict = props.lastReport?.verdict;
  const verdictColor = degraded ? PALETTE.degraded : verdict ? VERDICT_COLOR[verdict] ?? "white" : "white";
  return (
    <Text dimColor>
      <Text color={modeColor(mode)}>{`${g.mode} ${mode}`}</Text>
      <Text>{`   ${g.provider} ${activeAgents}`}</Text>
      {diffLabel ? <Text>{`   ${g.diff} ${diffLabel}`}</Text> : null}
      {runningSince != null ? (
        <Text color={PALETTE.spinner}>
          {"   "}
          <Spinner />
          <Text>{" "}</Text>
          <Elapsed since={runningSince} />
          {drillHint ? <Text color={PALETTE.dim}>{drillHint}</Text> : null}
        </Text>
      ) : (
        <>
          {heuristicHint ? <Text color={PALETTE.degraded}>{`   ${heuristicHint}`}</Text> : null}
          {degraded ? <Text color={PALETTE.degraded}>{`   ${g.warn} degraded`}</Text> : null}
          {verdict ? (
            <Text color={verdictColor}>{`   ${g.verdict[verdict]} ${verdict.toUpperCase()}`}</Text>
          ) : null}
        </>
      )}
    </Text>
  );
}
