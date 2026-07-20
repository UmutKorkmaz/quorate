import { mkdtempSync } from "node:fs";
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

async function launch(dir: string, token = "test-token"): Promise<{ handle: MonitorServerHandle; base: string }> {
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
    const page = await fetch(`${base}/`);
    const events = await fetch(`${base}/events`);

    // Assert
    expect(page.status).toBe(401);
    expect(events.status).toBe(401);
  });

  it("rejects a wrong token and accepts the right one", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act
    const wrong = await fetch(`${base}/?token=nope`);
    const right = await fetch(`${base}/?token=test-token`);
    const body = await right.text();

    // Assert
    expect(wrong.status).toBe(401);
    expect(right.status).toBe(200);
    expect(right.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("Quorate monitor");
  });

  it("rejects non-GET methods", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act
    const post = await fetch(`${base}/?token=test-token`, { method: "POST" });

    // Assert
    expect(post.status).toBe(405);
  });

  it("404s unknown paths — there is no filesystem serving at all", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act — a classic traversal probe (encoded so the URL parser keeps it in the path).
    const traversal = await fetch(`${base}/..%2f..%2f..%2fetc%2fpasswd?token=test-token`);

    // Assert
    expect(traversal.status).toBe(404);
  });

  it("sets the security headers on every response", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act
    const response = await fetch(`${base}/?token=test-token`);

    // Assert
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
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
    const response = await fetch(`${base}/events?token=test-token`);
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

describe("monitor SSE limits and lifecycle", () => {
  it("caps concurrent SSE clients at MAX_SSE_CLIENTS with a 503", async () => {
    // Arrange
    const { base } = await launch(tempDir());

    // Act — saturate the connection budget, then try one more.
    const streams = await Promise.all(
      Array.from({ length: MAX_SSE_CLIENTS }, () => fetch(`${base}/events?token=test-token`))
    );
    const overflow = await fetch(`${base}/events?token=test-token`);

    // Assert
    expect(streams.every((response) => response.status === 200)).toBe(true);
    expect(overflow.status).toBe(503);
    await Promise.all(streams.map((response) => response.body?.cancel()));
  });

  it("close() is idempotent and returns even with a live SSE client", async () => {
    // Arrange
    const { handle, base } = await launch(tempDir());
    const stream = await fetch(`${base}/events?token=test-token`);
    expect(stream.status).toBe(200);

    // Act — two overlapping closes must both settle (SIGINT + SIGTERM case).
    await Promise.all([handle.close(), handle.close()]);

    // Assert — the server refuses new connections after close.
    await expect(fetch(`${base}/?token=test-token`)).rejects.toThrow();
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
});
