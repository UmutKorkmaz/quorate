import { describe, expect, it } from "vitest";
import { buildPlannedLanes, createDefaultConfig, type QuorateConfig } from "@quorate/core";
import {
  splitList,
  validateProviderSelection,
  withProviderSelection,
  withRoleSelection,
  withRouteOverrides,
  resolveUseProviders,
  availableProviderIds,
  isRunnableProvider,
  providerRunPreflight,
  spawnPreviewText,
  configuredActiveProviders,
  activeProviderSet,
  type ShellState
} from "../src/session.js";

/** A config with claude=[architect,security] + codex=[maintainer,qa], both enabled,
 *  and every other candidate disabled — so buildPlannedLanes yields exactly four
 *  lanes we can reason about. */
function twoProviderConfig(): QuorateConfig {
  const base = createDefaultConfig([]);
  return {
    ...base,
    providers: base.providers.map((provider) => {
      if (provider.id === "claude") return { ...provider, enabled: true, roles: ["architect", "security"] };
      if (provider.id === "codex") return { ...provider, enabled: true, roles: ["maintainer", "qa"] };
      return { ...provider, enabled: false };
    })
  };
}

function createState(overrides: Partial<ShellState> = {}): ShellState {
  return {
    cwd: "/tmp/session-test",
    config: createDefaultConfig([]),
    mode: "review",
    transcript: [],
    ...overrides
  };
}

describe("splitList", () => {
  it("splits, trims, and drops empties", () => {
    expect(splitList("claude, codex ,, qwen")).toEqual(["claude", "codex", "qwen"]);
    expect(splitList("")).toEqual([]);
  });
});

describe("validateProviderSelection", () => {
  it("returns [] for known ids and undefined input, unknown ids otherwise", () => {
    const config = createDefaultConfig([]);
    expect(validateProviderSelection(config, undefined)).toEqual([]);
    expect(validateProviderSelection(config, "heuristic,codex")).toEqual([]);
    expect(validateProviderSelection(config, "nope,codex")).toEqual(["nope"]);
  });
});

describe("resolveUseProviders", () => {
  it("maps default/empty to undefined, available to runnable ids, and passes explicit ids through", () => {
    const state = createState();
    expect(resolveUseProviders(state, [])).toBeUndefined();
    expect(resolveUseProviders(state, ["default"])).toBeUndefined();
    // No CLI providers detected (injected empty set) -> only the mock heuristic is runnable.
    expect(resolveUseProviders(state, ["available"], [])).toEqual(["heuristic"]);
    expect(resolveUseProviders(state, ["claude", "codex"])).toEqual(["claude", "codex"]);
  });
});

describe("availableProviderIds and isRunnableProvider", () => {
  it("returns only runnable providers (mock heuristic) when no cli provider is detected", () => {
    const state = createState();
    // Inject an empty detected set so no CLI provider is available on PATH.
    expect(availableProviderIds(state, [])).toEqual(["heuristic"]);
  });

  it("treats mock providers as runnable and cli providers as runnable only with args + inputMode + availability", () => {
    const config = createDefaultConfig([]);
    const heuristic = config.providers.find((provider) => provider.id === "heuristic")!;
    const codex = config.providers.find((provider) => provider.id === "codex")!;
    expect(isRunnableProvider(heuristic)).toBe(true);
    // A CLI provider with no headless args is never runnable, even when available.
    expect(isRunnableProvider({ ...codex, args: [] }, true)).toBe(false);
    // The default codex profile now ships args + inputMode, so it is runnable when available.
    expect(isRunnableProvider(codex, true)).toBe(true);
    expect(isRunnableProvider(codex, false)).toBe(false);
  });

  it("treats an api provider as runnable from config (model + key env), not PATH", () => {
    const api = {
      id: "gw",
      type: "api" as const,
      enabled: true,
      baseUrl: "https://example.test/v1",
      model: "some-model",
      apiKeyEnv: "QUORATE_TEST_KEY",
      roles: ["qa"]
    };
    delete process.env.QUORATE_TEST_KEY;
    // No model configured -> never runnable.
    expect(isRunnableProvider({ ...api, model: undefined })).toBe(false);
    // Model present but the named key env is unset -> not runnable.
    expect(isRunnableProvider(api)).toBe(false);
    // Key env present -> runnable regardless of PATH availability.
    process.env.QUORATE_TEST_KEY = "secret";
    expect(isRunnableProvider(api, false)).toBe(true);
    delete process.env.QUORATE_TEST_KEY;
    // An api provider that names no key env is runnable on its model alone.
    expect(isRunnableProvider({ ...api, apiKeyEnv: undefined })).toBe(true);
  });
});

describe("withProviderSelection", () => {
  it("enables only the listed providers and disables the rest", () => {
    const config = createDefaultConfig([]);
    const next = withProviderSelection(config, ["codex"]);
    const enabled = next.providers.filter((provider) => provider.enabled).map((provider) => provider.id);
    expect(enabled).toEqual(["codex"]);
  });

  it("returns the config unchanged when selection is undefined", () => {
    const config = createDefaultConfig([]);
    expect(withProviderSelection(config, undefined)).toBe(config);
  });
});

describe("withRoleSelection", () => {
  it("filters councils to the selected roles and returns config unchanged on empty selection", () => {
    const config = createDefaultConfig([]);
    const next = withRoleSelection(config, ["maintainer"]);
    expect(next.councils).toEqual(["maintainer"]);
    expect(withRoleSelection(config, [])).toBe(config);
    expect(withRoleSelection(config, undefined)).toBe(config);
  });
});

describe("withRouteOverrides", () => {
  it("returns the config unchanged when there are no overrides", () => {
    const config = twoProviderConfig();
    expect(withRouteOverrides(config, undefined)).toBe(config);
    expect(withRouteOverrides(config, {})).toBe(config);
  });

  it("reroutes a role to a new provider and drops it from the old one", () => {
    const config = twoProviderConfig();
    const routed = withRouteOverrides(config, { security: ["codex"] });
    const lanes = buildPlannedLanes(routed).map((lane) => `${lane.provider.id}:${lane.role}`);
    // codex now covers security…
    expect(lanes).toContain("codex:security");
    // …and claude no longer does.
    expect(lanes).not.toContain("claude:security");
    // Unrelated lanes survive untouched.
    expect(lanes).toContain("codex:maintainer");
    expect(lanes).toContain("claude:architect");
  });

  it("keeps a provider enabled only while it still covers a role", () => {
    const config = twoProviderConfig();
    // Move both of codex's roles onto claude; codex should end up with no roles.
    const routed = withRouteOverrides(config, { maintainer: ["claude"], qa: ["claude"] });
    const codex = routed.providers.find((provider) => provider.id === "codex")!;
    expect(codex.roles).toEqual([]);
    expect(codex.enabled).toBe(false);
    const lanes = buildPlannedLanes(routed).map((lane) => lane.provider.id);
    expect(lanes).not.toContain("codex");
  });
});

describe("spawnPreviewText", () => {
  it("returns argv summaries for enabled cli providers", () => {
    const config = createDefaultConfig([]);
    const enabled: QuorateConfig = {
      ...config,
      providers: config.providers.map((provider) =>
        provider.id === "codex" ? { ...provider, enabled: true } : { ...provider, enabled: false }
      )
    };
    const preview = spawnPreviewText(enabled, {
      mode: "review",
      subject: "Interactive code review",
      repoPath: "/tmp/session-test"
    });
    expect(preview).toContain("Spawn preview:");
    expect(preview).toContain("codex [");
    expect(preview).toContain("codex exec");
    expect(preview).toContain("<stdin>");
  });
});

describe("providerRunPreflight", () => {
  it("skips mock providers, reports missing-on-PATH cli providers, and no-headless-profile cli providers", () => {
    const config = createDefaultConfig([]);
    const codex = config.providers.find((provider) => provider.id === "codex")!;
    const enabledMissing: QuorateConfig = {
      ...config,
      providers: config.providers.map((provider) =>
        provider.id === "codex" ? { ...provider, enabled: true } : { ...provider, enabled: false }
      )
    };
    expect(providerRunPreflight(enabledMissing, [])).toEqual(["codex is not available on PATH."]);

    const detected = [{ id: "codex", command: codex.command ?? "codex", available: true, path: "/usr/bin/codex" }];
    const enabledNoProfile: QuorateConfig = {
      ...config,
      providers: config.providers.map((provider) =>
        // codex is available on PATH but stripped of its headless args -> no runnable profile.
        provider.id === "codex" ? { ...provider, enabled: true, args: [] } : { ...provider, enabled: false }
      )
    };
    expect(providerRunPreflight(enabledNoProfile, detected)).toEqual(["codex has no runnable headless profile."]);

    const heuristicOnly: QuorateConfig = {
      ...config,
      providers: config.providers.map((provider) =>
        provider.id === "heuristic" ? { ...provider, enabled: true } : { ...provider, enabled: false }
      )
    };
    expect(providerRunPreflight(heuristicOnly)).toEqual([]);
  });
});

describe("configuredActiveProviders and activeProviderSet", () => {
  it("lists config-enabled providers and falls back to heuristic sentinel", () => {
    const state = createState();
    expect(configuredActiveProviders(state)).toEqual(["heuristic"]);
    expect([...activeProviderSet(state)]).toEqual(["heuristic"]);
    expect([...activeProviderSet(createState({ activeProviders: ["codex"] }))]).toEqual(["codex"]);
    // Explicit empty selection stays empty in the accounting set (`[] ?? x === []`);
    // run-level heuristic fallback happens separately via withProviderSelection -> runCouncil.
    expect([...activeProviderSet(createState({ activeProviders: [] }))]).toEqual([]);
  });
});
