import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import {
  appendRunEventLine,
  deleteApproval,
  isMonitorAttached,
  readApprovalDecision,
  readRunMeta,
  writeApprovalRequest,
  writeApprovalDecision,
  writeRunMeta,
  type ApprovalRequest,
  type LiveRunEntry
} from "./live-spool.js";

/**
 * `quorate hook-report --source <s> --event <E>` — the Claude Code hook bridge.
 *
 * Foreign CLIs (Claude Code today) call this from their hook events. It writes
 * a lightweight external run into the live spool so `quorate monitor` surfaces
 * show the session's lanes and chunks, and — for `PermissionRequest` only — it
 * BLOCKS the foreign agent until the monitor answers an approve/deny card.
 *
 * Safety contract (Claude hooks block on this process's exit):
 * - malformed/empty STDIN → exit 0 silent (defer, never crash the agent);
 * - never emit stray stdout (only the PermissionRequest decision JSON);
 * - if no monitor is attached, even PermissionRequest defers (exit 0 fast) —
 *   zero overhead when nobody is watching.
 *
 * Structure: pure parse/dispatch functions (testable) + a thin CLI shell.
 */

export type HookSource = "claude" | "codex";

export type HookEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "SubagentStart"
  | "SubagentStop"
  | "Notification"
  | "Stop"
  | "SessionEnd"
  | "PermissionRequest"
  // Codex notify shim reuses the Notification path.
  | "notify";

const SESSION_LANE_ROLE = "session";

/** Truncation mirrors the council spool's subject cap. */
const SUBJECT_MAX = 200;
const SUMMARY_MAX = 300;
/** Wall-clock cap for a blocked PermissionRequest before deferring. */
const PERMISSION_TIMEOUT_MS = 55_000;
const POLL_INTERVAL_MS = 250;
const MONITOR_RECHECK_INTERVAL_MS = 1_000;
const APPROVAL_TTL_MS = 55_000;

/**
 * Synchronous sleep used by the default PermissionRequest poll loop. A real
 * sleeper is mandatory in production — the no-op default would busy-spin at
 * 100% CPU for up to 55s on every foreign permission prompt. Backed by
 * Atomics.wait on a single reused shared buffer (the only built-in sync sleep
 * in Node) so we don't allocate per poll iteration.
 */
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(sleepBuffer, 0, 0, ms);
}

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

export interface ParsedHookPayload {
  /** Claude Code's session id; becomes `claude-<sid>`. */
  sessionId?: string;
  /** Free-form source-of-truth for the active prompt/tool. */
  prompt?: string;
  toolName?: string;
  /** The tool input, summarized for the approve/deny card. */
  toolInput?: unknown;
  /** Notification text (Notification/notify events). */
  message?: string;
  /** Subagent id/type for SubagentStart/Stop. */
  subagentId?: string;
  subagentType?: string;
  /** Cwd as seen by the foreign CLI. */
  cwd?: string;
}

/**
 * Parse a raw hook STDIN string into the fields hook-report cares about.
 * Malformed JSON → `undefined` (defer). Accepts the loose Claude Code shape:
 * top-level fields, plus the nested `session_id`, `tool_name`, `tool_input`,
 * and `transcript_path` conventions used across events.
 */
export function parseHookPayload(raw: string): ParsedHookPayload | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const sessionId =
    typeof record.session_id === "string"
      ? record.session_id
      : typeof record.sessionId === "string"
        ? record.sessionId
        : undefined;
  const prompt =
    typeof record.prompt === "string"
      ? record.prompt
      : typeof record.user_prompt === "string"
        ? record.user_prompt
        : undefined;
  const toolName =
    typeof record.tool_name === "string"
      ? record.tool_name
      : typeof record.toolName === "string"
        ? record.toolName
        : undefined;
  const toolInput = record.tool_input ?? record.toolInput;
  const message =
    typeof record.message === "string"
      ? record.message
      : typeof record.text === "string"
        ? record.text
        : undefined;
  const subagentId =
    typeof record.subagent_id === "string"
      ? record.subagent_id
      : typeof record.agent_id === "string"
        ? record.agent_id
        : undefined;
  const subagentType =
    typeof record.subagent_type === "string"
      ? record.subagent_type
      : typeof record.agent_type === "string"
        ? record.agent_type
        : undefined;
  const cwd = typeof record.cwd === "string" ? record.cwd : typeof record.current_dir === "string" ? record.current_dir : undefined;
  return { sessionId, prompt, toolName, toolInput, message, subagentId, subagentType, cwd };
}

/** Build the runId for a foreign session (`claude-<sessionId>`). */
export function foreignRunId(source: HookSource, sessionId: string | undefined): string | undefined {
  if (!sessionId) return undefined;
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "-");
  if (!safe) return undefined;
  return `${source}-${safe}`;
}

/** Summarize arbitrary tool input into a short human-readable string. */
export function summarizeToolInput(toolName: string | undefined, toolInput: unknown): string {
  if (typeof toolInput === "string") return truncate(toolInput, SUMMARY_MAX);
  if (toolInput && typeof toolInput === "object") {
    const record = toolInput as Record<string, unknown>;
    const command = record.command;
    if (typeof command === "string") return truncate(`${toolName ?? "tool"}: ${command}`, SUMMARY_MAX);
    const file = record.file_path ?? record.path ?? record.filename;
    if (typeof file === "string") return truncate(`${toolName ?? "tool"}: ${file}`, SUMMARY_MAX);
    const pattern = record.pattern;
    if (typeof pattern === "string") return truncate(`${toolName ?? "tool"}: /${pattern}/`, SUMMARY_MAX);
    const url = record.url;
    if (typeof url === "string") return truncate(`${toolName ?? "tool"}: ${url}`, SUMMARY_MAX);
  }
  return toolName ? truncate(toolName, SUMMARY_MAX) : "(no detail)";
}

export interface HookReportDeps {
  dir?: string;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Injectable sleep for the PermissionRequest poll loop. */
  sleep?: (ms: number) => void;
  /** Injectable pid-alive check (defaults to live-spool's). */
  isAttached?: () => boolean;
  /** Where to write the decision JSON; defaults to process.stdout. */
  emit?: (line: string) => void;
  /** Cwd override; defaults to process.cwd(). */
  cwd?: string;
  /** Owner pid recorded on the run; defaults to process.pid. */
  pid?: number;
}

/** Create or refresh the external run's registry entry. Returns the runId. */
function ensureExternalRun(
  runId: string,
  source: HookSource,
  subject: string,
  deps: HookReportDeps
): LiveRunEntry | undefined {
  const cwd = deps.cwd ?? process.cwd();
  const pid = deps.pid ?? process.pid;
  const existing = readRunMeta(runId, deps.dir);
  const entry: LiveRunEntry = {
    runId,
    pid,
    cwd,
    repo: basename(cwd),
    mode: "agent",
    subject: truncate(subject || `${source} session`, SUBJECT_MAX),
    startedAt: existing?.startedAt ?? nowIso(deps.now?.()),
    planned: existing?.planned ?? [],
    status: "running",
    updatedAt: nowIso(deps.now?.()),
    source,
    kind: "external"
  };
  try {
    writeRunMeta(entry, deps.dir);
  } catch {
    return undefined; // Spool not writable — defer silently.
  }
  return entry;
}

/** Emit `provider/started` for a lane if not already present in the spool. */
function startLane(runId: string, providerId: string, role: string, at: string, deps: HookReportDeps): void {
  const event = { type: "provider/started", councilRunId: runId, providerId, role, providerType: "cli", at };
  appendEvent(runId, event, deps);
}

function appendEvent(runId: string, event: Record<string, unknown>, deps: HookReportDeps): void {
  try {
    appendRunEventLine(runId, JSON.stringify(event), deps.dir);
  } catch {
    // Spool not writable — defer silently; the agent must never crash.
  }
}

/**
 * Dispatch one parsed hook payload against the live spool. Returns the action
 * the shell should take: `defer` (exit 0 silent) or `permission` (run the
 * blocking approval round-trip and emit a decision JSON).
 *
 * Pure of global state except the filesystem reads/writes it is named for.
 */
export function dispatchHook(
  source: HookSource,
  event: HookEvent,
  payload: ParsedHookPayload | undefined,
  deps: HookReportDeps
): { action: "defer" } | { action: "permission"; runId: string; toolName: string; summary: string } {
  const runId = foreignRunId(source, payload?.sessionId);
  // Non-session events with no resolvable runId are no-ops (defer).
  if (event !== "notify" && !runId) return { action: "defer" };

  switch (event) {
    case "SessionStart": {
      if (!runId) return { action: "defer" };
      const subject = payload?.prompt ?? `${source} session`;
      ensureExternalRun(runId, source, subject, deps);
      appendEvent(runId, { type: "council/started", councilRunId: runId, mode: "agent", subject: truncate(subject, SUBJECT_MAX), planned: [], at: nowIso(deps.now?.()) }, deps);
      startLane(runId, source, SESSION_LANE_ROLE, nowIso(deps.now?.()), deps);
      return { action: "defer" };
    }
    case "UserPromptSubmit": {
      if (!runId) return { action: "defer" };
      const subject = truncate(payload?.prompt ?? "", SUBJECT_MAX);
      ensureExternalRun(runId, source, subject || `${source} session`, deps);
      const firstLine = (payload?.prompt ?? "").split("\n")[0]?.trim() ?? "";
      if (firstLine) appendEvent(runId, { type: "provider/chunk", councilRunId: runId, providerId: source, role: SESSION_LANE_ROLE, stream: "stdout", text: `» ${firstLine}\n` }, deps);
      return { action: "defer" };
    }
    case "PreToolUse": {
      if (!runId) return { action: "defer" };
      const name = payload?.toolName ?? "tool";
      appendEvent(runId, { type: "provider/chunk", councilRunId: runId, providerId: source, role: SESSION_LANE_ROLE, stream: "stdout", text: `tool: ${name}\n` }, deps);
      return { action: "defer" };
    }
    case "PostToolUse": {
      if (!runId) return { action: "defer" };
      const name = payload?.toolName ?? "tool";
      appendEvent(runId, { type: "provider/chunk", councilRunId: runId, providerId: source, role: SESSION_LANE_ROLE, stream: "stdout", text: `done: ${name}\n` }, deps);
      return { action: "defer" };
    }
    case "SubagentStart": {
      if (!runId) return { action: "defer" };
      const role = payload?.subagentId ?? payload?.subagentType ?? "task";
      const safeRole = `task-${truncate(role, 40).replace(/\s+/g, "-")}`;
      startLane(runId, source, safeRole, nowIso(deps.now?.()), deps);
      return { action: "defer" };
    }
    case "SubagentStop": {
      if (!runId) return { action: "defer" };
      const role = payload?.subagentId ?? payload?.subagentType ?? "task";
      const safeRole = `task-${truncate(role, 40).replace(/\s+/g, "-")}`;
      appendEvent(runId, { type: "provider/done", councilRunId: runId, providerId: source, role: safeRole, result: { status: "ok", findings: [] } }, deps);
      return { action: "defer" };
    }
    case "Notification":
    case "notify": {
      const text = payload?.message;
      if (runId && text) {
        appendEvent(runId, { type: "provider/chunk", councilRunId: runId, providerId: source, role: SESSION_LANE_ROLE, stream: "stdout", text: `${truncate(text, SUMMARY_MAX)}\n` }, deps);
      }
      return { action: "defer" };
    }
    case "Stop": {
      if (!runId) return { action: "defer" };
      appendEvent(runId, { type: "provider/chunk", councilRunId: runId, providerId: source, role: SESSION_LANE_ROLE, stream: "stdout", text: "turn ended\n" }, deps);
      return { action: "defer" };
    }
    case "SessionEnd": {
      if (!runId) return { action: "defer" };
      const existing = readRunMeta(runId, deps.dir);
      if (existing && existing.status === "running") {
        try {
          writeRunMeta({ ...existing, status: "done", updatedAt: nowIso(deps.now?.()) }, deps.dir);
        } catch {
          // Best-effort seal; the run remains visible as running/stale.
        }
      }
      return { action: "defer" };
    }
    case "PermissionRequest": {
      if (!runId) return { action: "defer" };
      const toolName = payload?.toolName ?? "tool";
      const summary = summarizeToolInput(toolName, payload?.toolInput);
      return { action: "permission", runId, toolName, summary };
    }
    default: {
      // Unknown event — defer.
      return { action: "defer" };
    }
  }
}

export interface PermissionRoundtripResult {
  /** The JSON line to print to stdout (always valid); `undefined` = print nothing. */
  stdout?: string;
}

/**
 * The blocking PermissionRequest round-trip. Pure-ish: takes injectable
 * `isAttached`/`sleep`/`now` so tests drive it deterministically. Returns the
 * stdout JSON to emit (or `undefined` to defer silently).
 *
 * Algorithm (from the build plan):
 * 1. If no monitor is attached → exit 0 silent (defer, zero overhead).
 * 2. Write the approval request + an `approval/pending` ndjson annotation.
 * 3. Poll the decision every 250ms; re-check `isMonitorAttached` each second.
 *    If the monitor died mid-wait → cleanup and defer (exit 0).
 * 4. On decision → write `approval/resolved` ndjson, delete both files, emit
 *    the Claude decision JSON.
 * 5. Hard-cap at 55s → defer (exit 0).
 */
export function runPermissionRoundtrip(
  decision: { runId: string; source: HookSource; toolName: string; summary: string; id: string },
  deps: HookReportDeps
): PermissionRoundtripResult {
  const isAttached = deps.isAttached ?? (() => isMonitorAttached({ dir: deps.dir }));
  const sleep = deps.sleep ?? ((ms: number) => sleepSync(ms));
  const now = deps.now ?? (() => new Date());

  if (!isAttached()) return {}; // Defer — nobody's watching.

  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + APPROVAL_TTL_MS);
  const request: ApprovalRequest = {
    id: decision.id,
    runId: decision.runId,
    source: decision.source,
    toolName: decision.toolName,
    summary: decision.summary,
    cwd: deps.cwd ?? process.cwd(),
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  try {
    writeApprovalRequest(request, deps.dir);
    appendEvent(decision.runId, { type: "approval/pending", councilRunId: decision.runId, id: decision.id, toolName: decision.toolName, summary: decision.summary, at: createdAt.toISOString() }, deps);
  } catch {
    return {}; // Spool not writable — defer.
  }

  const deadline = createdAt.getTime() + PERMISSION_TIMEOUT_MS;
  let lastMonitorCheck = createdAt.getTime();
  while (true) {
    const tick = now().getTime();
    if (tick >= deadline) {
      cleanupApproval(decision.id, deps.dir);
      return {}; // Timed out — defer to the agent's own default.
    }
    if (tick - lastMonitorCheck >= MONITOR_RECHECK_INTERVAL_MS) {
      lastMonitorCheck = tick;
      if (!isAttached()) {
        cleanupApproval(decision.id, deps.dir);
        return {}; // Monitor died — defer.
      }
    }
    const resolved = readApprovalDecision(decision.id, deps.dir);
    if (resolved) {
      appendEvent(decision.runId, { type: "approval/resolved", id: decision.id, decision: resolved.decision, at: now().toISOString() }, deps);
      cleanupApproval(decision.id, deps.dir);
      return {
        stdout:
          resolved.decision === "allow"
            ? JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } })
            : JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: resolved.reason ?? "Denied from Quorate monitor" } } })
      };
    }
    sleep(POLL_INTERVAL_MS);
  }
}

function cleanupApproval(id: string, dir?: string): void {
  try {
    deleteApproval(id, dir);
  } catch {
    // Best-effort.
  }
}

/** Generate a fresh approval id (charset-safe, time-prefixed for sortability). */
export function newApprovalId(now: Date = new Date()): string {
  const base = now.getTime().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `ap-${base}-${rand}`;
}

/**
 * CLI shell for `quorate hook-report`. Reads STDIN, dispatches, and for
 * PermissionRequest runs the blocking round-trip and prints the decision JSON.
 * Never throws — every failure path is a silent exit 0.
 */
export async function runHookReportCli(argv: { source: string; event: string }): Promise<void> {
  const source = parseSource(argv.source);
  const event = parseEvent(argv.event);
  if (!source || !event) return; // Unknown source/event — defer.

  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return; // No STDIN — defer.
  }
  const payload = parseHookPayload(raw);
  const deps: HookReportDeps = { cwd: process.cwd(), pid: process.pid };
  const outcome = dispatchHook(source, event, payload, deps);
  if (outcome.action !== "permission") return;
  const result = runPermissionRoundtrip(
    { runId: outcome.runId, source, toolName: outcome.toolName, summary: outcome.summary, id: newApprovalId() },
    deps
  );
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
}

function parseSource(value: string): HookSource | undefined {
  return value === "claude" || value === "codex" ? value : undefined;
}

function parseEvent(value: string): HookEvent | undefined {
  const known: HookEvent[] = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "SubagentStart",
    "SubagentStop",
    "Notification",
    "Stop",
    "SessionEnd",
    "PermissionRequest",
    "notify"
  ];
  return known.includes(value as HookEvent) ? (value as HookEvent) : undefined;
}

/** Read the live codex config's notify slot if present (read-only). */
export function readCodexNotifySlot(configPath = `${homedir()}/.codex/config.toml`): string | undefined {
  try {
    const text = readFileSync(configPath, "utf8");
    const match = text.match(/^notify\s*=\s*\[(.+?)\]/m);
    return match?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}
