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

export function activeProviderSet(state: ShellState): Set<string> {
  const configured = configuredActiveProviders(state);
  return new Set(state.activeProviders ?? (configured.length > 0 ? configured : ["heuristic"]));
}
