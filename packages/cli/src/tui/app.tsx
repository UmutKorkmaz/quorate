import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdin } from "ink";
import {
  runCouncil,
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
import { withProviderSelection, withRoleSelection, providerRunPreflight } from "../session.js";
import { commandRegistry, parseAndRun, type SlashCommand } from "./commands.js";
import { SlashPalette } from "./SlashPalette.js";

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

function matchCommands(query: string): SlashCommand[] {
  return commandRegistry.filter(
    (command) =>
      command.name.startsWith(query) || (command.aliases ?? []).some((alias) => alias.startsWith(query))
  );
}

export function App({ cwd, config, mode, providers }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdin } = useStdin();
  const [state, dispatch] = useReducer(sessionReducer, undefined, () =>
    createInitialSessionState({ cwd, config, providers, mode })
  );
  const [cells, setCells] = useState<TranscriptCell[]>([]);
  const [buffer, setBuffer] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const idRef = useRef(0);
  const nextId = useCallback(() => `c${idRef.current++}`, []);

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
        const message = `Provider preflight failed:\n${errors.map((error) => `- ${error}`).join("\n")}`;
        emit({ id: nextId(), kind: "text", text: message });
        throw new Error(message);
      }
      const onEvent = (event: CouncilEvent): void => {
        if (event.type === "provider/done") {
          emit({
            id: nextId(),
            kind: "text",
            text: `${event.role} · ${event.providerId} · ${event.result.status}`
          });
        }
      };
      return runCouncil(request, current, { onEvent });
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
      if (!trimmed) return;
      emit({ id: nextId(), kind: "text", text: `› ${trimmed}` });
      if (trimmed === "/exit" || trimmed === "/quit" || trimmed === "/q") {
        exit();
        return;
      }
      setBusy(true);
      try {
        await parseAndRun(ctx, trimmed);
      } catch {
        // preflight / run errors already emitted a cell; keep the shell alive.
      } finally {
        setBusy(false);
      }
    },
    [ctx, emit, exit, nextId]
  );

  const paletteOpen = PALETTE_TOKEN.test(buffer);
  const query = paletteOpen ? buffer.slice(1) : "";
  const matches = useMemo(() => (paletteOpen ? matchCommands(query) : []), [paletteOpen, query]);
  const clampedSelected = matches.length > 0 ? Math.min(selected, matches.length - 1) : 0;

  useEffect(() => {
    if (!stdin) return;
    const onData = (chunk: Buffer | string) => {
      if (String(chunk) === "\u001B") {
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

  const providerLabel =
    state.activeProviders?.length === 0
      ? "heuristic"
      : state.activeProviders?.join("+") ?? "config";
  const diffLabel = state.diffLabel ?? "no diff";
  const degraded = state.lastReport?.metadata.degraded ? " · ⚠ degraded" : "";

  return (
    <Box flexDirection="column">
      <Static items={cells}>{(cell) => <TranscriptItem key={cell.id} cell={cell} />}</Static>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          {`${busy ? "running…" : "ready"} · ${state.mode} · ${providerLabel} · ${diffLabel}${degraded}`}
        </Text>
        <Box borderStyle="round" borderColor={paletteOpen ? "cyan" : "gray"} paddingX={1}>
          <Text>
            {"› "}
            <Text>{buffer}</Text>
            <Text inverse> </Text>
            {buffer.length === 0 ? <Text dimColor> type a message, or /command</Text> : null}
          </Text>
        </Box>
        {paletteOpen ? <SlashPalette matches={matches} selectedIndex={clampedSelected} /> : null}
      </Box>
    </Box>
  );
}

const VERDICT_COLOR: Record<string, string> = { pass: "green", warn: "yellow", fail: "red" };
const SEVERITY_COLOR: Record<string, string> = {
  critical: "red",
  high: "red",
  medium: "yellow",
  low: "blue",
  info: "gray"
};

function FindingsView({ report }: { report: CouncilReport }): React.ReactElement {
  const verdictColor = VERDICT_COLOR[report.verdict] ?? "white";
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text backgroundColor={verdictColor} color="black" bold>
          {` ${report.verdict.toUpperCase()} `}
        </Text>
        <Text>{` ${report.summary}`}</Text>
      </Box>
      {report.findings.length === 0 ? (
        <Text dimColor>{"  No findings."}</Text>
      ) : (
        report.findings.map((finding, index) => {
          const severityColor = SEVERITY_COLOR[finding.severity] ?? "white";
          const location = finding.file
            ? finding.line
              ? `${finding.file}:${finding.line}`
              : finding.file
            : "";
          return (
            <Box key={index} flexDirection="column" marginTop={1}>
              <Text>
                <Text color={severityColor} bold>
                  {finding.severity.toUpperCase()}
                </Text>
                <Text bold>{`  ${finding.title}`}</Text>
                {location ? <Text dimColor>{`  ${location}`}</Text> : null}
              </Text>
              <Text dimColor>{`    ${finding.body}`}</Text>
            </Box>
          );
        })
      )}
      <Box marginTop={1} flexDirection="column">
        {report.providerResults.map((result, index) => (
          <Text key={index} dimColor>
            {`  ${result.providerId} · ${result.role} · ${result.status}`}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function TranscriptItem({ cell }: { cell: TranscriptCell }): React.ReactElement {
  switch (cell.kind) {
    case "text":
      return <Text>{cell.text}</Text>;
    case "markdown":
      return <Text>{cell.markdown}</Text>;
    case "findings":
      return <FindingsView report={cell.report} />;
    case "providerStatus":
      return (
        <Box flexDirection="column">
          {cell.rows.map((row) => (
            <Text key={row.id}>
              <Text color={row.active ? "cyan" : undefined}>{row.active ? "● " : "  "}</Text>
              <Text bold={row.active}>{row.id.padEnd(10)}</Text>
              <Text color={row.available ? "green" : "red"}>
                {` ${row.available ? "available" : "missing"}`}
              </Text>
              <Text dimColor>{`  ${row.runnable ? "runnable" : "needs-profile"}`}</Text>
            </Text>
          ))}
        </Box>
      );
    default:
      return <Text> </Text>;
  }
}
