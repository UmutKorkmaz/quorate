import type {
  QuorateConfig,
  CouncilMode,
  CouncilReport,
  CouncilRequest,
  ProviderConfig,
  ProviderResult
} from "@quorate/core";
import {
  activeProviderSet,
  fallbackProviderId,
  splitList,
  type ProviderSnapshot,
  type SessionState,
  type ShellState
} from "../session.js";
import { applyPersistedSession, type PersistedSession } from "../sessions.js";
import { applyProjectMemoryDefaults, loadProjectMemory } from "../project-memory.js";

export type { SessionState };

export type TranscriptCell = { id: string } & (
  | { kind: "text"; text: string }
  | { kind: "markdown"; markdown: string }
  | { kind: "findings"; report: CouncilReport }
  | { kind: "providerStatus"; rows: ProviderSnapshot[] }
  | { kind: "diff"; label: string; diff: string }
  | { kind: "help" }
  | { kind: "skills"; roles: Array<{ role: string; providers: string[] }> }
  | { kind: "plugins"; items: Array<{ id: string; name: string; status: string; roles: string[] }> }
  | { kind: "providerDetail"; provider: ProviderConfig; available: boolean; enabled: boolean }
  | { kind: "settings"; config: QuorateConfig }
  | { kind: "theme" }
  | { kind: "logs"; variant: "overview"; lanes: ProviderResult[] }
  | { kind: "logs"; variant: "detail"; result: ProviderResult }
  | { kind: "route"; rows: Array<{ role: string; providers: string[]; overridden: boolean }> }
  | {
      kind: "welcome";
      version: string;
      cwd: string;
      available: number;
      detected: string[];
      totalAgents: number;
      councils: string[];
      firstRun: boolean;
      projectDefaultsLine?: string;
      sessionRecap?: string;
      active?: string[];
    }
);

function asShellState(state: SessionState): ShellState {
  return {
    cwd: state.cwd,
    config: state.config,
    mode: state.mode,
    projectMemory: state.projectMemory,
    diff: state.diff,
    diffLabel: state.diffLabel,
    activeProviders: state.activeProviders,
    activeRoles: state.activeRoles,
    transcript: []
  };
}

/** Resolved provider ids that will run on the next council convene. */
export function resolveActiveAgents(state: SessionState): string[] {
  return [...activeProviderSet(asShellState(state))];
}

export function formatActiveAgentLabel(state: SessionState): string {
  return resolveActiveAgents(state).join("+");
}

export function isHeuristicOnly(state: SessionState): boolean {
  if (state.heuristicOnly || state.activeProviders?.length === 0) return true;
  const agents = resolveActiveAgents(state);
  const heuristic = fallbackProviderId(asShellState(state));
  return agents.length === 1 && agents[0] === heuristic;
}

export interface SessionUxHints {
  detectedCount: number;
  hasDiff: boolean;
  heuristicOnly: boolean;
  beforeFirstReview: boolean;
}

export function sessionUxHints(state: SessionState, detectedCount: number): SessionUxHints {
  return {
    detectedCount,
    hasDiff: Boolean(state.diffLabel),
    heuristicOnly: isHeuristicOnly(state),
    beforeFirstReview: !state.lastReport
  };
}

export function composerPlaceholder(state: SessionState, hints: SessionUxHints): string {
  if (state.mode === "plan") {
    return " describe your plan, or /command";
  }
  if (!hints.hasDiff) {
    return " type a message, or /command";
  }
  if (hints.heuristicOnly) {
    return " subject or /review — /use available for full council";
  }
  return " subject or /review, or /command";
}

export function idleFooterHint(state: SessionState, hints: SessionUxHints, separator: string): string {
  const parts = ["Enter send", "/ commands", "! shell", "ctrl+c quit"];
  if (hints.heuristicOnly && hints.beforeFirstReview) {
    parts.push("heuristic only → /use available");
  } else if (!hints.hasDiff && state.mode === "review") {
    parts.push("/git load diff");
  } else if (hints.hasDiff && hints.beforeFirstReview) {
    parts.push("/review convene");
  }
  return `  ${parts.join(` ${separator} `)}`;
}

export function statusHeuristicHint(hints: SessionUxHints): string | undefined {
  if (hints.heuristicOnly && hints.beforeFirstReview) {
    return "heuristic only → /use available";
  }
  return undefined;
}

export function inputHistory(state: SessionState): string[] {
  return (state.transcript ?? []).map((entry) => entry.input);
}

export function recallHistoryInput(
  history: string[],
  currentIndex: number | null,
  direction: "up" | "down"
): { index: number | null; value: string } {
  if (history.length === 0) {
    return { index: null, value: "" };
  }
  if (direction === "up") {
    const nextIndex = currentIndex === null ? history.length - 1 : Math.max(0, currentIndex - 1);
    return { index: nextIndex, value: history[nextIndex] ?? "" };
  }
  if (currentIndex === null) {
    return { index: null, value: "" };
  }
  if (currentIndex >= history.length - 1) {
    return { index: null, value: "" };
  }
  const nextIndex = currentIndex + 1;
  return { index: nextIndex, value: history[nextIndex] ?? "" };
}

export type SessionAction =
  | { type: "setMode"; mode: CouncilMode }
  | { type: "setProviders"; providers: string[] | undefined }
  | { type: "setRoles"; roles: string[] | undefined }
  | { type: "setHeuristicOnly"; heuristicOnly: boolean }
  | { type: "setDiff"; diff: string | undefined; diffLabel: string | undefined }
  | { type: "setLastRequest"; request: CouncilRequest | undefined }
  | { type: "setLastReport"; report: CouncilReport | undefined }
  | { type: "setRoute"; role: string; providers: string[] }
  | { type: "clearRoute"; role?: string }
  | { type: "setProviderModel"; providerId: string; model: string }
  | { type: "recordInput"; input: string }
  | { type: "setSessionMeta"; id: string; name: string }
  | { type: "clear" };

export interface ShellContext {
  getState(): Readonly<SessionState>;
  dispatch(action: SessionAction): void;
  emit(cell: TranscriptCell): void;
  runReview(request: CouncilRequest): Promise<CouncilReport>;
}

export function createInitialSessionState(options: {
  cwd: string;
  config: QuorateConfig;
  providers?: string;
  mode?: CouncilMode;
  restoredSession?: PersistedSession;
}): SessionState {
  const restored = options.restoredSession ? applyPersistedSession(options.restoredSession) : {};
  const projectMemory = loadProjectMemory(options.cwd);
  const base: SessionState = {
    cwd: options.cwd,
    config: options.config,
    mode: options.mode ?? restored.mode ?? "review",
    projectMemory,
    activeProviders: options.providers
      ? splitList(options.providers)
      : restored.activeProviders,
    activeRoles: restored.activeRoles,
    diffLabel: restored.diffLabel,
    transcript: restored.transcript,
    sessionId: restored.sessionId,
    sessionName: restored.sessionName
  };
  return applyProjectMemoryDefaults(base, projectMemory, {
    providersFromCli: Boolean(options.providers)
  });
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "setMode":
      return { ...state, mode: action.mode };
    case "setProviders":
      return { ...state, activeProviders: action.providers };
    case "setRoles":
      return { ...state, activeRoles: action.roles };
    case "setHeuristicOnly":
      return {
        ...state,
        heuristicOnly: action.heuristicOnly,
        activeProviders: action.heuristicOnly ? [] : undefined
      };
    case "setDiff":
      return { ...state, diff: action.diff, diffLabel: action.diffLabel };
    case "setLastRequest":
      return { ...state, lastRequest: action.request };
    case "setLastReport":
      return { ...state, lastReport: action.report };
    case "setRoute":
      return {
        ...state,
        roleOverrides: { ...(state.roleOverrides ?? {}), [action.role]: action.providers }
      };
    case "clearRoute": {
      if (!action.role) return { ...state, roleOverrides: undefined };
      if (!state.roleOverrides) return state;
      const rest = { ...state.roleOverrides };
      delete rest[action.role];
      return { ...state, roleOverrides: Object.keys(rest).length ? rest : undefined };
    }
    case "setProviderModel":
      return {
        ...state,
        config: {
          ...state.config,
          providers: state.config.providers.map((provider) =>
            provider.id === action.providerId ? { ...provider, model: action.model } : provider
          )
        }
      };
    case "recordInput":
      return {
        ...state,
        transcript: [...(state.transcript ?? []), { input: action.input, at: new Date().toISOString() }]
      };
    case "setSessionMeta":
      return { ...state, sessionId: action.id, sessionName: action.name };
    case "clear":
      return {
        ...state,
        diff: undefined,
        diffLabel: undefined,
        lastReport: undefined,
        lastRequest: undefined
      };
    default:
      return state;
  }
}
