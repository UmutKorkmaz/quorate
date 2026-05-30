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
      "--max-budget-usd",
      "0.25",
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
    args: ["exec", "--ephemeral", "--sandbox", "read-only", "-"],
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
      args: [],
      roles: candidate.roles,
      enabled: false,
      stdin: true,
      inputMode: candidate.inputMode ?? "stdin",
      timeoutMs: 120_000,
      killGraceMs: 5_000,
      maxInputBytes: 250_000,
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
