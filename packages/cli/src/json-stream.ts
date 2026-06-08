import type { CouncilEvent, CouncilReport, CouncilRequest, QuorateConfig } from "@quorate/core";
import { runCouncil } from "@quorate/core";

/** Human-readable progress for stderr while stdout carries NDJSON only. */
export function formatJsonStreamProgress(event: CouncilEvent): string | undefined {
  switch (event.type) {
    case "council/started":
      return `Council started: ${event.mode} — ${event.subject} (${event.planned.length} run${event.planned.length === 1 ? "" : "s"})`;
    case "provider/started":
      return `  ${event.providerId}:${event.role} started`;
    case "provider/done": {
      const count = event.result.findings.length;
      const detail =
        event.result.status === "ok"
          ? `${count} finding${count === 1 ? "" : "s"}`
          : event.result.status;
      return `  ${event.providerId}:${event.role} ${detail}`;
    }
    case "verdict":
      return `Verdict: ${event.report.verdict.toUpperCase()}${event.report.metadata.degraded ? " (degraded)" : ""}`;
    default:
      return undefined;
  }
}

/** NDJSON line for stdout. Provider chunks are omitted to keep stdout machine-parseable. */
export function councilEventToNdjsonLine(event: CouncilEvent): string | null {
  if (event.type === "provider/chunk" || event.type === "council/done") {
    return null;
  }
  return JSON.stringify(event);
}

export function councilReportNdjsonLine(report: CouncilReport): string {
  return JSON.stringify(report);
}

export interface JsonStreamSink {
  writeStdout(line: string): void;
  writeStderr(line: string): void;
}

export interface JsonStreamOutput {
  stdout: string[];
  stderr: string[];
}

export function createJsonStreamSink(): JsonStreamSink & JsonStreamOutput {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    writeStdout(line: string) {
      stdout.push(line);
    },
    writeStderr(line: string) {
      stderr.push(line);
    }
  };
}

export function handleCouncilEvent(event: CouncilEvent, sink: JsonStreamSink): void {
  const progress = formatJsonStreamProgress(event);
  if (progress) sink.writeStderr(progress);
  const line = councilEventToNdjsonLine(event);
  if (line) sink.writeStdout(line);
}

export function finalizeJsonStream(report: CouncilReport, sink: JsonStreamSink): void {
  sink.writeStdout(councilReportNdjsonLine(report));
}

export async function runCouncilWithJsonStream(
  request: CouncilRequest,
  config: QuorateConfig,
  sink: JsonStreamSink
): Promise<CouncilReport> {
  const report = await runCouncil(request, config, {
    onEvent: (event) => handleCouncilEvent(event, sink)
  });
  finalizeJsonStream(report, sink);
  return report;
}

export async function runCouncilJsonStream(
  request: CouncilRequest,
  config: QuorateConfig
): Promise<{ report: CouncilReport; output: JsonStreamOutput }> {
  const sink = createJsonStreamSink();
  const report = await runCouncilWithJsonStream(request, config, sink);
  return { report, output: { stdout: sink.stdout, stderr: sink.stderr } };
}

export function isCouncilReportLine(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    return (
      typeof parsed.verdict === "string" &&
      typeof parsed.summary === "string" &&
      Array.isArray(parsed.findings) &&
      Array.isArray(parsed.providerResults) &&
      parsed.metadata !== null &&
      typeof parsed.metadata === "object"
    );
  } catch {
    return false;
  }
}