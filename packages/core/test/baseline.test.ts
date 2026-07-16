import { describe, expect, it } from "vitest";

import {
  BASELINE_VERSION,
  applyBaseline,
  createBaseline,
  filterBaselineFindings,
  isBaselineStale,
  parseBaseline,
  serializeBaseline
} from "../src/baseline.js";
import { fingerprintFinding } from "../src/identity.js";
import type { CouncilReport, Finding } from "../src/types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  const base: Finding = {
    severity: "high",
    title: "Hardcoded API key",
    body: "secret committed",
    ...overrides
  };
  return { ...base, fingerprint: fingerprintFinding(base) };
}

function report(findings: Finding[], overrides: Partial<CouncilReport["metadata"]> = {}): CouncilReport {
  return {
    verdict: "fail",
    summary: `Quorate found ${findings.length} findings.`,
    findings,
    providerResults: [
      {
        providerId: "glm",
        role: "security",
        providerType: "api",
        status: "ok",
        summary: "ok",
        findings,
        durationMs: 1
      }
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

describe("createBaseline / serialize / parse round-trip", () => {
  it("captures one entry per distinct fingerprint, sorted and deterministic", () => {
    const a = finding({ title: "SQL injection", file: "a.ts", severity: "critical" });
    const b = finding({ title: "XSS", file: "b.ts", severity: "high" });
    const store = createBaseline([a, b, a], { generatedAt: "2026-06-13T00:00:00.000Z" });
    expect(store.version).toBe(BASELINE_VERSION);
    expect(store.findings).toHaveLength(2); // de-duplicated
    const fps = store.findings.map((e) => e.fingerprint);
    expect([...fps]).toEqual([...fps].sort()); // stable, sorted order
  });

  it("survives a serialize -> parse round-trip", () => {
    const store = createBaseline([finding({ file: "a.ts" })], {
      generatedAt: "2026-06-13T00:00:00.000Z",
      expiresAfterDays: 90
    });
    const parsed = parseBaseline(serializeBaseline(store));
    expect(parsed).toEqual(store);
  });

  it("rejects malformed or wrong-version baseline files", () => {
    expect(() => parseBaseline("not json")).toThrow();
    expect(() => parseBaseline(JSON.stringify({ findings: [] }))).toThrow(/Invalid baseline/i);
    expect(() =>
      parseBaseline(
        JSON.stringify({ version: 999, generatedAt: "2026-01-01T00:00:00.000Z", findings: [] })
      )
    ).toThrow(/version/i);
  });

  it("rejects an invalid generated timestamp", () => {
    expect(() =>
      parseBaseline(
        JSON.stringify({
          version: 1,
          generatedAt: "not-a-date",
          expiresAfterDays: 30,
          findings: []
        })
      )
    ).toThrow(/baseline/i);
  });
});

describe("filterBaselineFindings", () => {
  it("splits findings into kept (new) and suppressed (baselined)", () => {
    const known = finding({ title: "Known issue", file: "a.ts" });
    const fresh = finding({ title: "Brand new issue", file: "b.ts" });
    const store = createBaseline([known], { generatedAt: "2026-06-13T00:00:00.000Z" });

    const { kept, suppressed } = filterBaselineFindings([known, fresh], store);
    expect(kept.map((f) => f.title)).toEqual(["Brand new issue"]);
    expect(suppressed.map((f) => f.title)).toEqual(["Known issue"]);
  });

  it("computes the fingerprint on the fly when a finding lacks one", () => {
    const known = finding({ title: "Known", file: "a.ts" });
    const store = createBaseline([known], { generatedAt: "2026-06-13T00:00:00.000Z" });
    const sameButUnstamped: Finding = { severity: known.severity, title: known.title, body: "x", file: "a.ts" };
    const { suppressed } = filterBaselineFindings([sameButUnstamped], store);
    expect(suppressed).toHaveLength(1);
  });
});

describe("applyBaseline", () => {
  it("recomputes the verdict on the filtered set (fail -> pass when all gating findings are baselined)", () => {
    const known = finding({ severity: "critical", title: "Known crit", file: "a.ts" });
    const r = report([known]); // verdict fail
    const store = createBaseline([known], { generatedAt: "2026-06-13T00:00:00.000Z" });

    const filtered = applyBaseline(r, store);
    expect(filtered.findings).toHaveLength(0);
    expect(filtered.verdict).toBe("pass"); // the only critical was baselined
    expect(filtered.metadata.baselinedFindings).toBe(1);
  });

  it("still fails on a genuinely new high finding even when older ones are baselined", () => {
    const known = finding({ severity: "high", title: "Known", file: "a.ts" });
    const fresh = finding({ severity: "high", title: "New", file: "b.ts" });
    const r = report([known, fresh]);
    const store = createBaseline([known], { generatedAt: "2026-06-13T00:00:00.000Z" });

    const filtered = applyBaseline(r, store);
    expect(filtered.findings.map((f) => f.title)).toEqual(["New"]);
    expect(filtered.verdict).toBe("fail");
    expect(filtered.metadata.baselinedFindings).toBe(1);
  });

  it("preserves the degraded -> warn override when a baselined run is heuristic-only", () => {
    const known = finding({ severity: "critical", title: "Known", file: "a.ts" });
    const r = report([known], { degraded: true });
    const store = createBaseline([known], { generatedAt: "2026-06-13T00:00:00.000Z" });
    const filtered = applyBaseline(r, store);
    expect(filtered.verdict).toBe("warn"); // pass would be wrong: degraded never gives a confident green
  });

  it("returns the report unchanged when nothing matches the baseline", () => {
    const r = report([finding({ title: "Only finding", file: "a.ts" })]);
    const store = createBaseline([finding({ title: "Unrelated", file: "z.ts" })], {
      generatedAt: "2026-06-13T00:00:00.000Z"
    });
    expect(applyBaseline(r, store)).toBe(r);
  });

  it("does not mutate the input report", () => {
    const known = finding({ severity: "critical", title: "Known", file: "a.ts" });
    const r = report([known]);
    const store = createBaseline([known], { generatedAt: "2026-06-13T00:00:00.000Z" });
    applyBaseline(r, store);
    expect(r.findings).toHaveLength(1);
    expect(r.verdict).toBe("fail");
  });
});

describe("isBaselineStale", () => {
  const generatedAt = "2026-01-01T00:00:00.000Z";
  it("is never stale without an expiry", () => {
    const store = createBaseline([], { generatedAt });
    expect(isBaselineStale(store, Date.parse("2030-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("is stale once the expiry window has passed", () => {
    const store = createBaseline([], { generatedAt, expiresAfterDays: 30 });
    expect(isBaselineStale(store, Date.parse("2026-01-15T00:00:00.000Z"))).toBe(false);
    expect(isBaselineStale(store, Date.parse("2026-03-01T00:00:00.000Z"))).toBe(true);
  });

  it("treats the exact expiry instant as stale (inclusive boundary)", () => {
    const store = createBaseline([], { generatedAt, expiresAfterDays: 30 });
    // generatedAt + 30 days, to the millisecond
    expect(isBaselineStale(store, Date.parse(generatedAt) + 30 * 86_400_000)).toBe(true);
    expect(isBaselineStale(store, Date.parse(generatedAt) + 30 * 86_400_000 - 1)).toBe(false);
  });
});
