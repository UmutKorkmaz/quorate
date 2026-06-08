import {
  buildPlannedLanes,
  detectAvailableProviders,
  findConfigPath,
  formatSpawnArgv,
  glyphs,
  type QuorateConfig,
  type CouncilMode,
  type CouncilReport,
  type CouncilRequest
} from "@quorate/core";
import { projectMemoryInspectLines, type ProjectMemory } from "./project-memory.js";

export interface ShellState {
  cwd: string;
  config: QuorateConfig;
  mode: CouncilMode;
  projectMemory?: ProjectMemory;
  diff?: string;
  diffLabel?: string;
  activeProviders?: string[];
  activeRoles?: string[];
  lastRequest?: {
    mode: CouncilMode;
    subject: string;
    diff?: string;
  };
  lastReport?: CouncilReport;
  transcript: Array<{
    input: string;
    output: string;
    timestamp: string;
  }>;
}

export interface SessionState {
  cwd: string;
  config: QuorateConfig;
  mode: CouncilMode;
  heuristicOnly?: boolean;
  projectMemory?: ProjectMemory;
  diff?: string;
  diffLabel?: string;
  activeProviders?: string[];
  activeRoles?: string[];
  /** Session-only role→provider routing overrides. Threaded into effectiveConfig
   *  via withRouteOverrides; deliberately never persisted to disk. */
  roleOverrides?: Record<string, string[]>;
  lastRequest?: CouncilRequest;
  lastReport?: CouncilReport;
  transcript?: Array<{ input: string; at: string }>;
  sessionId?: string;
  sessionName?: string;
}

export interface ProviderSnapshot {
  id: string;
  active: boolean;
  available: boolean;
  runnable: boolean;
  command?: string;
  path?: string;
  installHint?: string;
}

export function splitList(inputText: string): string[] {
  return inputText
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Classic Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The single closest candidate to `input`, or undefined if nothing is near
 * enough to be a likely typo. The distance threshold scales with input length
 * (2 for short tokens, 3 otherwise) so unrelated words never produce a
 * misleading "did you mean".
 */
export function closestMatch(input: string, candidates: Iterable<string>): string | undefined {
  const threshold = input.length <= 4 ? 2 : 3;
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = levenshtein(input.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best !== undefined && bestDistance <= threshold ? best : undefined;
}

/**
 * A `. Did you mean "x"?` suffix for the first unknown token when a close
 * candidate exists, otherwise an empty string. Appended to an existing
 * "Unknown …" message so callers (and their pinned-substring tests) keep the
 * original prefix intact.
 */
export function suggestionSuffix(unknown: string[], candidates: Iterable<string>): string {
  if (unknown.length === 0) return "";
  const match = closestMatch(unknown[0], candidates);
  return match ? `. Did you mean "${match}"?` : "";
}

/**
 * Split free-form arguments on whitespace (distinct from {@link splitList},
 * which splits on commas). Shared by both the classic shell and the Ink TUI.
 */
export function splitWords(inputText: string): string[] {
  return inputText.trim().split(/\s+/).filter(Boolean);
}

/**
 * The subset of session/shell state needed to render the `/status` text.
 * Both {@link ShellState} and the TUI `SessionState` satisfy this shape.
 */
export interface StatusStateLike {
  cwd: string;
  mode: CouncilMode;
  heuristicOnly?: boolean;
  diff?: string;
  diffLabel?: string;
  activeProviders?: string[];
  activeRoles?: string[];
  lastReport?: CouncilReport;
}

export function statusText(state: StatusStateLike): string {
  const g = glyphs();
  const providerText =
    state.heuristicOnly || state.activeProviders?.length === 0
      ? "heuristic fallback"
      : state.activeProviders?.join(", ") ?? "config defaults";
  const modeText = state.heuristicOnly ? "heuristic-only" : state.mode;
  const roleText = state.activeRoles?.join(", ") ?? "config defaults";
  const configPath = findConfigPath(state.cwd);
  const diffLoaded = Boolean(state.diffLabel ?? state.diff);
  const lastReport = state.lastReport
    ? `${state.lastReport.verdict} (${state.lastReport.findings.length} findings)`
    : "none";

  return [
    `Mode: ${modeText}`,
    `Cwd: ${state.cwd}`,
    `Config: ${configPath ?? "built-in defaults (run quorate init)"}`,
    `Diff: ${state.diffLabel ?? (diffLoaded ? "loaded" : "not loaded")}`,
    `Providers: ${providerText}`,
    `Roles: ${roleText}`,
    `Last report: ${lastReport}`,
    `Tip: /inspect for spawn status ${g.separator} /doctor for readiness ${g.separator} /setup to get started`
  ].join("\n");
}

function providerSpawnStatus(snapshot: ProviderSnapshot): string {
  if (snapshot.id === "heuristic") return "built-in (always available)";
  if (!snapshot.available) return `not on PATH${snapshot.installHint ? ` — install ${snapshot.installHint}` : ""}`;
  if (snapshot.runnable) return `spawnable${snapshot.path ? ` (${snapshot.path})` : ""}`;
  return "needs headless profile — enable args in .quorate.yml (see .quorate.example.yml)";
}

/**
 * Session diagnostics for `/inspect`: config path, active agents, roles, diff
 * label, and per-provider spawn readiness for the current session.
 */
export function inspectText(state: ShellState): string {
  const g = glyphs();
  const snapshots = providerSnapshots(state);
  const activeIds =
    state.activeProviders !== undefined
      ? state.activeProviders
      : configuredActiveProviders(state);
  const providerText =
    activeIds.length === 0 ? "heuristic fallback" : activeIds.join(", ");
  const roleText = state.activeRoles?.join(", ") ?? `config defaults (${state.config.councils.join(", ")})`;
  const configPath = findConfigPath(state.cwd) ?? "built-in defaults (run quorate init)";
  const activeSnapshots = snapshots.filter((snapshot) => snapshot.active);

  const spawnLines =
    activeSnapshots.length > 0
      ? activeSnapshots.map(
          (snapshot) => `  ${snapshot.id.padEnd(12)} ${providerSpawnStatus(snapshot)}`
        )
      : ["  (no active agents — council will use heuristic fallback)"];

  return [
    `Inspect ${g.separator} session diagnostics`,
    ...projectMemoryInspectLines(state.projectMemory),
    "",
    `Config: ${configPath}`,
    `Cwd: ${state.cwd}`,
    `Mode: ${state.mode}`,
    `Diff: ${state.diffLabel ?? "not loaded"}`,
    `Active agents: ${providerText}`,
    `Roles: ${roleText}`,
    "",
    "Provider spawn status:",
    ...spawnLines
  ].join("\n");
}

function needsProfileSnippet(provider: QuorateConfig["providers"][number]): string {
  const lines = [`  - id: ${provider.id}`, "    enabled: true"];
  if (provider.args && provider.args.length > 0) {
    lines.push("    args:");
    for (const arg of provider.args) {
      lines.push(`      - ${JSON.stringify(arg)}`);
    }
  } else {
    lines.push("    # copy headless args from .quorate.example.yml");
  }
  return lines.join("\n");
}

/**
 * Guided setup copy for `/setup`: agent checks, install hints, needs-profile
 * snippets, and the recommended /git → /use → /review flow.
 */
export function setupText(state: ShellState): string {
  const g = glyphs();
  const snapshots = providerSnapshots(state);
  const configPath = findConfigPath(state.cwd);
  const runnable = snapshots.filter((snapshot) => snapshot.runnable && snapshot.id !== "heuristic");
  const missing = snapshots.filter((snapshot) => snapshot.id !== "heuristic" && !snapshot.available);
  const needsProfile = snapshots.filter(
    (snapshot) => snapshot.id !== "heuristic" && snapshot.available && !snapshot.runnable
  );

  const lines = [
    `Setup wizard ${g.separator} get your council ready`,
    "",
    "1. Config",
    configPath
      ? `   ${g.check} ${configPath}`
      : `   ${g.warn} no .quorate.yml — run quorate init or copy .quorate.example.yml`,
    "",
    "2. Agents"
  ];

  if (runnable.length > 0) {
    lines.push(`   ${g.check} ${runnable.length} runnable reviewer${runnable.length === 1 ? "" : "s"}: ${runnable.map((row) => row.id).join(", ")}`);
  } else {
    lines.push(`   ${g.warn} no runnable reviewers yet — reviews stay heuristic-only (DEGRADED)`);
  }

  if (missing.length > 0) {
    lines.push("", "   Install hints:");
    for (const snapshot of missing) {
      lines.push(
        `   ${g.cross} ${snapshot.id}${snapshot.installHint ? ` — ${snapshot.installHint}` : ""}`
      );
    }
  }

  if (needsProfile.length > 0) {
    lines.push("", "   Needs-profile snippets (paste into .quorate.yml):");
    for (const snapshot of needsProfile) {
      const provider = state.config.providers.find((candidate) => candidate.id === snapshot.id);
      if (!provider) continue;
      lines.push(`   # ${snapshot.id} is on PATH but disabled — enable a headless profile:`);
      lines.push(needsProfileSnippet(provider));
      lines.push("");
    }
  }

  lines.push(
    "3. Guided flow",
    "   /git                  load git working tree (or /git main HEAD)",
    "   /use available        enable every runnable agent for this session",
    "   /review               convene the council on the loaded diff",
    "",
    "   /doctor               full readiness verdict",
    "   /inspect              session + spawn status"
  );

  return lines.join("\n");
}

/**
 * Shared help text for both shells. `extra` lines (e.g. `/reset`) are appended
 * right before the trailing blank line + bare-text note so each surface can add
 * the aliases it actually exposes.
 */
export function shellHelp(extra: string[] = []): string {
  return [
    "Quorate shell commands:",
    "  /help                 Show this help",
    "  /providers            List providers and local availability",
    "  /doctor               Council readiness verdict (environment + providers)",
    "  /inspect              Config path, agents, roles, spawn status",
    "  /setup                Guided setup wizard (/git → /use → /review)",
    "  /status               Show current session state",
    "  /use ids              Enable providers (default, available, heuristic, or ids)",
    "  /enable ids           Add providers to the active session set",
    "  /disable ids          Remove providers from the active session set",
    "  /roles ids            Limit council roles, comma-separated",
    "  /mode review|plan     Set how bare text is interpreted",
    "  /diff path            Load a unified diff file",
    "  /git [base] [head]    Load git diff from the current repo",
    "  /pr number            Load a pull request diff with gh",
    "  /review [subject]     Review the loaded/current diff",
    "  /plan text            Ask the council to evaluate a plan",
    "  /last                 Show the last report",
    "  /rerun                Run the last request again",
    "  /history              Show recent shell commands",
    "  /json path            Save the last report as JSON",
    "  /markdown path        Save the last report as Markdown",
    "  /clear                Clear loaded diff and last report",
    ...extra,
    "  /exit                 Leave the shell",
    "",
    "Bare text runs /review in review mode and /plan in plan mode."
  ].join("\n");
}

export function validateProviderSelection(config: QuorateConfig, providers?: string): string[] {
  if (!providers) return [];
  const allowed = new Set(config.providers.map((provider) => provider.id));
  return splitList(providers).filter((provider) => !allowed.has(provider));
}

export function withProviderSelection(config: QuorateConfig, providerIds?: string[]): QuorateConfig {
  if (providerIds === undefined) return config;
  const selected = new Set(providerIds);

  return {
    ...config,
    providers: config.providers.map((provider) => ({
      ...provider,
      enabled: selected.has(provider.id)
    }))
  };
}

export function withRoleSelection(config: QuorateConfig, roleIds?: string[]): QuorateConfig {
  if (!roleIds || roleIds.length === 0) return config;
  const selected = new Set(roleIds);

  return {
    ...config,
    providers: config.providers.map((provider) => ({
      ...provider,
      enabled:
        provider.roles && provider.roles.length > 0
          ? provider.enabled !== false && provider.roles.some((role) => selected.has(role))
          : provider.enabled,
      roles:
        provider.roles && provider.roles.length > 0
          ? provider.roles.filter((role) => selected.has(role))
          : roleIds
    })),
    councils: config.councils.filter((role) => selected.has(role))
  };
}

/**
 * Apply session-only role→provider routing overrides. For each overridden role,
 * the providers that should now cover it are taken from the override map; every
 * other provider drops that role. Both `roles` and `enabled` are rewritten so
 * buildPlannedLanes (which only reads ENABLED providers) picks up a routed-in
 * provider with no engine change. Immutable: returns new objects throughout.
 */
export function withRouteOverrides(
  config: QuorateConfig,
  roleOverrides?: Record<string, string[]>
): QuorateConfig {
  if (!roleOverrides || Object.keys(roleOverrides).length === 0) return config;
  const overriddenRoles = new Set(Object.keys(roleOverrides));
  // providerId -> set of overridden roles it should now cover
  const wanted = new Map<string, Set<string>>();
  for (const [role, ids] of Object.entries(roleOverrides)) {
    for (const id of ids) {
      const set = wanted.get(id) ?? new Set<string>();
      set.add(role);
      wanted.set(id, set);
    }
  }
  const providers = config.providers.map((provider) => {
    const base =
      provider.roles && provider.roles.length > 0
        ? provider.roles
        : [config.councils[0] ?? "maintainer"];
    // Drop any overridden role this provider is NOT explicitly assigned.
    const kept = base.filter(
      (role) => !overriddenRoles.has(role) || (wanted.get(provider.id)?.has(role) ?? false)
    );
    // Add overridden roles this provider IS now assigned.
    const added = [...(wanted.get(provider.id) ?? [])].filter((role) => !kept.includes(role));
    const roles = [...kept, ...added];
    return { ...provider, roles, enabled: provider.enabled !== false && roles.length > 0 };
  });
  return { ...config, providers };
}

export function isRunnableProvider(
  provider: QuorateConfig["providers"][number],
  available = true
): boolean {
  return provider.type === "mock" || (available && (provider.args?.length ?? 0) > 0 && Boolean(provider.inputMode));
}

export function availableProviderIds(
  state: ShellState,
  detected = detectAvailableProviders()
): string[] {
  const available = new Map(detected.map((provider) => [provider.id, provider.available]));
  return state.config.providers
    .filter((provider) =>
      isRunnableProvider(provider, provider.type === "mock" ? true : available.get(provider.id) ?? false)
    )
    .map((provider) => provider.id);
}

export function resolveUseProviders(
  state: ShellState,
  requested: string[],
  detected = detectAvailableProviders()
): string[] | undefined {
  if (requested.length === 0 || requested.includes("default")) return undefined;
  if (requested.includes("available")) return availableProviderIds(state, detected);
  return requested;
}

/** Brief per-provider argv summary emitted before a council run. */
export function spawnPreviewText(config: QuorateConfig, request: CouncilRequest): string | undefined {
  const lanes = buildPlannedLanes(config).filter(
    (lane) => lane.provider.type === "cli" && lane.provider.id !== "heuristic"
  );
  if (lanes.length === 0) return undefined;

  const lines = lanes.map(
    (lane) => `  ${lane.provider.id} [${lane.role}]: ${formatSpawnArgv(lane.provider, lane.role, request)}`
  );
  return ["Spawn preview:", ...lines].join("\n");
}

export function providerRunPreflight(
  config: QuorateConfig,
  detected = detectAvailableProviders()
): string[] {
  const available = new Map(detected.map((provider) => [provider.id, provider.available]));
  return config.providers
    .filter((provider) => provider.enabled !== false)
    .flatMap((provider) => {
      if (provider.type === "mock") return [];
      if (!available.get(provider.id)) return [`${provider.id} is not available on PATH.`];
      if (!isRunnableProvider(provider, true)) return [`${provider.id} has no runnable headless profile.`];
      return [];
    });
}

export function providerSnapshots(state: ShellState): ProviderSnapshot[] {
  const detected = detectAvailableProviders();
  const detectedById = new Map(detected.map((provider) => [provider.id, provider]));

  return state.config.providers.map((provider) => {
    const isActive = state.activeProviders
      ? state.activeProviders.includes(provider.id)
      : provider.enabled !== false;
    const detectedProvider = detectedById.get(provider.id);
    const available = provider.type === "mock" ? true : detectedProvider?.available ?? false;
    const runnable = isRunnableProvider(provider, available);

    return {
      id: provider.id,
      active: isActive,
      available,
      runnable,
      command: provider.command,
      path: detectedProvider?.path,
      installHint: provider.installHint
    };
  });
}

export function configuredActiveProviders(state: ShellState): string[] {
  return state.config.providers
    .filter((provider) => provider.enabled !== false)
    .map((provider) => provider.id);
}

/**
 * The pseudo-provider id used for accounting when no provider is config-enabled.
 * Derived from the config's enabled mock provider (the built-in heuristic)
 * rather than a hard-coded literal, so it tracks the real provider id.
 */
export function fallbackProviderId(state: ShellState): string {
  const mock = state.config.providers.find((provider) => provider.type === "mock");
  return mock?.id ?? "heuristic";
}

export function activeProviderSet(state: ShellState): Set<string> {
  if (state.activeProviders) return new Set(state.activeProviders);
  const configured = configuredActiveProviders(state);
  return new Set(configured.length > 0 ? configured : [fallbackProviderId(state)]);
}
