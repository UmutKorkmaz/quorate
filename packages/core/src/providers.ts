import { delimiter, isAbsolute, join } from "node:path";
import { accessSync, constants } from "node:fs";
import type { QuorateConfig, DetectedProvider, ProviderConfig } from "./types.js";

export const defaultCouncils = [
  "architect",
  "security",
  "qa",
  "performance",
  "maintainer"
];

/**
 * Ready-to-use `type: api` provider templates for `quorate provider add --preset`.
 * Mirrors the presets documented in .quorate.example.yml.
 * Each is an id-less ProviderConfig; the CLI assembles it with the chosen id and overrides.
 */
export const PROVIDER_PRESETS: Record<string, Omit<ProviderConfig, "id">> = {
  ollama: {
    type: "api",
    enabled: true,
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5-coder:7b",
    roles: ["qa", "maintainer", "performance"],
    timeoutMs: 300_000
  },
  lmstudio: {
    type: "api",
    enabled: true,
    baseUrl: "http://localhost:1234/v1",
    model: "qwen2.5-coder-7b",
    roles: ["qa", "maintainer"],
    timeoutMs: 180_000
  },
  vllm: {
    type: "api",
    enabled: true,
    baseUrl: "http://localhost:8000/v1",
    model: "Qwen/Qwen2.5-Coder-7B-Instruct",
    apiKeyEnv: "VLLM_API_KEY",
    roles: ["architect", "security", "qa", "maintainer"],
    timeoutMs: 180_000
  },
  llamacpp: {
    type: "api",
    enabled: true,
    baseUrl: "http://localhost:8080/v1",
    model: "local",
    roles: ["qa", "maintainer"]
  },
  "hf-router": {
    type: "api",
    enabled: true,
    baseUrl: "https://router.huggingface.co/v1",
    model: "Qwen/Qwen2.5-Coder-32B-Instruct:fastest",
    apiKeyEnv: "HF_TOKEN",
    roles: ["qa", "maintainer", "performance"],
    timeoutMs: 120_000
  },
  openrouter: {
    type: "api",
    enabled: true,
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4.6",
    apiKeyEnv: "OPENROUTER_API_KEY",
    roles: ["architect", "security"]
  },
  openai: {
    type: "api",
    enabled: true,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    apiKeyEnv: "OPENAI_API_KEY",
    roles: ["architect", "security"],
    timeoutMs: 120_000
  },
  tgi: {
    type: "api",
    enabled: true,
    baseUrl: "http://localhost:8080/v1",
    model: "tgi",
    roles: ["qa", "maintainer"],
    timeoutMs: 180_000
  },
  litellm: {
    type: "api",
    enabled: true,
    baseUrl: "http://localhost:4000/v1",
    model: "gpt-4o",
    apiKeyEnv: "LITELLM_API_KEY",
    roles: ["qa", "maintainer"],
    timeoutMs: 120_000
  },
  together: {
    type: "api",
    enabled: true,
    baseUrl: "https://api.together.ai/v1",
    model: "Qwen/Qwen2.5-Coder-32B-Instruct",
    apiKeyEnv: "TOGETHER_API_KEY",
    roles: ["qa", "maintainer", "performance"],
    timeoutMs: 120_000
  },
  groq: {
    type: "api",
    enabled: true,
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
    roles: ["qa", "performance"],
    timeoutMs: 120_000
  },
  fireworks: {
    type: "api",
    enabled: true,
    baseUrl: "https://api.fireworks.ai/inference/v1",
    model: "accounts/fireworks/models/qwen2p5-coder-32b-instruct",
    apiKeyEnv: "FIREWORKS_API_KEY",
    roles: ["qa", "maintainer"],
    timeoutMs: 120_000
  },
  deepseek: {
    type: "api",
    enabled: true,
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    roles: ["architect", "qa"],
    timeoutMs: 120_000
  },
  mistral: {
    type: "api",
    enabled: true,
    baseUrl: "https://api.mistral.ai/v1",
    model: "codestral-latest",
    apiKeyEnv: "MISTRAL_API_KEY",
    roles: ["qa", "maintainer"],
    timeoutMs: 120_000
  },
  gemini: {
    type: "api",
    enabled: true,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    roles: ["qa", "performance"],
    timeoutMs: 120_000
  },
  zai: {
    type: "api",
    enabled: true,
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    model: "glm-5.1",
    apiKeyEnv: "ZAI_API_KEY",
    roles: ["architect", "security", "performance"],
    timeoutMs: 180_000
  }
};

/** Preset names available to `quorate provider add --preset <name>`. */
export const PROVIDER_PRESET_NAMES = Object.keys(PROVIDER_PRESETS);

export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.replace(/^\[(.*)\]$/, "$1");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".local");
  } catch {
    return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|[^/?#]+\.local)(?::|\/|$)/i.test(baseUrl);
  }
}

export const defaultProviderCandidates: Array<
  Omit<ProviderConfig, "type" | "enabled"> & { aliases?: string[]; installHint?: string }
> = [
  {
    id: "claude",
    command: "claude",
    args: [
      "--print",
      "--input-format",
      "text",
      "--output-format",
      "text",
      "--permission-mode",
      "plan",
      "--no-session-persistence",
      "--tools",
      ""
    ],
    inputMode: "stdin",
    roles: ["architect", "security"],
    installHint: "Claude Code CLI"
  },
  {
    id: "codex",
    command: "codex",
    args: ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "-"],
    inputMode: "stdin",
    roles: ["maintainer", "qa"],
    installHint: "OpenAI Codex CLI"
  },
  {
    id: "agy",
    command: "agy",
    args: ["--print", "--print-timeout", "2m", "--sandbox"],
    inputMode: "stdin",
    roles: ["architect"],
    installHint: "Google Antigravity CLI"
  },
  { id: "hermes", command: "hermes", roles: ["maintainer"], installHint: "Hermes CLI" },
  {
    id: "kimi",
    command: "kimi",
    aliases: ["kimi-cli"],
    args: [
      "--print",
      "--input-format",
      "text",
      "--output-format",
      "text",
      "--final-message-only",
      "--max-steps-per-turn",
      "3",
      "--plan"
    ],
    inputMode: "stdin",
    roles: ["qa"],
    installHint: "Kimi CLI"
  },
  {
    id: "qwen",
    command: "qwen",
    args: [
      "--bare",
      "--approval-mode",
      "plan",
      "--input-format",
      "text",
      "--output-format",
      "text",
      "--max-session-turns",
      "1"
    ],
    inputMode: "stdin",
    roles: ["performance", "maintainer"],
    installHint: "Qwen Code CLI"
  },
  { id: "minimax", command: "minimax", roles: ["qa"], installHint: "MiniMax CLI" },
  { id: "opencode", command: "opencode", roles: ["maintainer"], installHint: "OpenCode CLI" },
  { id: "kilo", command: "kilo", roles: ["architect"], installHint: "Kilo Code CLI" },
  { id: "droid", command: "droid", roles: ["qa"], installHint: "Droid CLI" },
  { id: "crush", command: "crush", roles: ["security"], installHint: "Crush CLI" },
  { id: "cline", command: "cline", aliases: ["cline-cli"], roles: ["maintainer"], installHint: "Cline CLI" },
  { id: "goose", command: "goose", roles: ["qa"], installHint: "Goose CLI" },
  { id: "copilot", command: "copilot", roles: ["maintainer"], installHint: "GitHub Copilot CLI" },
  { id: "grok", command: "grok", roles: ["architect"], installHint: "Grok CLI" },
  { id: "agent", command: "agent", roles: ["maintainer"], installHint: "Agent CLI" },
  { id: "ollama", command: "ollama", roles: ["performance"], installHint: "Ollama local model runner" }
];

export function findExecutable(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (isAbsolute(command)) {
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      return undefined;
    }
  }

  const pathValue = env.PATH ?? "";
  const extensions = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];

  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = join(dir, `${command}${ext}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Keep scanning PATH.
      }
    }
  }

  return undefined;
}

export function detectAvailableProviders(
  candidates = defaultProviderCandidates,
  env: NodeJS.ProcessEnv = process.env
): DetectedProvider[] {
  return candidates.map((candidate) => {
    const commands = [candidate.command, ...(candidate.aliases ?? [])].filter(Boolean) as string[];
    const found = commands
      .map((command) => ({ command, path: findExecutable(command, env) }))
      .find((entry) => entry.path);

    return {
      id: candidate.id,
      command: found?.command ?? candidate.command ?? candidate.id,
      path: found?.path,
      available: Boolean(found?.path),
      aliases: candidate.aliases,
      installHint: candidate.installHint
    };
  });
}

export function createDefaultConfig(detected = detectAvailableProviders()): QuorateConfig {
  const detectedById = new Map(detected.map((provider) => [provider.id, provider]));
  const providers: ProviderConfig[] = defaultProviderCandidates.map((candidate) => {
    const detectedProvider = detectedById.get(candidate.id);

    return {
      id: candidate.id,
      type: "cli",
      command: detectedProvider?.command ?? candidate.command,
      // Use each provider's known headless args so detected CLIs are runnable
      // out of the box (still disabled until the user opts in with /use). An
      // empty default left every real provider stuck as "needs-profile".
      args: candidate.args ?? [],
      roles: candidate.roles,
      enabled: false,
      stdin: true,
      inputMode: candidate.inputMode ?? "stdin",
      timeoutMs: 300_000,
      killGraceMs: 5_000,
      maxOutputBytes: 1_000_000,
      inheritEnv: false,
      installHint: candidate.installHint
    };
  });

  providers.unshift({
    id: "heuristic",
    type: "mock",
    roles: ["maintainer"],
    enabled: true,
    timeoutMs: 5_000
  });

  return {
    councils: defaultCouncils,
    providers,
    github: {
      commentMode: "update",
      failOn: "high",
      runnerMode: "auto",
      failOnDegraded: false
    }
  };
}
