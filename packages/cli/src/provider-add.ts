import { PROVIDER_PRESETS, PROVIDER_PRESET_NAMES, type ProviderConfig } from "@quorate/core";

export interface ProviderAddOptions {
  preset?: string;
  type?: string;
  baseUrl?: string;
  model?: string;
  apiKeyEnv?: string;
  command?: string;
  args?: string;
  inputMode?: string;
  roles?: string;
  enabled?: boolean;
  disabled?: boolean;
}

/** Split a comma/space-separated flag value into a trimmed, non-empty list. */
function splitFlag(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Build a validated ProviderConfig from a preset and/or explicit flags. Pure —
 * no filesystem — so the assembly + validation rules are unit-testable. Throws a
 * user-facing Error on bad input (unknown preset, missing model/args, etc.).
 */
export function buildProvider(id: string, options: ProviderAddOptions): ProviderConfig {
  if (!id || !/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
    throw new Error(`Invalid provider id "${id}". Use letters, digits, "-" or "_".`);
  }

  let base: Omit<ProviderConfig, "id"> | Record<string, never> = {};
  if (options.preset) {
    const preset = PROVIDER_PRESETS[options.preset];
    if (!preset) {
      throw new Error(`Unknown preset "${options.preset}". Available: ${PROVIDER_PRESET_NAMES.join(", ")}.`);
    }
    base = preset;
  }

  const type = (options.type ?? (base as ProviderConfig).type ?? "api") as ProviderConfig["type"];
  if (type !== "cli" && type !== "api" && type !== "mock") {
    throw new Error(`Invalid --type "${type}". Use cli, api, or mock.`);
  }

  const provider: ProviderConfig = { ...base, id, type };

  if (options.baseUrl) provider.baseUrl = options.baseUrl;
  if (options.model) provider.model = options.model;
  if (options.apiKeyEnv) provider.apiKeyEnv = options.apiKeyEnv;
  if (options.command) provider.command = options.command;
  if (options.args) provider.args = splitFlag(options.args);
  if (options.inputMode) {
    if (!["stdin", "prompt-file", "none"].includes(options.inputMode)) {
      throw new Error(`Invalid --input-mode "${options.inputMode}". Use stdin, prompt-file, or none.`);
    }
    provider.inputMode = options.inputMode as ProviderConfig["inputMode"];
  }
  if (options.roles) provider.roles = splitFlag(options.roles);
  provider.enabled = options.disabled ? false : options.enabled ?? provider.enabled ?? true;

  if (type === "api" && (!provider.model || !provider.model.trim())) {
    throw new Error(
      `API provider "${id}" needs a model — add --model <id> (e.g. --model qwen2.5-coder:7b), or use --preset <${PROVIDER_PRESET_NAMES.join("|")}>.`
    );
  }
  if (type === "cli") {
    if (!provider.command) provider.command = id;
    if (!provider.args || provider.args.length === 0) {
      throw new Error(
        `CLI provider "${id}" needs headless --args (the flags to run it non-interactively). See .quorate.example.yml for working examples.`
      );
    }
    provider.inputMode = provider.inputMode ?? "stdin";
  }

  return provider;
}
