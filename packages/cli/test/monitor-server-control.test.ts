import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditDirForLiveDir, createLiveSpoolSink, listPendingApprovals, readMonitorDiscovery, writeApprovalRequest } from "../src/live-spool.js";
import { exportApprovalAuditRecords } from "../src/trust-ledger.js";
import {
  createMonitorServer,
  listenMonitorServer,
  monitorSnapshotPayload,
  type MonitorServerHandle
} from "../src/monitor-server.js";
import { initialMonitorState, pollMonitorState } from "../src/tui/monitor-state.js";
import type { ExternalAgent } from "../src/agent-scan.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "quorate-control-"));
}

const TEST_KEY = "control-test-token";

function fetchT(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
}

const handles: MonitorServerHandle[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close().catch(() => undefined)));
});

async function launch(dir: string, scan?: () => ExternalAgent[]): Promise<{ handle: MonitorServerHandle; base: string }> {
  const handle = createMonitorServer({ dir, token: TEST_KEY, intervalMs: 50, scan });
  handles.push(handle);
  const url = await listenMonitorServer(handle);
  return { handle, base: url.split("/?")[0] as string };
}

async function post(base: string, body: unknown): Promise<{ status: number; json: { ok: boolean; message: string } }> {
  const response = await fetchT(`${base}/control?token=${TEST_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
  return { status: response.status, json: (await response.json()) as { ok: boolean; message: string } };
}

describe("POST /control approvals + jump", () => {
  it("approves a pending approval and clears it from the pending list", async () => {
    // Arrange
    const dir = tempDir();
    const future = new Date(Date.now() + 60_000).toISOString();
    writeApprovalRequest(
      { id: "ap-1", runId: "claude-sess", source: "claude", toolName: "Bash", summary: "ls", cwd: "/r", createdAt: new Date().toISOString(), expiresAt: future },
      dir
    );
    const { base } = await launch(dir);

    // Act
    const result = await post(base, { action: "approve", id: "ap-1" });

    // Assert
    expect(result.status).toBe(200);
    expect(result.json.ok).toBe(true);
    expect(listPendingApprovals(dir)).toHaveLength(0);
  });

  it("returns 409 when no pending approval matches the id", async () => {
    const { base } = await launch(tempDir());
    const result = await post(base, { action: "deny", id: "missing" });
    expect(result.status).toBe(409);
    expect(result.json.ok).toBe(false);
  });

  it("maps a free-form web denial reason to the closed safe reason code", async () => {
    const dir = tempDir();
    const now = new Date();
    writeApprovalRequest({
      id: "ap-deny-safe", runId: "run-safe", source: "claude", toolName: "Bash", summary: "ls", cwd: "/r",
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString()
    }, dir);
    const { base } = await launch(dir);

    const result = await post(base, { action: "deny", id: "ap-deny-safe", reason: "Basic c2VjcmV0OnBhc3N3b3Jk" });

    expect(result.status).toBe(200);
    const raw = exportApprovalAuditRecords({ dir: auditDirForLiveDir(dir), format: "json" });
    expect(raw).not.toContain("c2VjcmV0");
    expect(JSON.parse(raw)[0]).toMatchObject({ decision: "deny", reasonCode: "user-denied" });
  });

  it("rejects malformed approval ids at 400", async () => {
    const { base } = await launch(tempDir());
    const result = await post(base, { action: "approve", id: "../x" });
    expect(result.status).toBe(400);
  });

  it("validates the action allowlist (approve/deny/jump + abort/rerun)", async () => {
    const { base } = await launch(tempDir());
    const result = await post(base, { action: "explode", id: "ap-1" });
    expect(result.status).toBe(400);
  });
});

describe("SSE payload includes approvals, external, stats, source, kind", () => {
  it("renders approvals + external + stats top-level keys", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, pid: process.pid });
    sink.handleEvent({
      type: "council/started",
      councilRunId: "run-x",
      mode: "review",
      subject: "payload test",
      planned: [{ providerId: "claude", role: "security", providerType: "cli" }],
      at: new Date().toISOString()
    });
    const future = new Date(Date.now() + 60_000).toISOString();
    writeApprovalRequest(
      { id: "ap-2", runId: "run-x", source: "claude", toolName: "Edit", summary: "/file", cwd: "/r", createdAt: new Date().toISOString(), expiresAt: future },
      dir
    );
    const state = pollMonitorState(initialMonitorState(), { dir, scan: () => [{ pid: 1, name: "claude", etime: "1:00", command: "claude" }] });

    // Act
    const payload = JSON.parse(monitorSnapshotPayload(state, { dir, scan: () => [] })) as Record<string, unknown>;

    // Assert
    expect(Array.isArray(payload.approvals)).toBe(true);
    expect((payload.approvals as Array<unknown>).length).toBe(1);
    expect(Array.isArray(payload.external)).toBe(true);
    expect(payload.stats).toBeDefined();
    expect((payload.runs as Array<{ source?: string; kind?: string }>).length).toBeGreaterThan(0);
  });
});

describe("discovery file lifecycle", () => {
  it("writes monitor.json on listen and removes it on close", async () => {
    // Arrange
    const dir = tempDir();
    expect(readMonitorDiscovery(dir)).toBeUndefined();

    // Act — listen writes; close removes.
    const { handle } = await launch(dir);
    expect(readMonitorDiscovery(dir)?.token).toBe(TEST_KEY);
    await handle.close();

    // Assert
    expect(readMonitorDiscovery(dir)).toBeUndefined();
  });
});
