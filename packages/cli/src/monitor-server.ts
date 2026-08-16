import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { initialMonitorState, pollMonitorState, type MonitorState } from "./tui/monitor-state.js";
import { isGateLane, runControl, type ControlAction } from "./monitor-controls.js";
import { MONITOR_PAGE_HTML } from "./monitor-page.js";
import {
  listPendingApprovals,
  listLiveRuns,
  readMonitorDiscovery,
  removeMonitorDiscovery,
  writeApprovalDecision,
  writeMonitorDiscovery,
  type ApprovalRequest,
  type LiveRunEntry
} from "./live-spool.js";
import { cachedExternalAgents, refreshExternalAgentsCache, type ExternalAgent } from "./agent-scan.js";
import { jumpToRun } from "./terminal-jump.js";

/**
 * `quorate monitor --web` — a loopback-only HTTP + SSE server over the live
 * spool. Security model:
 * - binds 127.0.0.1 only, random port by default;
 * - every request must carry the per-launch bearer token (query param for the
 *   page + EventSource, which cannot set headers), compared in constant time;
 * - the single-page dashboard is an embedded string — nothing is served from
 *   disk, so there is no static-file (traversal) surface at all;
 * - strict CSP, no-store, and X-Content-Type-Options on every response.
 */

export const MONITOR_SSE_INTERVAL_MS = 1_000;

export interface MonitorServerOptions {
  /** Spool dir override for tests. */
  dir?: string;
  /** Fixed token for tests; defaults to a fresh random one per launch. */
  token?: string;
  /** SSE push interval; tests can shrink it. */
  intervalMs?: number;
  /** Injectable external-agent scan for tests. */
  scan?: () => ExternalAgent[];
}

export interface MonitorServerHandle {
  server: Server;
  token: string;
  /** Resolves the printable URL once listening. */
  url(): string;
  /** Begin the discovery heartbeat (called automatically on listen). */
  startDiscovery(): void;
  close(): Promise<void>;
}

/**
 * One shared poller for all SSE clients: a single interval polls the spool
 * once per tick and fans the serialized snapshot out to every subscriber.
 * N clients cost one filesystem sweep, not N. The interval only runs while
 * at least one client is connected.
 */
export interface SseBroadcaster {
  subscribe(res: ServerResponse): void;
  size(): number;
  closeAll(): void;
}

export function createSseBroadcaster(options: { dir?: string; intervalMs?: number; scan?: () => ExternalAgent[] }): SseBroadcaster {
  const clients = new Set<ServerResponse>();
  let state = initialMonitorState();
  let interval: NodeJS.Timeout | undefined;
  // External process scan throttling: the tick reads the cache synchronously
  // (never blocking the event loop); an async refresh kicks off every 5th tick
  // and updates the cache when `ps` returns.
  let tick = 0;
  let refreshInFlight = false;
  const refresh = (): void => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    if (options.scan) {
      // Tests inject a synchronous scan; respect it.
      cachedExternal = options.scan();
      refreshInFlight = false;
      return;
    }
    refreshExternalAgentsCache().finally(() => {
      refreshInFlight = false;
    });
  };
  let cachedExternal: ExternalAgent[] = cachedExternalAgents();

  const stop = (): void => {
    if (interval) clearInterval(interval);
    interval = undefined;
  };

  const push = (): void => {
    // A transient spool read error must not crash the process from a timer —
    // keep the last good state and retry next tick.
    let payload: string;
    try {
      state = pollMonitorState(state, { dir: options.dir });
      tick += 1;
      if (tick % 5 === 0 || (cachedExternal.length === 0 && tick === 1)) {
        refresh();
        cachedExternal = cachedExternalAgents();
      }
      payload = monitorSnapshotPayload(state, { dir: options.dir, scan: () => cachedExternal });
    } catch {
      return;
    }
    for (const res of clients) {
      // A stalled client must not buffer snapshots unboundedly: skip its
      // frame under backpressure (frames are full snapshots — lossless skip).
      try {
        if (res.writableNeedDrain || res.writableEnded) continue;
        res.write(`data: ${payload}\n\n`);
      } catch {
        clients.delete(res);
        res.destroy();
      }
    }
  };

  return {
    subscribe(res: ServerResponse) {
      clients.add(res);
      const cleanup = (): void => {
        clients.delete(res);
        if (clients.size === 0) stop();
      };
      res.on("close", cleanup);
      res.on("error", cleanup);
      // First frame immediately; shared interval only while clients exist.
      push();
      interval ??= setInterval(push, options.intervalMs ?? MONITOR_SSE_INTERVAL_MS);
    },
    size() {
      return clients.size;
    },
    closeAll() {
      stop();
      for (const res of clients) res.destroy();
      clients.clear();
    }
  };
}

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store"
};

/** Loopback-only server: reject requests whose Host header points anywhere
 *  else (DNS-rebinding defense in depth on top of the bearer token). */
function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").toLowerCase();
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

export function newMonitorToken(): string {
  return randomBytes(16).toString("hex");
}

function tokenMatches(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

function applyHeaders(res: ServerResponse, extra: Record<string, string>): void {
  for (const [name, value] of Object.entries({ ...SECURITY_HEADERS, ...extra })) {
    res.setHeader(name, value);
  }
}

interface RunPayload {
  runId: string;
  repo: string;
  mode: string;
  subject: string;
  status: string;
  startedAt: string;
  verdict?: string;
  degraded?: boolean;
  parentLane?: string;
  source?: string;
  kind?: string;
  lanes: Array<Record<string, unknown>>;
  children?: RunPayload[];
}

function runToPayload(run: MonitorState["runs"][number]): RunPayload {
  return {
    runId: run.entry.runId,
    repo: run.entry.repo,
    mode: run.entry.mode,
    subject: run.entry.subject,
    status: run.entry.status,
    startedAt: run.entry.startedAt,
    verdict: run.verdict,
    degraded: run.degraded,
    parentLane: run.entry.parentLane,
    ...(run.entry.source ? { source: run.entry.source } : {}),
    ...(run.entry.kind ? { kind: run.entry.kind } : {}),
    lanes: run.lanes.map((lane) => ({
      laneKey: lane.laneKey,
      providerId: lane.providerId,
      role: lane.role,
      gate: isGateLane(lane.providerId),
      state: lane.row.state,
      note: lane.row.note,
      status: lane.row.status,
      preview: lane.row.preview,
      error: lane.row.error,
      tail: lane.tail.slice(-50)
    })),
    ...(run.children ? { children: run.children.map(runToPayload) } : {})
  };
}

/** Today's run stats, grouped by source (absent source → "quorate"). */
interface StatsPayload {
  today: { runs: number; bySource: Record<string, number> };
}

function buildStatsPayload(dir: string | undefined, entries?: LiveRunEntry[]): StatsPayload {
  // Reuse the runs pollMonitorState already loaded when provided; only hit the
  // filesystem when called standalone (tests/edge cases).
  const runs = entries ?? listLiveRuns({ dir });
  const todayPrefix = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let count = 0;
  const bySource: Record<string, number> = {};
  for (const run of runs) {
    if (!run.startedAt.startsWith(todayPrefix)) continue;
    count += 1;
    const source = run.source ?? "quorate";
    bySource[source] = (bySource[source] ?? 0) + 1;
  }
  return { today: { runs: count, bySource } };
}

/** Approvals payload row — a trimmed view of an ApprovalRequest for the wire. */
interface ApprovalPayload {
  id: string;
  runId: string;
  source: string;
  toolName: string;
  summary: string;
  createdAt: string;
  expiresAt: string;
}

function approvalToPayload(request: ApprovalRequest): ApprovalPayload {
  return {
    id: request.id,
    runId: request.runId,
    source: request.source,
    toolName: request.toolName,
    summary: request.summary,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt
  };
}

/** Strip volatile fields the browser does not need; bound the payload.
 *
 *  Callers MUST pass `scan` if they want the external-agents list reflected;
 *  this function deliberately does NOT fall back to `scanExternalAgents()`
 *  (which uses spawnSync and would block the event loop on the SSE tick). */
export function monitorSnapshotPayload(state: MonitorState, options: { dir?: string; scan?: () => ExternalAgent[] } = {}): string {
  // Reuse the approvals the state already computed (pollMonitorState reap+list)
  // so we do not readdir twice per tick; fall back to listPendingApprovals only
  // for callers (tests) that pass a state without approvals.
  const approvals = (state.approvals.length > 0 ? state.approvals : listPendingApprovals(options.dir)).map(approvalToPayload);
  const external = options.scan ? options.scan() : state.external;
  const stats = buildStatsPayload(options.dir, state.runs.map((run) => run.entry));
  return JSON.stringify({ runs: state.runs.map(runToPayload), approvals, external, stats });
}

/**
 * Pure request handler (exported for tests). Returns true when the request
 * was recognized and handled.
 */
/** Bound concurrent SSE streams — each holds an interval and polls the spool. */
export const MAX_SSE_CLIENTS = 8;

export function handleMonitorRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: { token: string; dir?: string; broadcaster?: SseBroadcaster }
): boolean {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    applyHeaders(res, { "content-type": "text/plain; charset=utf-8" });
    res.statusCode = 400;
    res.end("bad request");
    return true;
  }

  if (!hostAllowed(req.headers.host)) {
    applyHeaders(res, { "content-type": "text/plain; charset=utf-8" });
    res.statusCode = 403;
    res.end("forbidden host");
    return true;
  }

  const provided = url.searchParams.get("token");

  if (!tokenMatches(context.token, provided)) {
    applyHeaders(res, { "content-type": "text/plain; charset=utf-8" });
    res.statusCode = 401;
    res.end("unauthorized");
    return true;
  }

  if (req.method === "POST" && url.pathname === "/control") {
    // Require a JSON content type: cross-origin JSON POSTs trigger a CORS
    // preflight (which we never answer), closing the form-encoded CSRF path.
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      applyHeaders(res, { "content-type": "application/json; charset=utf-8" });
      res.statusCode = 415;
      res.end(JSON.stringify({ ok: false, message: "content-type must be application/json" }));
      return true;
    }
    handleControlRequest(req, res, context.dir);
    return true;
  }

  if (req.method !== "GET") {
    applyHeaders(res, { "content-type": "text/plain; charset=utf-8" });
    res.statusCode = 405;
    res.end("method not allowed");
    return true;
  }

  if (url.pathname === "/") {
    applyHeaders(res, { "content-type": "text/html; charset=utf-8" });
    res.statusCode = 200;
    res.end(MONITOR_PAGE_HTML);
    return true;
  }

  if (url.pathname === "/events") {
    if (!context.broadcaster || context.broadcaster.size() >= MAX_SSE_CLIENTS) {
      applyHeaders(res, { "content-type": "text/plain; charset=utf-8", "retry-after": "5" });
      res.statusCode = 503;
      res.end("too many monitor clients");
      return true;
    }
    applyHeaders(res, { "content-type": "text/event-stream", connection: "keep-alive" });
    res.statusCode = 200;
    context.broadcaster.subscribe(res);
    return true;
  }

  applyHeaders(res, { "content-type": "text/plain; charset=utf-8" });
  res.statusCode = 404;
  res.end("not found");
  return true;
}

const MAX_CONTROL_BODY_BYTES = 4_096;
/** councilRunId charset — mirrors the spool's SAFE_RUN_ID gate. */
const SAFE_RUN_ID = /^[A-Za-z0-9._-]+$/;

/** POST /control — {action, runId|id}. Validated, token-gated.
 *  Actions: abort/rerun (native runs), approve/deny (foreign approvals),
 *  jump (focus the run's terminal). */
function handleControlRequest(req: IncomingMessage, res: ServerResponse, dir?: string): void {
  const reply = (statusCode: number, body: { ok: boolean; message: string }): void => {
    applyHeaders(res, { "content-type": "application/json; charset=utf-8" });
    res.statusCode = statusCode;
    res.end(JSON.stringify(body));
  };

  let raw = "";
  let settled = false;
  const settle = (statusCode: number, body: { ok: boolean; message: string }): void => {
    if (settled) return;
    settled = true;
    reply(statusCode, body);
  };

  // Slow-loris guard: the whole body must arrive within the window.
  const deadline = setTimeout(() => {
    settle(408, { ok: false, message: "body read timeout" });
    req.destroy();
  }, 10_000);
  deadline.unref?.();

  req.on("data", (chunk: Buffer) => {
    raw += chunk.toString("utf8");
    if (raw.length > MAX_CONTROL_BODY_BYTES) {
      // Answer BEFORE dropping the connection — destroy() suppresses "end".
      settle(413, { ok: false, message: "body too large" });
      req.destroy();
    }
  });
  req.on("error", () => {
    clearTimeout(deadline);
  });
  req.on("end", () => {
    clearTimeout(deadline);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return settle(400, { ok: false, message: "body must be JSON" });
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return settle(400, { ok: false, message: "body must be a JSON object" });
    }
    const body = parsed as { action?: unknown; runId?: unknown; id?: unknown; reason?: unknown };
    const action = body.action;
    if (action !== "abort" && action !== "rerun" && action !== "approve" && action !== "deny" && action !== "jump") {
      return settle(400, { ok: false, message: "action must be abort, rerun, approve, deny, or jump" });
    }
    // approve/deny take an approval `id`; abort/rerun/jump take a runId.
    if (action === "approve" || action === "deny") {
      const id = body.id;
      if (typeof id !== "string" || !SAFE_RUN_ID.test(id)) {
        return settle(400, { ok: false, message: "id is missing or malformed" });
      }
      const reason = typeof body.reason === "string" && body.reason.length <= 300 ? body.reason : undefined;
      const result = runApprovalControl(action, id, reason, dir);
      return settle(result.ok ? 200 : 409, result);
    }
    const runId = body.runId;
    if (typeof runId !== "string" || !SAFE_RUN_ID.test(runId)) {
      return settle(400, { ok: false, message: "runId is missing or malformed" });
    }
    if (action === "jump") {
      const result = jumpToRun(runId, { dir });
      return settle(result.ok ? 200 : 409, result);
    }
    const result = runControl(action as ControlAction, runId, dir);
    return settle(result.ok ? 200 : 409, result);
  });
}

/** Write an approval decision for a pending foreign request. */
function runApprovalControl(action: "approve" | "deny", id: string, reason: string | undefined, dir?: string): { ok: boolean; message: string } {
  const pending = listPendingApprovals(dir);
  const match = pending.find((request) => request.id === id);
  if (!match) return { ok: false, message: `No pending approval with id ${id}` };
  try {
    writeApprovalDecision(
      {
        id,
        decision: action === "approve" ? "allow" : "deny",
        ...(action === "deny" ? { reasonCode: "user-denied" as const } : {}),
        decisionSurface: "monitor-web",
        decidedAt: new Date().toISOString()
      },
      dir
    );
    return { ok: true, message: action === "approve" ? "Approved." : "Denied." };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Could not write decision: ${detail}` };
  }
}

export function createMonitorServer(options: MonitorServerOptions = {}): MonitorServerHandle {
  const token = options.token ?? newMonitorToken();
  const broadcaster = createSseBroadcaster({ dir: options.dir, intervalMs: options.intervalMs, scan: options.scan });
  const server = createServer((req, res) => {
    handleMonitorRequest(req, res, { token, dir: options.dir, broadcaster });
  });

  let closing: Promise<void> | undefined;
  let discoveryTimer: NodeJS.Timeout | undefined;
  let discoveryStarted = false;

  const writeHeartbeat = (): void => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    if (port === 0) return; // not listening yet
    const url = `http://127.0.0.1:${port}/?token=${token}`;
    try {
      writeMonitorDiscovery({ url, token, pid: process.pid, heartbeatAt: new Date().toISOString() }, options.dir);
    } catch {
      // Best-effort — the server still works; hooks just won't block.
    }
  };

  return {
    server,
    token,
    url() {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      return `http://127.0.0.1:${port}/?token=${token}`;
    },
    startDiscovery() {
      if (discoveryStarted) return;
      discoveryStarted = true;
      writeHeartbeat();
      // Heartbeat every 2s; unref so the timer never keeps the process alive.
      discoveryTimer = setInterval(writeHeartbeat, 2_000);
      discoveryTimer.unref?.();
    },
    close() {
      // Idempotent: SIGINT and SIGTERM may both fire; every caller awaits the
      // same close. destroy() (not end()) so a stalled client's socket cannot
      // keep server.close() waiting in FIN_WAIT forever.
      closing ??= (async () => {
        if (discoveryTimer) {
          clearInterval(discoveryTimer);
          discoveryTimer = undefined;
        }
        try {
          removeMonitorDiscovery(options.dir);
        } catch {
          // Best-effort cleanup.
        }
        broadcaster.closeAll();
        await new Promise<void>((resolvePromise, rejectPromise) => {
          server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
        });
      })();
      return closing;
    }
  };
}

export function listenMonitorServer(handle: MonitorServerHandle, port = 0): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const onError = (error: Error): void => rejectPromise(error);
    handle.server.once("error", onError);
    handle.server.listen(port, "127.0.0.1", () => {
      handle.server.removeListener("error", onError);
      // Writing the discovery file here is what makes `isMonitorAttached()` true,
      // which is what makes foreign PermissionRequest hooks block for an answer.
      handle.startDiscovery();
      resolvePromise(handle.url());
    });
  });
}
