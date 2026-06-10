import { spawnSync } from "node:child_process";

/**
 * Write-mode launch profiles for `quorate fix`. The agent is started in its
 * normal INTERACTIVE mode with the fix prompt as the opening message — its own
 * permission/approval flow stays fully active (we never pass bypass flags), and
 * the user watches and steers in their real terminal (stdio: inherit).
 */
export interface WriteAgentProfile {
  id: string;
  command: string;
  /** argv given the prompt text. */
  args(prompt: string): string[];
  label: string;
}

export const WRITE_AGENT_PROFILES: WriteAgentProfile[] = [
  { id: "claude", command: "claude", args: (prompt) => [prompt], label: "Claude Code (interactive)" },
  { id: "codex", command: "codex", args: (prompt) => [prompt], label: "Codex CLI (interactive)" },
  // agy ignores a positional prompt; -i runs it interactively and keeps the session.
  { id: "agy", command: "agy", args: (prompt) => ["-i", prompt], label: "Agy (interactive)" }
];

export function writeAgentProfile(id: string): WriteAgentProfile | undefined {
  return WRITE_AGENT_PROFILES.find((profile) => profile.id === id);
}

/** Hand the real terminal to the agent; resolves when the agent exits. */
export function runWriteAgent(profile: WriteAgentProfile, prompt: string, cwd: string): number {
  const result = spawnSync(profile.command, profile.args(prompt), { cwd, stdio: "inherit" });
  if (result.error) {
    throw new Error(`Could not start ${profile.command}: ${result.error.message}`);
  }
  return result.status ?? 0;
}
