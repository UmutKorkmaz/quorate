import {
  detectAvailableProviders,
  type QuorateConfig,
  type CouncilMode,
  type CouncilReport,
  type CouncilRequest
} from "@quorate/core";

export interface ShellState {
  cwd: string;
  config: QuorateConfig;
  mode: CouncilMode;
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
  diff?: string;
  diffLabel?: string;
  activeProviders?: string[];
  activeRoles?: string[];
  lastRequest?: CouncilRequest;
  lastReport?: CouncilReport;
  transcript?: Array<{ input: string; at: string }>;
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
  diffLabel?: string;
  activeProviders?: string[];
  activeRoles?: string[];
  lastReport?: CouncilReport;
}

export function statusText(state: StatusStateLike): string {
  const providerText =
    state.activeProviders?.length === 0
      ? "heuristic fallback"
      : state.activeProviders?.join(", ") ?? "config defaults";

  return [
    `Mode: ${state.mode}`,
    `Cwd: ${state.cwd}`,
    `Diff: ${state.diffLabel ?? "not loaded"}`,
    `Providers: ${providerText}`,
    `Roles: ${state.activeRoles?.join(", ") ?? "config defaults"}`,
    `Last report: ${state.lastReport ? `${state.lastReport.verdict} (${state.lastReport.findings.length} findings)` : "none"}`
  ].join("\n");
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
    "  /doctor               Alias for /providers",
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
