import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * `quorate monitor setup [--remove] [--dry-run] [--yes]` — installs (or
 * removes) Quorate hook-report entries in foreign AI CLIs so `quorate monitor`
 * can observe them. Today only Claude Code has a rich hook surface; Codex gets
 * a guarded notify shim only when its notify slot is empty.
 *
 * Safety contract:
 * - parse → modify → atomic write, PRESERVING every other key in the file;
 * - per-event entries are APPEND-only (idempotent, marker-tagged), never replace;
 * - any modified file is backed up to `<name>.quorate-backup-<iso>.json`;
 * - Codex's notify slot is NEVER clobbered — if occupied, skip and name it.
 *
 * Pure merge/strip functions are exported for fixture-driven tests; the shell
 * does the file I/O.
 */

export type CliKind = "claude" | "codex" | "gemini" | "qwen" | "kimi" | "opencode" | "crush" | "goose";

export interface CliCapability {
  kind: CliKind;
  name: string;
  installed: boolean;
  /** Whether Quorate can install rich hooks (true), a shim only (partial), or nothing (false). */
  hookSupport: "full" | "shim" | "scan-only";
  note?: string;
}

const CLAUDE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "SubagentStart",
  "SubagentStop",
  "Notification",
  "Stop",
  "SessionEnd",
  "PermissionRequest"
] as const;

/** Marker present in every Quorate-installed hook command — never remove
 *  anything without it. */
export const QUORATE_HOOK_MARKER = "hook-report --source claude";

/** Absolute path to the quorate binary, resolved at setup time. */
function resolveQuorateBinary(): string {
  try {
    const result = spawnSync("which", ["quorate"], { encoding: "utf8", shell: false });
    if (result.status === 0) return result.stdout.trim();
  } catch {
    // Fall through.
  }
  return process.argv[1] ?? "quorate";
}

/** Build the guarded Claude hook command for one event. */
export function buildClaudeHookCommand(quorateBinary: string, event: string): string {
  const abs = quorateBinary.replace(/'/g, "'\"'\"'");
  return `/bin/sh -c 'Q="${abs}"; [ -x "$Q" ] || Q="$(command -v quorate||true)"; [ -n "$Q" ] && exec "$Q" hook-report --source claude --event ${event}; exit 0'`;
}

/** A single Claude settings.json hook entry. */
interface ClaudeHookEntry {
  type: "command";
  command: string;
  timeout?: number;
}

interface ClaudeHookGroup {
  matcher: string;
  hooks: ClaudeHookEntry[];
}

type ClaudeHooks = Record<string, ClaudeHookGroup[]>;

interface ClaudeSettings {
  hooks?: ClaudeHooks;
  [key: string]: unknown;
}

/**
 * Pure merge: add Quorate's hook entry to each event group in a parsed Claude
 * settings object, idempotently. Returns a new object; never mutates input.
 */
export function mergeClaudeHooks(settings: ClaudeSettings, quorateBinary: string): ClaudeSettings {
  const next: ClaudeSettings = { ...settings };
  const hooks: ClaudeHooks = settings.hooks ? structuredClone(settings.hooks) : {};
  for (const event of CLAUDE_EVENTS) {
    const groups = hooks[event] ?? [];
    // Idempotent: skip if any existing entry in this event is already Quorate's.
    const already = groups.some((group) =>
      group.hooks.some((hook) => typeof hook.command === "string" && hook.command.includes(QUORATE_HOOK_MARKER) && hook.command.includes(`--event ${event}`))
    );
    if (already) continue;
    const entry: ClaudeHookEntry = { type: "command", command: buildClaudeHookCommand(quorateBinary, event) };
    // PermissionRequest blocks; give it a generous timeout so the human can answer.
    if (event === "PermissionRequest") entry.timeout = 120;
    const group: ClaudeHookGroup = { matcher: "*", hooks: [entry] };
    hooks[event] = [...groups, group];
  }
  next.hooks = hooks;
  return next;
}

/**
 * Pure strip: remove every Quorate-tagged hook entry from a parsed Claude
 * settings object. Returns a new object; never mutates input. Empty groups are
 * removed; an empty hooks object is dropped entirely.
 */
export function stripClaudeHooks(settings: ClaudeSettings): ClaudeSettings {
  const next: ClaudeSettings = { ...settings };
  if (!settings.hooks) return next;
  const hooks: ClaudeHooks = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    const kept: ClaudeHookGroup[] = [];
    for (const group of groups) {
      const hooksKept = group.hooks.filter(
        (hook) => !(typeof hook.command === "string" && hook.command.includes(QUORATE_HOOK_MARKER))
      );
      if (hooksKept.length === 0) continue;
      kept.push({ ...group, hooks: hooksKept });
    }
    if (kept.length > 0) hooks[event] = kept;
  }
  if (Object.keys(hooks).length > 0) {
    next.hooks = hooks;
  } else {
    delete next.hooks;
  }
  return next;
}

/** Detect installed foreign CLIs and their hook capability. */
export function detectCliCapabilities(executables: Record<string, boolean>): CliCapability[] {
  const order: CliKind[] = ["claude", "codex", "gemini", "qwen", "kimi", "opencode", "crush", "goose"];
  return order.map((kind) => {
    const installed = executables[kind] ?? false;
    if (kind === "claude") {
      return { kind, name: "claude", installed, hookSupport: installed ? "full" : "full", note: installed ? "Rich hooks: lanes, subagents, approve/deny" : "Install Claude Code for rich hooks" };
    }
    if (kind === "codex") {
      return { kind, name: "codex", installed, hookSupport: "shim", note: "notify shim only (skipped if slot occupied)" };
    }
    return { kind, name: kind, installed, hookSupport: "scan-only" as const, note: "Process-scan only (no hook surface)" };
  });
}

/** What `monitor setup` would do, computed before any I/O. */
export interface SetupPlan {
  claude: { path: string; exists: boolean; changes: number; backup?: string };
  codex: { path: string; notifyOccupied: boolean; action: "skip" | "shim" | "none"; note: string };
  dryRun: boolean;
}

/** Compute the setup plan (no file writes). */
export function computeSetupPlan(options: {
  claudePath?: string;
  codexPath?: string;
  codexNotifyOccupied?: boolean;
  dryRun: boolean;
}): SetupPlan {
  const claudePath = options.claudePath ?? claudeSettingsPath();
  const codexPath = options.codexPath ?? codexConfigPath();
  const claudeExists = existsSync(claudePath);
  const codexNotifyOccupied = options.codexNotifyOccupied ?? codexNotifySlotOccupied(codexPath);
  return {
    claude: {
      path: claudePath,
      exists: claudeExists,
      // One change per event not already installed.
      changes: CLAUDE_EVENTS.length
    },
    codex: {
      path: codexPath,
      notifyOccupied: codexNotifyOccupied,
      action: codexNotifyOccupied ? "skip" : "shim",
      note: codexNotifyOccupied ? "notify slot occupied — skipping (not clobbering)" : "notify slot empty — would install guarded shim"
    },
    dryRun: options.dryRun
  };
}

export function claudeSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

export function codexConfigPath(): string {
  return join(homedir(), ".codex", "config.toml");
}

/** Read+parse Claude settings; returns `{}` if absent/corrupt. */
export function readClaudeSettings(path: string = claudeSettingsPath()): ClaudeSettings {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as ClaudeSettings;
  } catch {
    // Absent or corrupt — start fresh.
  }
  return {};
}

export function codexNotifySlotOccupied(path: string = codexConfigPath()): boolean {
  try {
    const text = readFileSync(path, "utf8");
    const match = text.match(/^notify\s*=\s*\[(.+?)\]/m);
    return Boolean(match && match[1] && match[1].trim().length > 0);
  } catch {
    return false;
  }
}

function isoTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Apply the setup plan (write files). Returns a summary for the user. */
export function applySetup(plan: SetupPlan, quorateBinary?: string): { applied: boolean; backup?: string; message: string } {
  if (plan.dryRun) {
    return { applied: false, message: "dry-run: no changes made" };
  }
  const binary = quorateBinary ?? resolveQuorateBinary();
  let backup: string | undefined;
  // Claude — parse → merge → backup → atomic write.
  try {
    const before = readClaudeSettings(plan.claude.path);
    const after = mergeClaudeHooks(before, binary);
    if (plan.claude.exists) {
      backup = `${plan.claude.path}.quorate-backup-${isoTimestamp()}.json`;
      writeFileSync(backup, JSON.stringify(before, null, 2), { encoding: "utf8", mode: 0o600 });
    } else {
      try {
        // Best-effort: ensure the parent dir exists for a fresh install.
        mkdirSync(dirname(plan.claude.path), { recursive: true });
      } catch {
        // Ignore — the write below will surface the real error.
      }
    }
    const temp = `${plan.claude.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(after, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temp, plan.claude.path);
    return { applied: true, backup, message: `Claude Code hooks installed at ${plan.claude.path}` };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { applied: false, backup, message: `failed to install Claude hooks: ${message}` };
  }
}

/** Apply removal (write the stripped settings back). */
export function applyRemove(plan: SetupPlan): { applied: boolean; backup?: string; message: string } {
  if (plan.dryRun) {
    return { applied: false, message: "dry-run: no changes made" };
  }
  if (!plan.claude.exists) {
    return { applied: false, message: `no settings file at ${plan.claude.path}` };
  }
  try {
    const before = readClaudeSettings(plan.claude.path);
    const after = stripClaudeHooks(before);
    const backup = `${plan.claude.path}.quorate-backup-${isoTimestamp()}.json`;
    writeFileSync(backup, JSON.stringify(before, null, 2), { encoding: "utf8", mode: 0o600 });
    const temp = `${plan.claude.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(after, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temp, plan.claude.path);
    return { applied: true, backup, message: `Quorate hooks removed from ${plan.claude.path}` };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { applied: false, message: `failed to remove Claude hooks: ${message}` };
  }
}

/** Render the capability table as a printable string. */
export function renderCapabilityTable(capabilities: CliCapability[]): string {
  const rows = capabilities.map((cap) => {
    const status = cap.installed ? "installed" : "not found";
    const support = cap.hookSupport === "full" ? "full hooks" : cap.hookSupport === "shim" ? "shim only" : "scan only";
    return `${cap.name.padEnd(10)} ${status.padEnd(12)} ${support}${cap.note ? `  — ${cap.note}` : ""}`;
  });
  return ["CLI        status        hook support", ...rows].join("\n");
}
