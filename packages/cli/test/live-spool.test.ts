import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CouncilEvent, CouncilReport } from "@quorate/core";
import {
  createLiveSpoolSink,
  listLiveRuns,
  liveChunksEnabled,
  liveRunFilePath,
  liveRunMetaPath,
  readRunEvents,
  sanitizeArgvForMeta,
  teeJsonStreamSink
} from "../src/live-spool.js";
import { createJsonStreamSink } from "../src/json-stream.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "quorate-live-"));
}

function startedEvent(runId: string, overrides: Partial<Extract<CouncilEvent, { type: "council/started" }>> = {}): CouncilEvent {
  return {
    type: "council/started",
    councilRunId: runId,
    mode: "review",
    subject: "Local code review",
    planned: [
      { providerId: "claude", role: "security", providerType: "cli" },
      { providerId: "heuristic", role: "maintainer", providerType: "mock" }
    ],
    at: "2026-07-18T00:00:00.000Z",
    ...overrides
  };
}

function chunkEvent(runId: string, text: string): CouncilEvent {
  return {
    type: "provider/chunk",
    councilRunId: runId,
    providerId: "claude",
    role: "security",
    stream: "stdout",
    text
  };
}

function verdictEvent(runId: string): CouncilEvent {
  return { type: "verdict", councilRunId: runId, report: report() };
}

function report(): CouncilReport {
  return {
    verdict: "pass",
    summary: "ok",
    findings: [],
    providerResults: [],
    metadata: { degraded: false }
  } as unknown as CouncilReport;
}

describe("createLiveSpoolSink event handling", () => {
  it("creates the spool file and registry entry on council/started", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, cwd: "/tmp/example-repo", pid: process.pid });

    // Act
    sink.handleEvent(startedEvent("run-1"));

    // Assert
    const runs = listLiveRuns({ dir });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: "run-1",
      status: "running",
      mode: "review",
      repo: "example-repo",
      planned: ["claude:security", "heuristic:maintainer"]
    });
    expect(readFileSync(liveRunFilePath("run-1", dir), "utf8")).toContain("council/started");
    expect(sink.lastError).toBeUndefined();
  });

  it("marks the run done on verdict and appends events in order", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, includeChunks: true });

    // Act
    sink.handleEvent(startedEvent("run-2"));
    sink.handleEvent(chunkEvent("run-2", "analyzing"));
    sink.handleEvent(verdictEvent("run-2"));

    // Assert
    expect(listLiveRuns({ dir })[0]?.status).toBe("done");
    const { events } = readRunEvents("run-2", { dir });
    expect(events.map((event) => event.type)).toEqual(["council/started", "provider/chunk", "verdict"]);
  });

  it("omits provider/chunk events unless chunks are enabled", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, includeChunks: false });

    // Act
    sink.handleEvent(startedEvent("run-3"));
    sink.handleEvent(chunkEvent("run-3", "hidden"));

    // Assert
    expect(readFileSync(liveRunFilePath("run-3", dir), "utf8")).not.toContain("provider/chunk");
  });

  it("seals the run as error via finish()", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir });
    sink.handleEvent(startedEvent("run-4"));

    // Act
    sink.finish("error");

    // Assert
    expect(listLiveRuns({ dir })[0]?.status).toBe("error");
  });

  it("never throws when the spool directory is not writable", () => {
    // Arrange — a file where the directory should be forces mkdir/appends to fail.
    const parent = tempDir();
    const dir = join(parent, "blocked");
    writeFileSync(dir, "not a directory", "utf8");
    const sink = createLiveSpoolSink({ dir });

    // Act
    sink.handleEvent(startedEvent("run-5"));
    sink.handleEvent(verdictEvent("run-5"));

    // Assert — errors are swallowed (a subscriber must never break a run) but recorded.
    expect(sink.lastError).toBeDefined();
  });
});

describe("createLiveSpoolSink as a JsonStreamSink", () => {
  it("spools NDJSON stdout lines and settles on the final report line", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir });

    // Act
    sink.writeStdout(JSON.stringify(startedEvent("run-6")));
    sink.writeStderr("Council started: review — s (2 runs)");
    sink.writeStdout(JSON.stringify(report()));

    // Assert
    const runs = listLiveRuns({ dir });
    expect(runs[0]?.status).toBe("done");
    const { events, report: settled } = readRunEvents("run-6", { dir });
    expect(events).toHaveLength(1);
    expect(settled?.verdict).toBe("pass");
    // stderr progress is never spooled
    expect(readFileSync(liveRunFilePath("run-6", dir), "utf8")).not.toContain("Council started:");
  });

  it("ignores non-JSON stdout lines instead of corrupting the spool", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir });
    sink.writeStdout(JSON.stringify(startedEvent("run-7")));

    // Act
    sink.writeStdout("not json at all");

    // Assert
    expect(readRunEvents("run-7", { dir }).events).toHaveLength(1);
    expect(sink.lastError).toBeUndefined();
  });
});

describe("teeJsonStreamSink", () => {
  it("fans stdout and stderr out to every sink", () => {
    // Arrange
    const a = createJsonStreamSink();
    const b = createJsonStreamSink();
    const tee = teeJsonStreamSink(a, b);

    // Act
    tee.writeStdout("line");
    tee.writeStderr("progress");

    // Assert
    expect(a.stdout).toEqual(["line"]);
    expect(b.stdout).toEqual(["line"]);
    expect(a.stderr).toEqual(["progress"]);
    expect(b.stderr).toEqual(["progress"]);
  });
});

describe("listLiveRuns reaping", () => {
  it("marks running entries with dead pids as stale", () => {
    // Arrange — pid 1 exists but is not ours (EPERM ⇒ alive); an absurd pid is dead.
    const dir = tempDir();
    const deadPid = 2 ** 22 + 1; // beyond pid_max on macOS/Linux defaults
    const sink = createLiveSpoolSink({ dir, pid: deadPid });
    sink.handleEvent(startedEvent("run-8"));

    // Act
    const runs = listLiveRuns({ dir });

    // Assert
    expect(runs[0]?.status).toBe("stale");
    // The reap persists in the run's own meta file.
    expect(JSON.parse(readFileSync(liveRunMetaPath("run-8", dir), "utf8")).status).toBe("stale");
  });

  it("leaves running entries owned by a live pid untouched", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir, pid: process.pid });
    sink.handleEvent(startedEvent("run-9"));

    // Act & Assert
    expect(listLiveRuns({ dir })[0]?.status).toBe("running");
  });

  it("sorts runs newest first and merges concurrent writers by runId", () => {
    // Arrange — two sinks in the same dir, as two processes would be.
    const dir = tempDir();
    const first = createLiveSpoolSink({ dir, pid: process.pid });
    const second = createLiveSpoolSink({ dir, pid: process.pid });
    first.handleEvent(startedEvent("run-a", { at: "2026-07-18T01:00:00.000Z" }));
    second.handleEvent(startedEvent("run-b", { at: "2026-07-18T02:00:00.000Z" }));
    first.handleEvent(verdictEvent("run-a"));

    // Act
    const runs = listLiveRuns({ dir });

    // Assert — both survive, newest first, statuses independent.
    expect(runs.map((run) => run.runId)).toEqual(["run-b", "run-a"]);
    expect(runs.map((run) => run.status)).toEqual(["running", "done"]);
  });
});

describe("readRunEvents tailing", () => {
  it("tolerates a trailing partial line and resumes from the returned offset", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir });
    sink.handleEvent(startedEvent("run-10"));
    const path = liveRunFilePath("run-10", dir);
    appendFileSync(path, '{"type":"provider/started","councilRunId":"run-10","providerId":"claude","ro', "utf8");

    // Act — the partial tail must not be consumed…
    const firstRead = readRunEvents("run-10", { dir });
    // …and once the writer completes the line, the tail picks it up.
    appendFileSync(path, 'le":"security","providerType":"cli","at":"now"}\n', "utf8");
    const secondRead = readRunEvents("run-10", { dir, fromOffset: firstRead.offset });

    // Assert
    expect(firstRead.events.map((event) => event.type)).toEqual(["council/started"]);
    expect(secondRead.events.map((event) => event.type)).toEqual(["provider/started"]);
  });

  it("skips malformed complete lines and returns empty for missing files", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir });
    sink.handleEvent(startedEvent("run-11"));
    appendFileSync(liveRunFilePath("run-11", dir), "garbage-line\n", "utf8");
    sink.handleEvent(verdictEvent("run-11"));

    // Act
    const tail = readRunEvents("run-11", { dir });
    const missing = readRunEvents("no-such-run", { dir });

    // Assert
    expect(tail.events.map((event) => event.type)).toEqual(["council/started", "verdict"]);
    expect(missing.events).toEqual([]);
    expect(missing.offset).toBe(0);
  });
});

describe("safety hardening", () => {
  it("rejects path-traversal run ids instead of writing outside the spool dir", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir });

    // Act — a hostile councilRunId must not become a path segment.
    sink.handleEvent(startedEvent("../escape"));

    // Assert
    expect(sink.lastError?.message).toContain("Unsafe live run id");
    expect(listLiveRuns({ dir })).toHaveLength(0);
    expect(() => liveRunFilePath("../escape", dir)).toThrow(/Unsafe live run id/);
  });

  it("resets the tail offset when the spool file shrank under the reader", () => {
    // Arrange
    const dir = tempDir();
    const sink = createLiveSpoolSink({ dir });
    sink.handleEvent(startedEvent("run-12"));
    const grown = readRunEvents("run-12", { dir });
    writeFileSync(liveRunFilePath("run-12", dir), `${JSON.stringify(verdictEvent("run-12"))}\n`, "utf8");

    // Act — pass the now-too-large offset against the truncated file.
    const reread = readRunEvents("run-12", { dir, fromOffset: grown.offset + 10_000 });

    // Assert — the reader clamps to the real size and keeps working.
    expect(reread.events.map((event) => event.type)).toEqual(["verdict"]);
  });
});

describe("sanitizeArgvForMeta", () => {
  it("withholds argv entirely when any element looks secret-bearing", () => {
    expect(sanitizeArgvForMeta(["dist/index.js", "review", "--api-key", "sk-123"])).toBeUndefined();
    expect(sanitizeArgvForMeta(["dist/index.js", "review", "--token=abc"])).toBeUndefined();
    expect(sanitizeArgvForMeta(["dist/index.js", "review", "--base", "main"])).toEqual([
      "dist/index.js",
      "review",
      "--base",
      "main"
    ]);
  });
});

describe("liveChunksEnabled", () => {
  it("honors the QUORATE_JSON_CHUNKS gate values", () => {
    expect(liveChunksEnabled({ QUORATE_JSON_CHUNKS: "1" })).toBe(true);
    expect(liveChunksEnabled({ QUORATE_JSON_CHUNKS: "true" })).toBe(true);
    expect(liveChunksEnabled({ QUORATE_JSON_CHUNKS: "0" })).toBe(false);
    expect(liveChunksEnabled({})).toBe(false);
  });
});
