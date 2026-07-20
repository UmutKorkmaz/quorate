import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { initialMonitorState, pollMonitorState, type MonitorState } from "./tui/monitor-state.js";
import { isGateLane, runControl, type ControlAction } from "./monitor-controls.js";
import { MONITOR_PAGE_HTML } from "./monitor-page.js";

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
}

export interface MonitorServerHandle {
  server: Server;
  token: string;
  /** Resolves the printable URL once listening. */
  url(): string;
  close(): Promise<void>;
}

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store"
};

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

/** Strip volatile fields the browser does not need; bound the payload. */
export function monitorSnapshotPayload(state: MonitorState): string {
  const runs = state.runs.map((run) => ({
    runId: run.entry.runId,
    repo: run.entry.repo,
    mode: run.entry.mode,
    subject: run.entry.subject,
    status: run.entry.status,
    startedAt: run.entry.startedAt,
    verdict: run.verdict,
    degraded: run.degraded,
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
    }))
  }));
  return JSON.stringify({ runs });
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
  context: { token: string; dir?: string; intervalMs?: number; sockets?: Set<ServerResponse> }
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
  const provided = url.searchParams.get("token");

  if (!tokenMatches(context.token, provided)) {
    applyHeaders(res, { "content-type": "text/plain; charset=utf-8" });
    res.statusCode = 401;
    res.end("unauthorized");
    return true;
  }

  if (req.method === "POST" && url.pathname === "/control") {
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
    if ((context.sockets?.size ?? 0) >= MAX_SSE_CLIENTS) {
      applyHeaders(res, { "content-type": "text/plain; charset=utf-8", "retry-after": "5" });
      res.statusCode = 503;
      res.end("too many monitor clients");
      return true;
    }
    applyHeaders(res, { "content-type": "text/event-stream", connection: "keep-alive" });
    res.statusCode = 200;

    let state = initialMonitorState();
    const push = (): void => {
      // A transient spool read error must not crash the process from a timer,
      // and a stalled client must not buffer snapshots unboundedly: skip the
      // frame when the socket signals backpressure (SSE frames are snapshots,
      // so dropping one loses nothing).
      try {
        if (res.writableNeedDrain || res.writableEnded) return;
        state = pollMonitorState(state, { dir: context.dir });
        res.write(`data: ${monitorSnapshotPayload(state)}\n\n`);
      } catch {
        cleanup();
        res.destroy();
      }
    };
    const interval = setInterval(push, context.intervalMs ?? MONITOR_SSE_INTERVAL_MS);
    context.sockets?.add(res);
    const cleanup = (): void => {
      clearInterval(interval);
      context.sockets?.delete(res);
    };
    res.on("close", cleanup);
    res.on("error", cleanup);
    push();
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

/** POST /control — {action: "abort"|"rerun", runId}. Validated, token-gated. */
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
    const body = parsed as { action?: unknown; runId?: unknown };
    const action = body.action;
    const runId = body.runId;
    if (action !== "abort" && action !== "rerun") {
      return settle(400, { ok: false, message: "action must be abort or rerun" });
    }
    if (typeof runId !== "string" || !SAFE_RUN_ID.test(runId)) {
      return settle(400, { ok: false, message: "runId is missing or malformed" });
    }
    const result = runControl(action as ControlAction, runId, dir);
    return settle(result.ok ? 200 : 409, result);
  });
}

export function createMonitorServer(options: MonitorServerOptions = {}): MonitorServerHandle {
  const token = options.token ?? newMonitorToken();
  const sockets = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    handleMonitorRequest(req, res, { token, dir: options.dir, intervalMs: options.intervalMs, sockets });
  });

  let closing: Promise<void> | undefined;

  return {
    server,
    token,
    url() {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      return `http://127.0.0.1:${port}/?token=${token}`;
    },
    close() {
      // Idempotent: SIGINT and SIGTERM may both fire; every caller awaits the
      // same close. destroy() (not end()) so a stalled client's socket cannot
      // keep server.close() waiting in FIN_WAIT forever.
      closing ??= (async () => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
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
      resolvePromise(handle.url());
    });
  });
}
