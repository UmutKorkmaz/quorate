import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { historyPath } from "../src/history-command.js";
import { runProof } from "../src/proof-runner.js";
import { appendApprovalAuditRecord, type ApprovalAuditDecision } from "../src/trust-ledger.js";
import { collectMetrics, renderMetrics, runMetrics, type MetricsReport } from "../src/metrics-command.js";

const originalHome = process.env.HOME;
const originalProofKeyDir = process.env.QUORATE_PROOF_KEY_DIR;
const proofKeyDir = mkdtempSync(join(tmpdir(), "quorate-metrics-key-"));
process.env.QUORATE_PROOF_KEY_DIR = proofKeyDir;

let home: string;
const workdirs: string[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "quorate-metrics-home-"));
  process.env.HOME = home;
});

afterEach(() => {
  for (const dir of workdirs.splice(0)) {
    rmSync(historyPath(dir), { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(home, { recursive: true, force: true });
  process.env.HOME = originalHome;
});

afterAll(() => {
  if (originalProofKeyDir === undefined) delete process.env.QUORATE_PROOF_KEY_DIR;
  else process.env.QUORATE_PROOF_KEY_DIR = originalProofKeyDir;
  rmSync(proofKeyDir, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "quorate-metrics-"));
  workdirs.push(root);
  return root;
}

function historyEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generatedAt: "2026-08-01T00:00:00.000Z",
    verdict: "pass",
    degraded: false,
    mode: "review",
    subject: "PR #1",
    providers: ["glm:security"],
    findingCounts: {},
    byFile: {},
    byTitle: {},
    providerResults: [],
    ...overrides
  };
}

function writeHistory(cwd: string, lines: Array<Record<string, unknown> | string>): void {
  const path = historyPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n")}\n`, "utf8");
}

function contractArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    verdict: "warn",
    counts: { breaking: 1, ambiguous: 2, additive: 3 },
    findings: [{ rule: "removed-operation" }, { rule: "newly-required-field" }],
    before: { label: "base", hash: "a".repeat(64) },
    after: { label: "head", hash: "b".repeat(64) },
    artifactHash: "c".repeat(64),
    createdAt: "2026-08-14T00:00:00.000Z",
    ...overrides
  };
}

function writeContract(cwd: string, artifact: Record<string, unknown>): void {
  const dir = join(cwd, ".quorate", "contract");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function approval(decision: ApprovalAuditDecision, sequence: number) {
  return {
    requestId: `req-${sequence}`,
    runId: "run-1",
    source: "convoke",
    tool: "Bash",
    decision,
    decisionSurface: "tui",
    timestamp: new Date(Date.UTC(2026, 7, 14, 0, 0, sequence)).toISOString()
  };
}

function stripGeneratedAt(report: MetricsReport): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
  delete copy.generatedAt;
  return copy;
}

describe("quorate metrics", () => {
  it("returns a valid all-zero report when every store is empty", async () => {
    const cwd = workspace();
    const report = await collectMetrics({ cwd });

    expect(report.schema).toBe(1);
    expect(report.cwd).toBe(cwd);
    expect(report.history).toEqual({
      runs: 0,
      verdictCounts: { pass: 0, warn: 0, fail: 0 },
      degradedRuns: 0,
      findingCounts: {},
      totalFindings: 0,
      medianDurationMs: null,
      medianCouncilAgreement: null,
      providerFailureRates: []
    });
    expect(report.approvals).toEqual({
      verified: true,
      records: 0,
      decisions: { allow: 0, deny: 0, timeout: 0 }
    });
    expect(report.proofs).toBeUndefined();
    expect(report.contract).toBeUndefined();

    const text = renderMetrics(report);
    expect(text).toContain("0 pass · 0 warn · 0 fail");
    expect(text).not.toContain("Median");
    expect(text).not.toContain("Error");

    const run = await runMetrics({ cwd, json: true });
    expect(run.exitCode).toBe(0);
    const parsed = JSON.parse(run.output) as MetricsReport;
    expect(parsed.history.runs).toBe(0);
    expect(parsed.approvals.records).toBe(0);
    expect(parsed.proofs).toBeUndefined();
    expect(parsed.contract).toBeUndefined();
  });

  it("aggregates verdict distribution, findings, medians, and provider reliability", async () => {
    const cwd = workspace();
    writeHistory(cwd, [
      "{ definitely not json",
      historyEntry({ generatedAt: "2026-08-01T00:00:00.000Z", verdict: "banana" }),
      historyEntry({
        generatedAt: "2026-08-01T00:00:00.000Z",
        verdict: "pass",
        durationMs: 1000,
        agreement: 0.5,
        findingCounts: { critical: 2, high: 1 },
        providerResults: [{ providerId: "glm", status: "ok" }]
      }),
      historyEntry({
        generatedAt: "2026-08-02T00:00:00.000Z",
        verdict: "warn",
        degraded: true,
        durationMs: 2000,
        agreement: 0.75,
        findingCounts: { high: 2 },
        providerResults: [
          { providerId: "glm", status: "ok" },
          { providerId: "codex", status: "error" }
        ]
      }),
      historyEntry({
        generatedAt: "2026-08-03T00:00:00.000Z",
        verdict: "fail",
        durationMs: 3000,
        agreement: 1,
        findingCounts: { low: 4 },
        providerResults: [{ providerId: "glm", status: "ok" }]
      })
    ]);

    const report = await collectMetrics({ cwd });
    expect(report.history).toEqual({
      runs: 3,
      verdictCounts: { pass: 1, warn: 1, fail: 1 },
      degradedRuns: 1,
      findingCounts: { critical: 2, high: 3, low: 4 },
      totalFindings: 9,
      medianDurationMs: 2000,
      medianCouncilAgreement: 0.75,
      providerFailureRates: [
        { providerId: "glm", runs: 3, failures: 0 },
        { providerId: "codex", runs: 1, failures: 1 }
      ]
    });
  });

  it("averages the middle pair for even history samples", async () => {
    const cwd = workspace();
    writeHistory(cwd, [
      historyEntry({ generatedAt: "2026-08-01T00:00:00.000Z", durationMs: 1000, agreement: 0.4 }),
      historyEntry({ generatedAt: "2026-08-02T00:00:00.000Z", durationMs: 3000, agreement: 0.8 })
    ]);
    const report = await collectMetrics({ cwd });
    expect(report.history.medianDurationMs).toBe(2000);
    expect(report.history.medianCouncilAgreement).toBeCloseTo(0.6);
  });

  it("aggregates the proof pass rate from signed artifacts", async () => {
    const passing = workspace();
    await runProof({ cwd: passing, name: "metrics-pass", command: [process.execPath, "-e", ""] });
    const report = await collectMetrics({ cwd: passing });
    expect(report.proofs).toMatchObject({
      name: "metrics-pass",
      passed: true,
      exitCode: 0,
      timedOut: false,
      artifacts: 1,
      passRate: 1
    });
    expect(typeof report.proofs?.finishedAt).toBe("string");
    expect(typeof report.proofs?.durationMs).toBe("number");

    const failing = workspace();
    await runProof({ cwd: failing, name: "metrics-fail", command: [process.execPath, "-e", "process.exit(3)"] });
    const failed = await collectMetrics({ cwd: failing });
    expect(failed.proofs).toMatchObject({ passed: false, exitCode: 3, passRate: 0 });
  });

  it("ignores malformed proof artifacts", async () => {
    const cwd = workspace();
    const dir = join(cwd, ".quorate", "proofs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "latest.json"), "{ definitely not json");
    const report = await collectMetrics({ cwd });
    expect(report.proofs).toBeUndefined();
  });

  it("aggregates the latest contract artifact", async () => {
    const cwd = workspace();
    writeContract(cwd, contractArtifact());
    const report = await collectMetrics({ cwd });
    expect(report.contract).toEqual({
      verdict: "warn",
      counts: { breaking: 1, ambiguous: 2, additive: 3 },
      findings: 2,
      before: { label: "base", hash: "a".repeat(64) },
      after: { label: "head", hash: "b".repeat(64) },
      artifactHash: "c".repeat(64),
      createdAt: "2026-08-14T00:00:00.000Z"
    });
  });

  it("ignores malformed contract artifacts", async () => {
    const cwd = workspace();
    const dir = join(cwd, ".quorate", "contract");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "latest.json"), "{ definitely not json");
    const absent = await collectMetrics({ cwd });
    expect(absent.contract).toBeUndefined();

    writeContract(cwd, contractArtifact({ schema: 2 }));
    const wrongSchema = await collectMetrics({ cwd });
    expect(wrongSchema.contract).toBeUndefined();
  });

  it("aggregates verified approval decisions from the trust ledger", async () => {
    const dir = join(home, ".quorate", "audit");
    appendApprovalAuditRecord(approval("allow", 1), { dir });
    appendApprovalAuditRecord(approval("allow", 2), { dir });
    appendApprovalAuditRecord(approval("deny", 3), { dir });
    appendApprovalAuditRecord(approval("timeout", 4), { dir });

    const report = await collectMetrics({ cwd: workspace() });
    expect(report.approvals).toEqual({
      verified: true,
      records: 4,
      decisions: { allow: 2, deny: 1, timeout: 1 }
    });
  });

  it("withholds counts when the ledger fails verification", async () => {
    const dir = join(home, ".quorate", "audit");
    appendApprovalAuditRecord(approval("allow", 1), { dir });
    appendApprovalAuditRecord(approval("deny", 2), { dir });
    const ledger = join(dir, "approvals.jsonl");
    writeFileSync(ledger, readFileSync(ledger, "utf8").replace('"decision":"allow"', '"decision":"deny"'));

    const report = await collectMetrics({ cwd: workspace() });
    expect(report.approvals.verified).toBe(false);
    expect(report.approvals.records).toBe(0);
    expect(report.approvals.decisions).toEqual({ allow: 0, deny: 0, timeout: 0 });
    expect(typeof report.approvals.note).toBe("string");
    expect(renderMetrics(report)).toContain("ledger unverified");
  });

  it("round-trips the JSON output", async () => {
    const cwd = workspace();
    writeHistory(cwd, [historyEntry({ verdict: "fail", durationMs: 1500, agreement: 0.5, findingCounts: { high: 1 } })]);
    writeContract(cwd, contractArtifact());
    await runProof({ cwd, name: "round-trip", command: [process.execPath, "-e", ""] });

    const report = await collectMetrics({ cwd });
    const run = await runMetrics({ cwd, json: true });
    expect(run.exitCode).toBe(0);
    expect(run.output.endsWith("\n")).toBe(true);
    const parsed = stripGeneratedAt(JSON.parse(run.output) as MetricsReport);
    expect(parsed).toEqual(stripGeneratedAt(report));
  });

  it("renders a terse human summary across every section", async () => {
    const cwd = workspace();
    writeHistory(cwd, [
      historyEntry({
        verdict: "warn",
        degraded: true,
        durationMs: 2000,
        agreement: 0.75,
        findingCounts: { high: 3 },
        providerResults: [{ providerId: "glm", status: "ok" }]
      })
    ]);
    writeContract(cwd, contractArtifact());
    await runProof({ cwd, name: "render-proof", command: [process.execPath, "-e", ""] });

    const text = renderMetrics(await collectMetrics({ cwd }));
    expect(text).toContain("1 review on record (1 degraded)");
    expect(text).toContain("Verdicts: 0 pass · 1 warn · 0 fail");
    expect(text).toContain("3 total");
    expect(text).toContain("Median duration: 2000 ms");
    expect(text).toContain("Median council agreement: 75%");
    expect(text).toContain("render-proof: passed — exit 0");
    expect(text).toContain("warn — 1 breaking · 2 ambiguous · 3 additive");
  });
});
