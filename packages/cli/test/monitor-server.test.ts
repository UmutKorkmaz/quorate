import { mkdtempSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CouncilEvent } from "@quorate/core";
import { createLiveSpoolSink } from "../src/live-spool.js";
import {
  createMonitorServer,
  listenMonitorServer,
  MAX_SSE_CLIENTS,
  monitorSnapshotPayload,
  type MonitorServerHandle
} from "../src/monitor-server.js";
import { initialMonitorState, pollMonitorState } from "../src/tui/monitor-state.js";
import { MONITOR_PAGE_HTML } from "../src/monitor-page.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "quorate-monweb-"));
}

/** Deliberately not secret-shaped: a fixed test session identifier. */
const TEST_KEY = ["monitor", "session", "fixture"].join("-");

/** All test requests are bounded — a hung local server must fail fast. */
function fetchT(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
}

/** Node fetch protects the Host header; use the real HTTP boundary when a
 * DNS-rebinding test must send a deliberately hostile Host value. */
function requestWithHost(url: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers: { host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.once("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.setTimeout(10_000, () => request.destroy(new Error("monitor request timed out")));
    request.once("error", reject);
    request.end();
  });
}

function started(runId: string): CouncilEvent {
  return {
    type: "council/started",
    councilRunId: runId,
    mode: "review",
    subject: "web test",
    planned: [{ providerId: "claude", role: "security", providerType: "cli" }],
    at: "2026-07-20T00:00:00.000Z"
  };
}

const handles: MonitorServerHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close().catch(() => undefined)));
});

async function launch(dir: string, token = TEST_KEY): Promise<{ handle: MonitorServerHandle; base: string }> {
  const handle = createMonitorServer({ dir, token, intervalMs: 50 });
  handles.push(handle);
  const url = await listenMonitorServer(handle);
  return { handle, base: url.split("/?")[0] as string };
}

describe("monitor web server auth", () => {
  it("rejects requests without the token", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act
    const page = await fetchT(`${base}/`);
    const events = await fetchT(`${base}/events`);

    // Assert
    expect(page.status).toBe(401);
    expect(events.status).toBe(401);
  });

  it("rejects a wrong token and accepts the right one", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act
    const wrong = await fetchT(`${base}/?token=nope`);
    const right = await fetchT(`${base}/?token=${TEST_KEY}`);
    const body = await right.text();

    // Assert
    expect(wrong.status).toBe(401);
    expect(right.status).toBe(200);
    expect(right.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("Quorate monitor");
  });

  it("rejects non-GET methods on non-control paths", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act
    const post = await fetchT(`${base}/?token=${TEST_KEY}`, { method: "POST" });

    // Assert
    expect(post.status).toBe(405);
  });

  it("404s unknown paths — there is no filesystem serving at all", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act — a classic traversal probe (encoded so the URL parser keeps it in the path).
    const traversal = await fetchT(`${base}/..%2f..%2f..%2fetc%2fpasswd?token=${TEST_KEY}`);

    // Assert
    expect(traversal.status).toBe(404);
  });

  it("sets the security headers on every response", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act
    const response = await fetchT(`${base}/?token=${TEST_KEY}`);

    // Assert
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["monitor.example", "192.168.1.24"])('rejects a non-loopback Host header (%s)', async (host) => {
    // A future DNS-rebinding regression must not turn the token into the only
    // network boundary for this loopback-only service.
    const { base } = await launch(tempDir());

    const response = await requestWithHost(`${base}/?token=${TEST_KEY}`, host);

    expect(response.status).toBe(403);
    expect(response.body).toBe("forbidden host");
  });
});

describe("monitor SSE stream", () => {
  it("frames spool snapshots as SSE data events", async () => {
    // Arrange — a live run in the spool.
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, pid: process.pid });
    sink.handleEvent(started("run-sse"));
    const { base } = await launch(dir);

    // Act — read the first SSE frame.
    const response = await fetchT(`${base}/events?token=${TEST_KEY}`);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const frame = new TextDecoder().decode(value);

    // Assert
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(frame.startsWith("data: ")).toBe(true);
    const payload = JSON.parse(frame.slice("data: ".length).trimEnd()) as { runs: Array<{ runId: string }> };
    expect(payload.runs[0]?.runId).toBe("run-sse");
  });
});

describe("POST /control", () => {
  async function post(base: string, body: unknown, token = TEST_KEY): Promise<Response> {
    return fetchT(`${base}/control?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body)
    });
  }

  it("requires the token", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act
    const response = await fetchT(`${base}/control`, { method: "POST", body: "{}" });

    // Assert
    expect(response.status).toBe(401);
  });

  it("rejects a token-authenticated control request without a JSON content type", async () => {
    // A form POST is a browser-simple request; accepting it would reintroduce
    // the CSRF path the monitor's bearer token is intended to avoid.
    const { base } = await launch(tempDir());

    const response = await fetchT(`${base}/control?token=${TEST_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "action=abort&runId=missing-run"
    });

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({ ok: false, message: "content-type must be application/json" });
  });

  it("validates the body shape", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act
    const notJson = await post(base, "not json");
    const badAction = await post(base, { action: "explode", runId: "x" });
    const badRunId = await post(base, { action: "abort", runId: "../etc" });

    // Assert
    expect(notJson.status).toBe(400);
    expect(badAction.status).toBe(400);
    expect(badRunId.status).toBe(400);
  });

  it("returns 409 with the control message for a valid but impossible request", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act
    const response = await post(base, { action: "abort", runId: "missing-run" });
    const body = (await response.json()) as { ok: boolean; message: string };

    // Assert
    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.message).toContain("Unknown run");
  });
});

describe("monitor SSE limits and lifecycle", () => {
  it("caps concurrent SSE clients at MAX_SSE_CLIENTS with a 503", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act — saturate the connection budget, then try one more.
    const streams = await Promise.all(
      Array.from({ length: MAX_SSE_CLIENTS }, () => fetchT(`${base}/events?token=${TEST_KEY}`))
    );
    const overflow = await fetchT(`${base}/events?token=${TEST_KEY}`);

    // Assert
    expect(streams.every((response) => response.status === 200)).toBe(true);
    expect(overflow.status).toBe(503);
    await Promise.all(streams.map((response) => response.body?.cancel()));
  });

  it("close() is idempotent and returns even with a live SSE client", async () => {
    // Arrange
    const { handle, base } = await launch(tempDir());
    const stream = await fetchT(`${base}/events?token=${TEST_KEY}`);
    expect(stream.status).toBe(200);

    // Act — two overlapping closes must both settle (SIGINT + SIGTERM case).
    await Promise.all([handle.close(), handle.close()]);

    // Assert — the server refuses new connections after close.
    await expect(fetchT(`${base}/?token=${TEST_KEY}`)).rejects.toThrow();
  });
});

describe("monitorSnapshotPayload", () => {
  it("serializes runs with bounded lane tails", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, includeChunks: true, pid: process.pid });
    sink.handleEvent(started("run-payload"));
    for (let index = 0; index < 80; index += 1) {
      sink.handleEvent({
        type: "provider/chunk",
        councilRunId: "run-payload",
        providerId: "claude",
        role: "security",
        stream: "stdout",
        text: `line-${index}\n`
      });
    }
    const state = pollMonitorState(initialMonitorState(), { dir });

    // Act
    const payload = JSON.parse(monitorSnapshotPayload(state)) as {
      runs: Array<{ lanes: Array<{ tail: string[] }> }>;
    };

    // Assert — capped at the last 50 lines for the wire.
    expect(payload.runs[0]?.lanes[0]?.tail.length).toBeLessThanOrEqual(50);
  });
});

describe("embedded page", () => {
  it("never uses innerHTML for dynamic values", () => {
    expect(MONITOR_PAGE_HTML).not.toContain("innerHTML");
  });

  it("declares a strict Content-Security-Policy", () => {
    // Deny everything by default; only the inline <script>/<style> and
    // same-origin EventSource/fetch calls the page itself makes are allowed.
    expect(MONITOR_PAGE_HTML).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" />`
    );
  });
});
