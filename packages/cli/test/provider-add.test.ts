import { describe, expect, it } from "vitest";
import { buildProvider } from "../src/provider-add.js";

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
});
