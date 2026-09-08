import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateManifest } from "../src/evaluation-command.js";
import { buildProgram } from "../src/index.js";

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "quorate-evaluation-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks(); });

function saved(name: string, fingerprints: string[], providers: number, extra: Record<string, unknown> = {}): string {
  const path = `${name}.json`;
  writeFileSync(join(directory, path), JSON.stringify({
    verdict: "warn", summary: "Fixture report", findings: fingerprints.map((fingerprint) => ({ fingerprint })),
    providerResults: providers === 0 ? [{ providerId: "heuristic", providerType: "mock", status: "ok" }]
      : Array.from({ length: providers }, (_, index) => ({ providerId: `provider-${index}`, providerType: "api", status: "ok" })),
    metadata: { reviewId: name, generatedAt: "2026-09-08T12:00:00Z", degraded: false, durationMs: 100, ...extra }
  }));
  return path;
}

function manifest(cases: unknown[]): string {
  const path = join(directory, "manifest.json");
  writeFileSync(path, JSON.stringify({ schema: 1, cases }));
  return path;
}

describe("saved report evaluation", () => {
  it("compares paired variants using issue-level recall and penalizes duplicate reports of the same issue", () => {
    const path = manifest([{ id: "same-change", expectedIssueIds: ["issue-a", "issue-b"], runs: [
      { variant: "deterministic", report: saved("det", ["a"], 0), labels: { a: "issue-a" } },
      { variant: "single", report: saved("single", ["a", "noise"], 1), labels: { a: "issue-a", noise: null } },
      { variant: "council", report: saved("council", ["a", "b", "duplicate"], 2), labels: { a: "issue-a", b: "issue-b", duplicate: "issue-a" } }
    ] }]);
    const report = evaluateManifest(path);
    expect(report.variants[0]).toMatchObject({ variant: "deterministic", truePositives: 1, falseNegatives: 1, precision: 1, recall: 0.5 });
    expect(report.variants[1]).toMatchObject({ variant: "single", falsePositives: 1, precision: 0.5, recall: 0.5 });
    expect(report.variants[2]).toMatchObject({ variant: "council", duplicates: 1, precision: 2 / 3, recall: 1, medianDurationMs: 100, estimatedInputCostUsd: null });
    expect(report.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.limitations.join(" ")).toContain("not a live provider benchmark");
  });

  it("keeps incomplete labels, absent truth, unrecorded duration, and partial pricing unknown", () => {
    const reportPath = saved("partial", ["a"], 1, { durationMs: undefined, budget: { estimatedInputCostUsd: 0.1, providerEstimates: [{ inputCostUsd: 0.1 }, {}] } });
    let result = evaluateManifest(manifest([{ id: "case", expectedIssueIds: ["issue"], runs: [{ variant: "single", report: reportPath }] }]));
    expect(result.variants[0]).toMatchObject({ precision: null, recall: null, falseNegatives: null, labeledRuns: 0, medianDurationMs: null, estimatedInputCostUsd: null });
    result = evaluateManifest(manifest([{ id: "case", runs: [{ variant: "single", report: reportPath, labels: { a: "issue" } }] }]));
    expect(result.variants[0]).toMatchObject({ precision: null, recall: null });
  });

  it("requires paired cases and report evidence matching the declared variant", () => {
    const det = { variant: "deterministic", report: saved("det", [], 0), labels: {} };
    const single = { variant: "single", report: saved("single", [], 1), labels: {} };
    expect(() => evaluateManifest(manifest([{ id: "one", expectedIssueIds: [], runs: [det, single] }, { id: "two", expectedIssueIds: [], runs: [det] }]))).toThrow(/same variants/);
    expect(() => evaluateManifest(manifest([{ id: "one", runs: [{ ...det, variant: "council" }] }]))).toThrow(/provider evidence/);
  });

  it("rejects labels for nonexistent findings or unexpected issues and ambiguous fingerprints", () => {
    const report = saved("single", ["a"], 1);
    const input = { id: "case", expectedIssueIds: ["issue"], runs: [{ variant: "single", report, labels: { absent: "issue" } }] };
    expect(() => evaluateManifest(manifest([input]))).toThrow(/not a finding/);
    input.runs[0].labels = { a: "other-issue" } as typeof input.runs[0]["labels"];
    expect(() => evaluateManifest(manifest([input]))).toThrow(/unknown expected issue/);
    input.runs[0].report = saved("duplicate", ["a", "a"], 1);
    expect(() => evaluateManifest(manifest([input]))).toThrow(/Duplicate finding/);
  });

  it("exposes evaluation JSON without starting any providers", async () => {
    const path = manifest([{ id: "case", expectedIssueIds: [], runs: [{ variant: "deterministic", report: saved("clean", [], 0), labels: {} }] }]);
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value) => { output.push(String(value)); });
    await buildProgram().parseAsync(["node", "quorate", "evaluate", path, "--json"], { from: "node" });
    expect(JSON.parse(output.join("\n"))).toMatchObject({ kind: "saved-report-evaluation", cases: 1 });
  });
});
