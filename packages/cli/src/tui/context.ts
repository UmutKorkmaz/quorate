import type {
  QuorateConfig,
  CouncilMode,
  CouncilReport,
  CouncilRequest
} from "@quorate/core";
import { splitList, type ProviderSnapshot, type SessionState } from "../session.js";

export type { SessionState };

export type TranscriptCell = { id: string } & (
  | { kind: "text"; text: string }
  | { kind: "markdown"; markdown: string }
  | { kind: "findings"; report: CouncilReport }
  | { kind: "providerStatus"; rows: ProviderSnapshot[] }
);

export type SessionAction =
  | { type: "setMode"; mode: CouncilMode }
  | { type: "setProviders"; providers: string[] | undefined }
  | { type: "setRoles"; roles: string[] | undefined }
  | { type: "setDiff"; diff: string | undefined; diffLabel: string | undefined }
  | { type: "setLastRequest"; request: CouncilRequest | undefined }
  | { type: "setLastReport"; report: CouncilReport | undefined }
  | { type: "recordInput"; input: string }
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
}): SessionState {
  return {
    cwd: options.cwd,
    config: options.config,
    mode: options.mode ?? "review",
    activeProviders: options.providers ? splitList(options.providers) : undefined
  };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "setMode":
      return { ...state, mode: action.mode };
    case "setProviders":
      return { ...state, activeProviders: action.providers };
    case "setRoles":
      return { ...state, activeRoles: action.roles };
    case "setDiff":
      return { ...state, diff: action.diff, diffLabel: action.diffLabel };
    case "setLastRequest":
      return { ...state, lastRequest: action.request };
    case "setLastReport":
      return { ...state, lastReport: action.report };
    case "recordInput":
      return {
        ...state,
        transcript: [...(state.transcript ?? []), { input: action.input, at: new Date().toISOString() }]
      };
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
