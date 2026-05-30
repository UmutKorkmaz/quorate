import { describe, expect, it } from "vitest";
import { createDefaultConfig, type QuorateConfig } from "@quorate/core";
import {
  splitList,
  validateProviderSelection,
  withProviderSelection,
  withRoleSelection,
  resolveUseProviders,
  availableProviderIds,
  isRunnableProvider,
  providerRunPreflight,
  configuredActiveProviders,
  activeProviderSet,
  type ShellState
} from "../src/session.js";

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
    expect(resolveUseProviders(state, ["available"])).toEqual(["heuristic"]);
    expect(resolveUseProviders(state, ["claude", "codex"])).toEqual(["claude", "codex"]);
  });
});

describe("availableProviderIds and isRunnableProvider", () => {
  it("returns only runnable providers (mock heuristic) when no cli provider is detected", () => {
    const state = createState();
    expect(availableProviderIds(state)).toEqual(["heuristic"]);
  });

  it("treats mock providers as runnable and cli providers as runnable only with args + inputMode + availability", () => {
    const config = createDefaultConfig([]);
    const heuristic = config.providers.find((provider) => provider.id === "heuristic")!;
    const codex = config.providers.find((provider) => provider.id === "codex")!;
    expect(isRunnableProvider(heuristic)).toBe(true);
    expect(isRunnableProvider(codex, true)).toBe(false);
    expect(isRunnableProvider({ ...codex, args: ["{promptFile}"], inputMode: "stdin" }, true)).toBe(true);
    expect(isRunnableProvider({ ...codex, args: ["{promptFile}"], inputMode: "stdin" }, false)).toBe(false);
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
        provider.id === "codex" ? { ...provider, enabled: true } : { ...provider, enabled: false }
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
