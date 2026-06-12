import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultConfig, loadConfig, serializeConfig } from "@quorate/core";
import { buildProgram, normalizeAddedProviderRoles, providerPresetRows } from "../src/index.js";
import { buildProvider } from "../src/provider-add.js";

function writeConfig(dir: string, councils: string[]): void {
  writeFileSync(
    join(dir, ".quorate.yml"),
    serializeConfig({
      ...createDefaultConfig([]),
      councils
    }),
    "utf8"
  );
}

describe("buildProvider", () => {
  it("expands a preset into a full api provider", () => {
    const p = buildProvider("my-llama", { preset: "ollama" });
    expect(p).toMatchObject({
      id: "my-llama",
      type: "api",
      enabled: true,
      baseUrl: "http://localhost:11434/v1",
      model: "qwen2.5-coder:7b"
    });
    expect(p.roles).toEqual(["qa", "maintainer", "performance"]);
  });

  it("applies flag overrides on top of a preset", () => {
    const p = buildProvider("hf", {
      preset: "hf-router",
      model: "deepseek-ai/DeepSeek-R1",
      roles: "security, architect",
      disabled: true
    });
    expect(p.model).toBe("deepseek-ai/DeepSeek-R1");
    expect(p.roles).toEqual(["security", "architect"]);
    expect(p.enabled).toBe(false);
    expect(p.apiKeyEnv).toBe("HF_TOKEN"); // preserved from preset
  });

  it("builds an api provider from explicit flags", () => {
    const p = buildProvider("local", {
      type: "api",
      baseUrl: "http://localhost:8000/v1",
      model: "Qwen/Qwen2.5-Coder-7B-Instruct",
      apiKeyEnv: "VLLM_API_KEY",
      roles: "qa"
    });
    expect(p.type).toBe("api");
    expect(p.baseUrl).toBe("http://localhost:8000/v1");
    expect(p.enabled).toBe(true);
  });

  it("builds a generic OpenAI-compatible api provider from user flags without a preset", () => {
    const p = buildProvider("custom-openai", {
      baseUrl: "https://api.example.test/v1",
      model: "vendor/model-code-review",
      apiKeyEnv: "CUSTOM_OPENAI_KEY"
    });

    expect(p).toMatchObject({
      id: "custom-openai",
      type: "api",
      baseUrl: "https://api.example.test/v1",
      model: "vendor/model-code-review",
      apiKeyEnv: "CUSTOM_OPENAI_KEY",
      enabled: true
    });
  });

  it("builds a cli provider, defaulting command to the id and inputMode to stdin", () => {
    const p = buildProvider("crush", { type: "cli", args: "review --json" });
    expect(p).toMatchObject({ id: "crush", type: "cli", command: "crush", inputMode: "stdin" });
    expect(p.args).toEqual(["review", "--json"]);
  });

  it("rejects an api provider with no model", () => {
    expect(() => buildProvider("x", { type: "api" })).toThrow(/needs a model/);
  });

  it("rejects a cli provider with no args", () => {
    expect(() => buildProvider("x", { type: "cli" })).toThrow(/needs headless --args/);
  });

  it("rejects an unknown preset", () => {
    expect(() => buildProvider("x", { preset: "nope" })).toThrow(/Unknown preset/);
  });

  it("rejects an invalid id and an invalid type", () => {
    expect(() => buildProvider("bad id!", { preset: "ollama" })).toThrow(/Invalid provider id/);
    expect(() => buildProvider("x", { type: "weird", model: "m" })).toThrow(/Invalid --type/);
  });

  it("drops preset roles that are not in the active config", () => {
    const provider = buildProvider("router", { preset: "openrouter" });
    const config = { ...createDefaultConfig([]), councils: ["maintainer"] };
    const normalized = normalizeAddedProviderRoles(provider, config, false);

    expect(normalized.droppedPresetRoles).toEqual(["architect", "security"]);
    expect(normalized.provider.roles).toBeUndefined();
  });

  it("keeps known preset roles and reports only dropped roles", () => {
    const provider = buildProvider("local", { preset: "ollama" });
    const config = { ...createDefaultConfig([]), councils: ["qa", "maintainer"] };
    const normalized = normalizeAddedProviderRoles(provider, config, false);

    expect(normalized.droppedPresetRoles).toEqual(["performance"]);
    expect(normalized.provider.roles).toEqual(["qa", "maintainer"]);
  });

  it("rejects explicitly requested roles that are not in the active config", () => {
    const provider = buildProvider("router", { preset: "openrouter", roles: "security" });
    const config = { ...createDefaultConfig([]), councils: ["maintainer"] };

    expect(() => normalizeAddedProviderRoles(provider, config, true)).toThrow(
      "Unknown role: security. Roles: maintainer."
    );
  });
});

describe("provider preset rows", () => {
  it("returns JSON-serializable preset records with ids", () => {
    const rows = providerPresetRows();

    expect(rows.find((row) => row.id === "openai")).toMatchObject({
      type: "api",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY"
    });
    expect(JSON.parse(JSON.stringify(rows))[0]).toHaveProperty("id");
  });
});

describe("provider command", () => {
  it("prints machine-readable preset JSON with --json", async () => {
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      output.push(String(message));
    };
    try {
      const program = buildProgram();
      program.exitOverride();
      await program.parseAsync(["node", "quorate", "provider", "presets", "--json"], { from: "node" });
    } finally {
      console.log = originalLog;
    }

    const rows = JSON.parse(output.join("\n")) as Array<{ id: string; baseUrl?: string; model?: string }>;
    expect(rows.find((row) => row.id === "openai")).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o"
    });
  });

  it("adds a generic api provider from explicit OpenAI-compatible flags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-provider-add-"));
    writeConfig(dir, ["maintainer"]);
    const originalLog = console.log;
    console.log = () => undefined;
    try {
      const program = buildProgram();
      program.exitOverride();
      await program.parseAsync(
        [
          "node",
          "quorate",
          "--cwd",
          dir,
          "provider",
          "add",
          "custom-openai",
          "--base-url",
          "https://api.example.test/v1",
          "--model",
          "vendor/model-code-review",
          "--api-key-env",
          "CUSTOM_OPENAI_KEY",
          "--no-pick"
        ],
        { from: "node" }
      );
    } finally {
      console.log = originalLog;
    }

    const config = loadConfig(join(dir, ".quorate.yml"), dir);
    expect(config.providers.find((provider) => provider.id === "custom-openai")).toMatchObject({
      type: "api",
      baseUrl: "https://api.example.test/v1",
      model: "vendor/model-code-review",
      apiKeyEnv: "CUSTOM_OPENAI_KEY"
    });
  });

  it("does not attach unknown preset roles to the written config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-provider-preset-"));
    writeConfig(dir, ["maintainer"]);
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      output.push(String(message));
    };
    try {
      const program = buildProgram();
      program.exitOverride();
      await program.parseAsync(
        ["node", "quorate", "--cwd", dir, "provider", "add", "router", "--preset", "openrouter", "--no-pick"],
        { from: "node" }
      );
    } finally {
      console.log = originalLog;
    }

    const config = loadConfig(join(dir, ".quorate.yml"), dir);
    expect(config.providers.find((provider) => provider.id === "router")?.roles).toEqual([]);
    expect(output.join("\n")).toContain("Skipped preset roles not in this config: architect, security.");
    expect(readFileSync(join(dir, ".quorate.yml"), "utf8")).not.toMatch(/id: router[\s\S]*roles:\n\s+- architect/);
  });
});
