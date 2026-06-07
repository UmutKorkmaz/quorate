import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdin } from "ink";
import {
  findConfigPath,
  glyphs,
  PALETTE,
  runCouncil,
  VERDICT_COLOR,
  type QuorateConfig,
  type CouncilEvent,
  type CouncilMode,
  type CouncilReport,
  type CouncilRequest
} from "@quorate/core";
import {
  createInitialSessionState,
  sessionReducer,
  type SessionState,
  type ShellContext,
  type TranscriptCell
} from "./context.js";
import {
  withProviderSelection,
  withRoleSelection,
  providerRunPreflight,
  providerSnapshots,
  type ProviderSnapshot
} from "../session.js";
import { commandRegistry, parseAndRun, type SlashCommand } from "./commands.js";
import { SlashPalette } from "./SlashPalette.js";
import { Spinner, Elapsed, BusyLabel, Cursor } from "./Spinner.js";
import { readVersion } from "../version.js";
import {
  Welcome,
  DiffCard,
  VerdictReport,
  RunningCard,
  ProvidersGrid,
  HelpView,
  SkillsView,
  PluginsView,
  ProviderDetailView,
  SettingsView,
  ThemeView,
  type RunRow
} from "./views.js";

/** Live per-provider progress for the running card. */
interface RunProgress {
  label: string;
  rows: RunRow[];
}

/** A one-time welcome cell, prepended to the transcript so it scrolls into the
 *  permanent log above the live composer. Derived from a single provider scan. */
function welcomeCell(cwd: string, config: QuorateConfig, snapshots: ProviderSnapshot[]): TranscriptCell {
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
    firstRun: !findConfigPath(cwd)
  };
}

export interface AppProps {
  cwd: string;
  config: QuorateConfig;
  mode?: CouncilMode;
  providers?: string;
}

const PALETTE_TOKEN = /^\/\S*$/;

function effectiveConfig(state: SessionState): QuorateConfig {
  return withRoleSelection(withProviderSelection(state.config, state.activeProviders), state.activeRoles);
}

// Hidden commands are excluded from palette autocomplete but remain executable
// when typed in full (resolveCommand still resolves them) — that is intentional.
function matchCommands(query: string): SlashCommand[] {
  return commandRegistry.filter(
    (command) =>
      !command.hidden &&
      (command.name.startsWith(query) || (command.aliases ?? []).some((alias) => alias.startsWith(query)))
  );
}

export function App({ cwd, config, mode, providers }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdin } = useStdin();
  const [state, dispatch] = useReducer(sessionReducer, undefined, () =>
    createInitialSessionState({ cwd, config, providers, mode })
  );
  const snapshots = useMemo(
    () => providerSnapshots({ cwd, config, mode: "review", transcript: [] }),
    [cwd, config]
  );
  const availableCount = snapshots.filter((snapshot) => snapshot.available).length;
  const [cells, setCells] = useState<TranscriptCell[]>(() => [welcomeCell(cwd, config, snapshots)]);
  const [buffer, setBuffer] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const idRef = useRef(0);
  const nextId = useCallback(() => `c${idRef.current++}`, []);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const startedAtRef = useRef(0);

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
          setRow(event.providerId, event.role, { state: "running" });
        } else if (event.type === "provider/done") {
          const count = event.result.findings.length;
          const note =
            event.result.status === "ok" ? `${count} finding${count === 1 ? "" : "s"}` : event.result.status;
          setRow(event.providerId, event.role, { state: "done", note });
        }
      };
      const controller = new AbortController();
      abortRef.current = controller;
      return runCouncil(request, current, { onEvent, signal: controller.signal });
    },
    []
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
      if (!trimmed) return;
      emit({ id: nextId(), kind: "text", text: `› ${trimmed}` });
      dispatch({ type: "recordInput", input: trimmed });
      if (trimmed === "/exit" || trimmed === "/quit" || trimmed === "/q") {
        exit();
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
        abortRef.current = null;
      }
    },
    [ctx, emit, exit, nextId]
  );

  const paletteOpen = PALETTE_TOKEN.test(buffer);
  const query = paletteOpen ? buffer.slice(1) : "";
  const matches = useMemo(() => (paletteOpen ? matchCommands(query) : []), [paletteOpen, query]);
  const clampedSelected = matches.length > 0 ? Math.min(selected, matches.length - 1) : 0;

  // Ink debounces a lone ESC (to disambiguate from escape sequences), so a raw
  // listener clears the composer immediately. It only acts on ESC; every other
  // key still flows through useInput below.
  useEffect(() => {
    if (!stdin) return;
    const onData = (chunk: Buffer | string) => {
      if (String(chunk) === String.fromCharCode(27)) {
        setBuffer("");
        setSelected(0);
      }
    };
    stdin.on("data", onData);
    return () => {
      stdin.off("data", onData);
    };
  }, [stdin]);

  useInput((char, key) => {
    if (key.escape && busy) {
      abortRef.current?.abort();
      return;
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
        void submit(`/${matches[clampedSelected].name}`);
        return;
      }
    }
    if (key.escape || char === "\u001B") {
      setBuffer("");
      setSelected(0);
      return;
    }
    if (key.ctrl && char === "c") {
      if (buffer.length > 0) {
        setBuffer("");
        setSelected(0);
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
      setBuffer((prev) => prev + char);
      setSelected(0);
    }
  });

  const g = glyphs();
  const providerLabel =
    state.activeProviders?.length === 0
      ? "heuristic"
      : state.activeProviders?.join("+") ?? "config";
  const diffLabel = state.diffLabel ?? "no diff";
  const degraded = Boolean(state.lastReport?.metadata.degraded);

  const startedAt = startedAtRef.current || Date.now();
  return (
    <Box flexDirection="column">
      <Static items={cells}>{(cell) => <TranscriptItem key={cell.id} cell={cell} />}</Static>
      <Box flexDirection="column" marginTop={1}>
        {busy ? (
          progress && progress.rows.length > 0 ? (
            <RunningCard rows={progress.rows} label={progress.label} startedAt={startedAt} />
          ) : (
            <Text>
              <Spinner />
              <BusyLabel since={startedAt} />
              <Text dimColor>{` ${g.separator} convening the council ${g.separator} `}</Text>
              <Elapsed since={startedAt} />
              <Text dimColor>{` ${g.separator} esc to interrupt`}</Text>
            </Text>
          )
        ) : (
          <StatusLine
            mode={state.mode}
            providerLabel={providerLabel}
            available={availableCount}
            diffLabel={diffLabel}
            degraded={degraded}
            lastReport={state.lastReport}
          />
        )}
        <Box borderStyle="round" borderColor={paletteOpen ? PALETTE.command : PALETTE.dim} paddingX={1}>
          <Text>
            <Text color={PALETTE.command} bold>{"› "}</Text>
            <Text>{buffer}</Text>
            <Cursor />
            {buffer.length === 0 ? <Text dimColor> type a message, or /command</Text> : null}
          </Text>
        </Box>
        {paletteOpen ? (
          <SlashPalette matches={matches} selectedIndex={clampedSelected} />
        ) : busy ? null : (
          <Text dimColor>{`  Enter send ${g.separator} / commands ${g.separator} ctrl+c quit`}</Text>
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
        />
      );
    case "diff":
      return <DiffCard label={cell.label} diff={cell.diff} />;
    case "text":
      return <Text>{cell.text}</Text>;
    case "markdown":
      return <Text>{cell.markdown}</Text>;
    case "findings":
      return <VerdictReport report={cell.report} />;
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
    default:
      return <Text> </Text>;
  }
}

interface StatusLineProps {
  mode: CouncilMode;
  providerLabel: string;
  available: number;
  diffLabel: string;
  degraded: boolean;
  lastReport?: CouncilReport;
}

/** The idle status line: mode · providers available · diff · last verdict gavel. */
function StatusLine(props: StatusLineProps): React.ReactElement {
  const g = glyphs();
  const { mode, providerLabel, available, diffLabel, degraded } = props;
  const verdict = props.lastReport?.verdict;
  const verdictColor = degraded ? PALETTE.degraded : verdict ? VERDICT_COLOR[verdict] ?? "white" : "white";
  return (
    <Text dimColor>
      <Text>{`${g.mode} `}</Text>
      <Text color={PALETTE.command}>{mode}</Text>
      <Text>{`   ${g.provider} ${providerLabel}`}</Text>
      <Text>{` (${available} avail)`}</Text>
      <Text>{`   ${g.diff} ${diffLabel}`}</Text>
      {degraded ? <Text color={PALETTE.degraded}>{`   ${g.warn} degraded`}</Text> : null}
      {verdict ? (
        <Text color={verdictColor}>{`   ${g.verdict[verdict]} ${verdict.toUpperCase()}`}</Text>
      ) : null}
    </Text>
  );
}
