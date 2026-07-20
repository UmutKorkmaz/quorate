import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@quorate/core";
import { createLiveSpoolSink } from "../src/live-spool.js";
import { abortLiveRun, isGateLane, rerunLiveRun, runControl } from "../src/monitor-controls.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "quorate-controls-"));
}

function started(runId: string): CouncilEvent {
  return {
    type: "council/started",
    councilRunId: runId,
    mode: "review",
    subject: "controls test",
    planned: [{ providerId: "claude", role: "security", providerType: "cli" }],
    at: "2026-07-20T00:00:00.000Z"
  };
}

function verdict(runId: string): CouncilEvent {
  return {
    type: "verdict",
    councilRunId: runId,
    report: {
      verdict: "pass",
      summary: "ok",
      findings: [],
      providerResults: [],
      metadata: { degraded: false }
    } as never
  };
}

describe("isGateLane", () => {
  it("marks the deterministic gate providers", () => {
    expect(isGateLane("supply-chain")).toBe(true);
    expect(isGateLane("web3-dd")).toBe(true);
    expect(isGateLane("claude")).toBe(false);
  });
});

describe("abortLiveRun", () => {
  it("refuses unknown runs", () => {
    // Act
    const result = abortLiveRun("no-such-run", tempDir());

    // Assert
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Unknown run");
  });

  it("refuses settled runs", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, pid: process.pid });
    sink.handleEvent(started("run-done"));
    sink.handleEvent(verdict("run-done"));

    // Act
    const result = abortLiveRun("run-done", dir);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.message).toContain("only running runs");
  });

  it("refuses stale runs (dead owner pid) instead of signaling a reused pid", () => {
    // Arrange — a run owned by a pid that cannot exist.
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, pid: 2 ** 22 + 1 });
    sink.handleEvent(started("run-stale"));

    // Act — listLiveRuns inside abortLiveRun reaps it to stale first.
    const result = abortLiveRun("run-stale", dir);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.message).toContain("stale");
  });

  it("signals a live owner with SIGINT", () => {
    // Arrange — a real child process we own, recorded as the run owner.
    const dir = tempDir();
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const sink = createLiveSpoolSink({ dir, pid: child.pid });
    sink.handleEvent(started("run-live"));

    // Act
    const result = abortLiveRun("run-live", dir);

    // Assert
    expect(result.ok).toBe(true);
    expect(result.message).toContain(`pid ${child.pid}`);
    child.kill("SIGKILL");
  });
});

describe("rerunLiveRun", () => {
  it("refuses runs that are still running", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, pid: process.pid });
    sink.handleEvent(started("run-running"));

    // Act
    const result = rerunLiveRun("run-running", dir);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.message).toContain("still running");
  });

  it("refuses runs without a recorded argv", () => {
    // Arrange — settled run, then strip argv the way an old spool entry would look.
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, pid: process.pid });
    sink.handleEvent(started("run-oldmeta"));
    sink.handleEvent(verdict("run-oldmeta"));
    const metaPath = join(dir, "run-oldmeta.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    delete meta.argv;
    writeFileSync(metaPath, JSON.stringify(meta), "utf8");

    // Act
    const result = rerunLiveRun("run-oldmeta", dir);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no recorded command");
  });

  it("respawns a settled run from its recorded argv", () => {
    // Arrange — a harmless script whose path satisfies the quorate entry pin.
    const dir = tempDir();
    const scriptDir = join(dir, "dist");
    const script = join(scriptDir, "index.js");
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(script, "process.exit(0);\n", "utf8");
    const sink = createLiveSpoolSink({ dir, pid: process.pid });
    sink.handleEvent(started("run-rerun"));
    sink.handleEvent(verdict("run-rerun"));
    const metaPath = join(dir, "run-rerun.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    meta.argv = [script, "review"];
    meta.cwd = dir;
    writeFileSync(metaPath, JSON.stringify(meta), "utf8");

    // Act
    const result = rerunLiveRun("run-rerun", dir);

    // Assert
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Re-running");
  });

  it("refuses argv whose entrypoint is not a quorate script", () => {
    // Arrange — a tampered meta pointing at an arbitrary script.
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, pid: process.pid });
    sink.handleEvent(started("run-tampered"));
    sink.handleEvent(verdict("run-tampered"));
    const metaPath = join(dir, "run-tampered.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    meta.argv = ["/tmp/evil.js"];
    writeFileSync(metaPath, JSON.stringify(meta), "utf8");

    // Act
    const result = rerunLiveRun("run-tampered", dir);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.message).toContain("does not look like a Quorate invocation");
  });

  it("refuses when the original cwd no longer exists", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, pid: process.pid });
    sink.handleEvent(started("run-gonecwd"));
    sink.handleEvent(verdict("run-gonecwd"));
    const metaPath = join(dir, "run-gonecwd.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    meta.argv = ["dist/index.js", "review"];
    meta.cwd = join(dir, "deleted-repo");
    writeFileSync(metaPath, JSON.stringify(meta), "utf8");

    // Act
    const result = rerunLiveRun("run-gonecwd", dir);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.message).toContain("working directory is gone");
  });
});

describe("runControl", () => {
  it("dispatches by action", () => {
    const dir = tempDir();
    expect(runControl("abort", "missing", dir).message).toContain("Unknown run");
    expect(runControl("rerun", "missing", dir).message).toContain("Unknown run");
  });
});
