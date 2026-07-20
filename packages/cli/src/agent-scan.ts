import { spawn, spawnSync } from "node:child_process";
import type { ExecOptions } from "node:child_process";

/**
 * Foreign-agent process scanner for `quorate monitor` surfaces. Detects AI
 * coding CLIs you launched yourself (Claude Code, Codex, Gemini, …) by listing
 * processes, without injecting anything into them. Read-only and best-effort:
 * the only foreign CLI with a rich hook surface today is Claude Code (handled
 * by the `hook-report` bridge); the rest appear here as observed processes.
 *
 * Pure + injectable: tests pass a fake `exec` so no real `ps` runs.
 */

export interface ExternalAgent {
  pid: number;
  name: string;
  etime: string;
  command: string;
}

/** Lowercased basename tokens that identify each known CLI's process.
 *  The leading alternation matches start, a path separator, or whitespace so
 *  we catch both `/usr/local/bin/claude` and a bare `claude` arg in a ps line. */
const KNOWN_AGENTS: readonly { name: string; match: RegExp }[] = [
  { name: "claude", match: /(^|[/\\]|\s)claude(\.exe|-\w*)?(?=\s|$)/ },
  { name: "codex", match: /(^|[/\\]|\s)codex(\.exe)?(?=\s|$)/ },
  { name: "gemini", match: /(^|[/\\]|\s)gemini(\.exe)?(?=\s|$)/ },
  { name: "qwen", match: /(^|[/\\]|\s)qwen(\.exe)?(?=\s|$)/ },
  { name: "kimi", match: /(^|[/\\]|\s)kimi(\.exe)?(?=\s|$)/ },
  { name: "opencode", match: /(^|[/\\]|\s)opencode(\.exe)?(?=\s|$)/ },
  { name: "crush", match: /(^|[/\\]|\s)crush(\.exe)?(?=\s|$)/ },
  { name: "goose", match: /(^|[/\\]|\s)goose(\.exe)?(?=\s|$)/ }
];

const COMMAND_MAX = 200;

export type AgentExec = (cmd: string, args: string[], opts: ExecOptions) => { stdout: string } | { error: string };

const defaultExec: AgentExec = (cmd, args, opts) => {
  const result = spawnSync(cmd, args, { ...opts, shell: false, encoding: "utf8" });
  if (result.error) return { error: String(result.error) };
  return { stdout: result.stdout ?? "" };
};

/** Match a command line against a known agent token. */
export function matchAgentName(command: string): string | undefined {
  // The matcher fires on the literal CLI invocation, not on incidental
  // substrings like "/usr/local/bin" containing "bin".
  for (const agent of KNOWN_AGENTS) {
    if (agent.match.test(command)) return agent.name;
  }
  return undefined;
}

/** Truncate a command line for display. */
export function truncateCommand(command: string): string {
  const trimmed = command.trim();
  return trimmed.length <= COMMAND_MAX ? trimmed : `${trimmed.slice(0, COMMAND_MAX)}…`;
}

/**
 * Parse the output of `ps -axo pid=,ppid=,etime=,command=` into agent rows.
 * Pure: callers inject the raw `ps` stdout from a fixture.
 */
export function parsePsOutput(raw: string, selfPid = process.pid): ExternalAgent[] {
  const seen = new Map<number, ExternalAgent>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Fields are whitespace-separated; `command` may itself contain spaces.
    const parts = trimmed.split(/\s+/);
    const pid = Number(parts[0]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (pid === selfPid) continue;
    const name = matchAgentName(trimmed);
    if (!name) continue;
    // Skip our own process tree — a quorate CLI shouldn't surface itself.
    if (/\bquorate\b/.test(trimmed)) continue;
    if (seen.has(pid)) continue;
    const etime = parts[2] ?? "";
    seen.set(pid, { pid, name, etime, command: truncateCommand(trimmed) });
  }
  // Dedup by (name, command) so two threads of the same invocation collapse.
  const unique: ExternalAgent[] = [];
  const byKey = new Set<string>();
  for (const agent of seen.values()) {
    const key = `${agent.name}:${agent.command}`;
    if (byKey.has(key)) continue;
    byKey.add(key);
    unique.push(agent);
  }
  return unique.sort((a, b) => a.name.localeCompare(b.name) || a.pid - b.pid);
}

/**
 * List foreign AI-agent processes currently running on this machine.
 * Returns `[]` on Windows (no `ps`) or if the listing is unreadable.
 *
 * `platform` is injectable so tests can exercise the POSIX path on a Windows
 * runner (the real scan is a no-op there).
 *
 * NOTE: this uses `spawnSync`, which BLOCKS the event loop for up to 3s. Use
 * it only from contexts that can tolerate a brief block (CLI one-shots). For
 * the SSE broadcast tick, use {@link refreshExternalAgentsCache} which spawns
 * `ps` asynchronously and exposes the last cached result.
 */
export function scanExternalAgents(options: { exec?: AgentExec; selfPid?: number; platform?: NodeJS.Platform } = {}): ExternalAgent[] {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return [];
  const exec = options.exec ?? defaultExec;
  const result = exec("ps", ["-axo", "pid=,ppid=,etime=,command="], { timeout: 3_000, encoding: "utf8" });
  if ("error" in result) return [];
  return parsePsOutput(result.stdout, options.selfPid);
}

/**
 * Async refresh of the external-agents cache. Spawns `ps` WITHOUT blocking
 * the event loop; resolves with the parsed result and also stashes it so a
 * synchronous {@link cachedExternalAgents} can return it on the next tick.
 *
 * The SSE broadcaster calls this on its refresh cadence; the tick reads the
 * cache synchronously — no `spawnSync` on the hot path.
 */
export function refreshExternalAgentsCache(selfPid: number = process.pid): Promise<ExternalAgent[]> {
  if (process.platform === "win32") {
    cachedExternal = [];
    return Promise.resolve([]);
  }
  return new Promise((resolve) => {
    const child = spawn("ps", ["-axo", "pid=,ppid=,etime=,command="], { shell: false });
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      cachedExternal = parsePsOutput(stdout, selfPid);
      resolve(cachedExternal);
    }, 3_000);
    timer.unref?.();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cachedExternal = [];
      resolve([]);
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cachedExternal = parsePsOutput(stdout, selfPid);
      resolve(cachedExternal);
    });
  });
}

let cachedExternal: ExternalAgent[] = [];

/** Synchronously return the last cached scan result (refresh via {@link refreshExternalAgentsCache}). */
export function cachedExternalAgents(): ExternalAgent[] {
  return cachedExternal;
}
