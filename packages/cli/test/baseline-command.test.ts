import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseBaseline, type CouncilReport, type Finding } from "@quorate/core";

import { applyBaselineToReport, loadBaseline, writeBaselineFromReport } from "../src/baseline-command.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "quorate-baseline-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function finding(overrides: Partial<Finding> = {}): Finding {
  return { severity: "high", title: "Hardcoded key", body: "x", ...overrides };
}

function report(findings: Finding[], overrides: Partial<CouncilReport["metadata"]> = {}): CouncilReport {
  return {
    verdict: "fail",
    summary: "x",
    findings,
    providerResults: [
      { providerId: "glm", role: "security", providerType: "api", status: "ok", summary: "ok", findings, durationMs: 1 }
    ],
    metadata: {
      generatedAt: "2026-06-13T00:00:00.000Z",
      mode: "review",
      subject: "PR #1",
      providers: ["glm:security"],
      requestedProviders: ["glm:security"],
      ranProviders: ["glm:security"],
      degraded: false,
      ...overrides
    }
  };
}

function writeLastReport(r: CouncilReport): void {
  mkdirSync(resolve(dir, ".quorate"), { recursive: true });
  writeFileSync(resolve(dir, ".quorate", "last-report.json"), JSON.stringify(r), "utf8");
}

describe("writeBaselineFromReport", () => {
  it("writes a committed baseline from the last report", () => {
    writeLastReport(report([finding({ file: "a.ts" }), finding({ title: "Other", file: "b.ts" })]));
    const result = writeBaselineFromReport({ cwd: dir });
    expect(result.count).toBe(2);
    expect(result.overwritten).toBe(false);
    const store = parseBaseline(readFileSync(result.path, "utf8"));
    expect(store.findings).toHaveLength(2);
  });

  it("refuses to overwrite an existing baseline without --update", () => {
    writeLastReport(report([finding({ file: "a.ts" })]));
    writeBaselineFromReport({ cwd: dir });
    expect(() => writeBaselineFromReport({ cwd: dir })).toThrow(/already exists/i);
    const result = writeBaselineFromReport({ cwd: dir, update: true });
    expect(result.overwritten).toBe(true);
  });

  it("errors clearly when there is no report to baseline from", () => {
    expect(() => writeBaselineFromReport({ cwd: dir })).toThrow(/No report found/i);
  });
});

describe("applyBaselineToReport", () => {
  it("suppresses baselined findings and flips a fail to pass", () => {
    const known = finding({ severity: "critical", title: "Known crit", file: "a.ts" });
    writeLastReport(report([known]));
    writeBaselineFromReport({ cwd: dir });

    const fresh = report([known]); // same finding shows up again on a later run
    const applied = applyBaselineToReport(fresh, dir);
    expect(applied.report.verdict).toBe("pass");
    expect(applied.report.metadata.baselinedFindings).toBe(1);
    expect(applied.notes.join(" ")).toMatch(/suppressed 1/i);
  });

  it("soft no-ops with a note when no baseline file exists", () => {
    const applied = applyBaselineToReport(report([finding()]), dir);
    expect(applied.report.verdict).toBe("fail");
    expect(applied.notes.join(" ")).toMatch(/No baseline found/i);
  });

  it("warns when the baseline is past its expiry but still applies it", () => {
    const known = finding({ severity: "critical", file: "a.ts" });
    writeLastReport(report([known]));
    writeBaselineFromReport({ cwd: dir, expiresDays: 30 });
    // 100 days later
    const applied = applyBaselineToReport(report([known]), dir, undefined, Date.parse("2026-09-21T00:00:00.000Z"));
    expect(applied.notes.join(" ")).toMatch(/expiry/i);
    expect(applied.report.verdict).toBe("pass");
  });
});

describe("loadBaseline", () => {
  it("returns null when there is no baseline", () => {
    expect(loadBaseline(dir)).toBeNull();
  });
});
