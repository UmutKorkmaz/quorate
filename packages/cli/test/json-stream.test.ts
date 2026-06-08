import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "@quorate/core";
import {
  councilEventToNdjsonLine,
  councilReportNdjsonLine,
  createJsonStreamSink,
  finalizeJsonStream,
  formatJsonStreamProgress,
  handleCouncilEvent,
  isCouncilReportLine,
  runCouncilJsonStream
} from "../src/json-stream.js";

const riskyDiff = `diff --git a/src/example.test.ts b/src/example.test.ts
--- a/src/example.test.ts
+++ b/src/example.test.ts
@@ -1,3 +1,5 @@
+const apiKey = "sk-example-secret-value";
+test.only("focused", () => {});
`;

describe("formatJsonStreamProgress and councilEventToNdjsonLine", () => {
  it("maps council events to stderr progress and stdout NDJSON (skipping chunks)", () => {
    const started = {
      type: "council/started" as const,
      councilRunId: "run-1",
      mode: "review" as const,
      subject: "Local code review",
      planned: [{ providerId: "heuristic", role: "maintainer", providerType: "mock" as const }],
      at: "now"
    };
    const chunk = {
      type: "provider/chunk" as const,
      councilRunId: "run-1",
      providerId: "heuristic",
      role: "maintainer",
      stream: "stdout" as const,
      text: "partial"
    };

    expect(formatJsonStreamProgress(started)).toContain("Council started: review");
    expect(councilEventToNdjsonLine(started)).toBe(JSON.stringify(started));
    expect(councilEventToNdjsonLine(chunk)).toBeNull();
  });
});

describe("handleCouncilEvent and finalizeJsonStream", () => {
  it("collects stdout/stderr lines in the test sink", () => {
    const sink = createJsonStreamSink();
    const started = {
      type: "council/started" as const,
      councilRunId: "run-1",
      mode: "review" as const,
      subject: "s",
      planned: [],
      at: "now"
    };

    handleCouncilEvent(started, sink);
    expect(sink.stderr).toHaveLength(1);
    expect(sink.stdout).toHaveLength(1);

    const report = {
      verdict: "pass" as const,
      summary: "ok",
      findings: [],
      providerResults: [],
      metadata: {
        generatedAt: "now",
        mode: "review" as const,
        subject: "s",
        providers: [],
        requestedProviders: [],
        ranProviders: [],
        degraded: false
      }
    };
    finalizeJsonStream(report, sink);
    expect(sink.stdout.at(-1)).toBe(councilReportNdjsonLine(report));
    expect(isCouncilReportLine(sink.stdout.at(-1)!)).toBe(true);
    expect(isCouncilReportLine('{"type":"council/started"}')).toBe(false);
  });
});

describe("runCouncilJsonStream", () => {
  it("streams NDJSON events and ends with the council report JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-json-stream-"));
    const diffPath = join(dir, "sample.diff");
    writeFileSync(diffPath, riskyDiff, "utf8");

    const { report, output } = await runCouncilJsonStream(
      {
        mode: "review",
        subject: "JSON stream smoke",
        diff: riskyDiff,
        repoPath: dir
      },
      createDefaultConfig([])
    );

    expect(report.verdict).toBe("fail");
    expect(output.stderr.some((line) => line.includes("Council started"))).toBe(true);
    expect(output.stdout.length).toBeGreaterThan(0);

    const parsedEvents = output.stdout
      .slice(0, -1)
      .map((line) => JSON.parse(line) as { type: string });
    expect(parsedEvents.some((event) => event.type === "council/started")).toBe(true);
    expect(parsedEvents.every((event) => event.type !== "provider/chunk")).toBe(true);

    const finalLine = output.stdout.at(-1)!;
    expect(isCouncilReportLine(finalLine)).toBe(true);
    const finalReport = JSON.parse(finalLine) as { verdict: string; summary: string };
    expect(finalReport.verdict).toBe(report.verdict);
    expect(finalReport.summary).toBe(report.summary);
  });
});