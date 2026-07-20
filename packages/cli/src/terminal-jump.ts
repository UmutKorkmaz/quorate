import { spawnSync } from "node:child_process";
import type { ExecOptions } from "node:child_process";
import { listLiveRuns } from "./live-spool.js";

/**
 * Jump-to-terminal for `quorate monitor`: bring the terminal hosting a given
 * run to the foreground. macOS only; everywhere else returns an honest
 * `{ok:false, message}`.
 *
 * Strategy, in order: tmux (switch-client) → iTerm2 (osascript) → Terminal.app
 * (osascript) → honest fallback. All osascript runs through spawnSync with
 * `shell:false` and a 4s timeout; no user text ever reaches a shell.
 *
 * Pure script-string builders are exported so tests can assert what would run
 * without executing AppleScript.
 */

export interface JumpResult {
  ok: boolean;
  message: string;
  /** Which surface handled the jump, for diagnostics. */
  via?: "tmux" | "iterm2" | "terminal" | "none";
}

export type Exec = (cmd: string, args: string[], opts: ExecOptions) => { stdout: string; stderr: string; status: number | null };

const defaultExec: Exec = (cmd, args, opts) => {
  const result = spawnSync(cmd, args, { ...opts, shell: false, encoding: "utf8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
};

function isMac(): boolean {
  return process.platform === "darwin";
}

/** Resolve the tty (e.g. ttys004) for a pid, walking up the ppid tree ≤5 hops. */
export function resolveTty(pid: number, exec: Exec = defaultExec): string | undefined {
  let current = pid;
  for (let hop = 0; hop < 5 && current > 0; hop += 1) {
    const result = exec("ps", ["-o", "tty=", "-p", String(current)], { timeout: 4_000, encoding: "utf8" });
    const tty = result.stdout.trim();
    // A real terminal device looks like ttys### or pts/N (not "??" or "?").
    if (tty && tty !== "?" && /^ttys?\d+|^pts\/\d+|^tty\d+/.test(tty)) return tty;
    // Walk up: read ppid and retry.
    const ppidResult = exec("ps", ["-o", "ppid=", "-p", String(current)], { timeout: 4_000, encoding: "utf8" });
    const ppid = Number(ppidResult.stdout.trim());
    if (!Number.isInteger(ppid) || ppid <= 0 || ppid === current) break;
    current = ppid;
  }
  return undefined;
}

/** Pure builder: the tmux target spec for a pane owning a tty. */
export function buildTmuxTarget(tty: string): string {
  return `%${tty}`;
}

/** Pure builder: the osascript to select the iTerm2 session whose tty matches. */
export function buildItermScript(tty: string): string {
  // Iterate every tab of every window, find the session whose tty contains the
  // resolved device, select its tab and activate the window.
  const escaped = tty.replace(/["\\]/g, "\\$&");
  return `
tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      try
        if (tty of current session of t) contains "${escaped}" then
          select t
          set index of w to 1
          activate
          return
        end if
      end try
    end repeat
  end repeat
end tell`;
}

/** Pure builder: the osascript to activate the Terminal.app window hosting a tty. */
export function buildTerminalScript(tty: string): string {
  const escaped = tty.replace(/["\\]/g, "\\$&");
  // Terminal.app does not expose tty directly; approximate by bringing the
  // frontmost window forward when any tty match is plausible. We activate the
  // app and rely on the user's tab choice; this is best-effort by design.
  return `
tell application "Terminal"
  activate
end tell
-- resolved tty: ${escaped}`;
}

function tryTmux(tty: string, exec: Exec): boolean {
  // tmux list-panes -a -F '#{pane_tty} #{session_name}:#{window_index}.#{pane_index}'
  const list = exec("tmux", ["list-panes", "-a", "-F", "#{pane_tty} #{session_name}:#{window_index}.#{pane_index}"], { timeout: 4_000, encoding: "utf8" });
  if (list.status !== 0) return false;
  const target = list.stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(tty));
  if (!target) return false;
  const spec = target.split(/\s+/)[1];
  if (!spec) return false;
  const sw = exec("tmux", ["switch-client", "-t", spec], { timeout: 4_000, encoding: "utf8" });
  return sw.status === 0;
}

function tryIterm(tty: string, exec: Exec): boolean {
  const result = exec("osascript", ["-e", buildItermScript(tty)], { timeout: 4_000, encoding: "utf8" });
  return result.status === 0;
}

function tryTerminalApp(tty: string, exec: Exec): boolean {
  const result = exec("osascript", ["-e", buildTerminalScript(tty)], { timeout: 4_000, encoding: "utf8" });
  return result.status === 0;
}

/**
 * Jump to the terminal hosting a run. macOS only; inject `exec` for tests.
 */
export function jumpToRun(runId: string, options: { dir?: string; exec?: Exec } = {}): JumpResult {
  if (!isMac()) {
    return { ok: false, message: "jump-to-terminal is macOS-only today.", via: "none" };
  }
  const exec = options.exec ?? defaultExec;
  const run = listLiveRuns({ dir: options.dir }).find((entry) => entry.runId === runId);
  if (!run) return { ok: false, message: `Unknown run: ${runId}`, via: "none" };
  const tty = resolveTty(run.pid, exec);
  if (!tty) return { ok: false, message: `Could not resolve a tty for pid ${run.pid}.`, via: "none" };
  if (tryTmux(tty, exec)) return { ok: true, message: `Focused tmux pane (${tty}).`, via: "tmux" };
  if (tryIterm(tty, exec)) return { ok: true, message: `Focused iTerm2 tab (${tty}).`, via: "iterm2" };
  if (tryTerminalApp(tty, exec)) return { ok: true, message: `Activated Terminal.app (${tty}).`, via: "terminal" };
  return { ok: false, message: `No tmux/iTerm2/Terminal owner found for ${tty}.`, via: "none" };
}
