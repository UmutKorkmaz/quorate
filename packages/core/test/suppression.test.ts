import { describe, expect, it } from "vitest";

import { fingerprintFinding } from "../src/identity.js";
import {
  SUPPRESSION_VERSION,
  addSuppression,
  applySuppressions,
  createSuppressionStore,
  isSuppressed,
  listExpired,
  parseSuppressionStore,
  removeSuppression,
  serializeSuppressionStore,
  type SuppressionStore
} from "../src/suppression.js";
import { finalVerdict } from "../src/council.js";
import { shouldFailForThreshold } from "../src/render.js";
import type { CouncilReport, Finding } from "../src/types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  const base: Finding = { severity: "critical", title: "SQL injection", body: "x", ...overrides };
  return { ...base, fingerprint: fingerprintFinding(base) };
}

function report(findings: Finding[], overrides: Partial<CouncilReport["metadata"]> = {}): CouncilReport {
  return {
    verdict: findings.some((f) => f.severity === "critical" || f.severity === "high") ? "fail" : "pass",
    summary: "x",
    findings,
    providerResults: [
      { providerId: "glm", role: "security", providerType: "api", status: "ok", summary: "ok", findings, durationMs: 1 }
    ],
    metadata: {
      generatedAt: "2026-06-15T00:00:00.000Z",
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

const NOW = Date.parse("2026-06-15T00:00:00.000Z");

describe("store create / serialize / parse round-trip", () => {
  it("starts empty and versioned", () => {
    const store = createSuppressionStore();
    expect(store.version).toBe(SUPPRESSION_VERSION);
    expect(store.suppressions).toEqual([]);
  });

  it("survives serialize -> parse", () => {
    const store = addSuppression(createSuppressionStore(), {
      fingerprint: "abc123",
      reason: "accepted risk — third-party",
      createdAt: "2026-06-15T00:00:00.000Z"
    });
    const parsed = parseSuppressionStore(serializeSuppressionStore(store));
    expect(parsed).toEqual(store);
  });

  it("rejects malformed or wrong-version stores", () => {
    expect(() => parseSuppressionStore("not json")).toThrow(/not valid JSON/i);
    expect(() => parseSuppressionStore(JSON.stringify({ version: 99, suppressions: [] }))).toThrow(/version/i);
  });

  it("rejects an entry missing a reason (no silent suppression)", () => {
    const bad = JSON.stringify({
      version: 1,
      suppressions: [{ fingerprint: "abc", createdAt: "2026-06-15T00:00:00.000Z" }]
    });
    expect(() => parseSuppressionStore(bad)).toThrow();
  });

  it("rejects invalid creation and expiry timestamps", () => {
    const invalidCreatedAt = JSON.stringify({
      version: 1,
      suppressions: [{ fingerprint: "abc", reason: "risk", createdAt: "not-a-date" }]
    });
    const invalidExpiry = JSON.stringify({
      version: 1,
      suppressions: [
        {
          fingerprint: "abc",
          reason: "risk",
          createdAt: "2026-06-15T00:00:00.000Z",
          expires: "not-a-date"
        }
      ]
    });

    expect(() => parseSuppressionStore(invalidCreatedAt)).toThrow(/suppression store/i);
    expect(() => parseSuppressionStore(invalidExpiry)).toThrow(/suppression store/i);
  });
});

describe("addSuppression / removeSuppression", () => {
  it("adds an entry (dedup by fingerprint, latest wins)", () => {
    let store = addSuppression(createSuppressionStore(), {
      fingerprint: "abc",
      reason: "v1",
      createdAt: "2026-06-15T00:00:00.000Z"
    });
    store = addSuppression(store, {
      fingerprint: "abc",
      reason: "v2",
      createdAt: "2026-06-16T00:00:00.000Z"
    });
    expect(store.suppressions).toHaveLength(1);
    expect(store.suppressions[0].reason).toBe("v2");
  });

  it("trims and requires a non-empty reason", () => {
    expect(() =>
      addSuppression(createSuppressionStore(), {
        fingerprint: "abc",
        reason: "   ",
        createdAt: "2026-06-15T00:00:00.000Z"
      })
    ).toThrow(/reason/i);
  });

  it("rejects invalid timestamps when adding a suppression", () => {
    expect(() =>
      addSuppression(createSuppressionStore(), {
        fingerprint: "abc",
        reason: "accepted",
        createdAt: "not-a-date",
        expires: "also-not-a-date"
      })
    ).toThrow(/timestamp|date/i);
  });

  it("removes by fingerprint (no-op if absent)", () => {
    let store = addSuppression(createSuppressionStore(), {
      fingerprint: "abc",
      reason: "x",
      createdAt: "2026-06-15T00:00:00.000Z"
    });
    store = removeSuppression(store, "abc");
    expect(store.suppressions).toHaveLength(0);
    expect(removeSuppression(store, "nope").suppressions).toHaveLength(0);
  });

  it("never mutates the input store", () => {
    const store = addSuppression(createSuppressionStore(), {
      fingerprint: "abc",
      reason: "x",
      createdAt: "2026-06-15T00:00:00.000Z"
    });
    addSuppression(store, { fingerprint: "def", reason: "y", createdAt: "2026-06-15T00:00:00.000Z" });
    expect(store.suppressions).toHaveLength(1);
  });
});

describe("isSuppressed / listExpired", () => {
  const store: SuppressionStore = {
    version: 1,
    suppressions: [
      { fingerprint: "active", reason: "r", createdAt: "2026-06-01T00:00:00.000Z" },
      { fingerprint: "expired", reason: "r", createdAt: "2026-06-01T00:00:00.000Z", expires: "2026-06-10T00:00:00.000Z" }
    ]
  };

  it("matches an active suppression", () => {
    expect(isSuppressed(store, "active", NOW)).toBe(true);
  });

  it("does not match an expired one", () => {
    expect(isSuppressed(store, "expired", NOW)).toBe(false);
  });

  it("does not match an unknown fingerprint", () => {
    expect(isSuppressed(store, "nope", NOW)).toBe(false);
  });

  it("listExpired surfaces expired entries for audit", () => {
    expect(listExpired(store, NOW).map((e) => e.fingerprint)).toEqual(["expired"]);
  });
});

describe("applySuppressions", () => {
  it("tags matching findings suppressed (not dropped) and recomputes the verdict", () => {
    const accepted = finding({ title: "Accepted crit", file: "a.ts" });
    const fresh = finding({ severity: "high", title: "Fresh issue", file: "b.ts" });
    const r = report([accepted, fresh]); // verdict fail
    const store = addSuppression(createSuppressionStore(), {
      fingerprint: accepted.fingerprint!,
      reason: "accepted",
      createdAt: "2026-06-15T00:00:00.000Z"
    });

    const out = applySuppressions(r, store, NOW);
    // both findings remain visible
    expect(out.findings).toHaveLength(2);
    expect(out.findings.find((f) => f.title === "Accepted crit")?.status).toBe("suppressed");
    expect(out.findings.find((f) => f.title === "Fresh issue")?.status).toBeUndefined();
    expect(out.metadata.suppressedFindings).toBe(1);
    // the suppressed critical no longer fails the gate
    expect(out.verdict).toBe("fail"); // fresh high still fails
  });

  it("flips a fail to pass when ALL gating findings are suppressed", () => {
    const only = finding({ severity: "critical", title: "Only issue", file: "a.ts" });
    const r = report([only]); // verdict fail
    const store = addSuppression(createSuppressionStore(), {
      fingerprint: only.fingerprint!,
      reason: "accepted",
      createdAt: "2026-06-15T00:00:00.000Z"
    });
    const out = applySuppressions(r, store, NOW);
    expect(out.verdict).toBe("pass");
    expect(out.findings[0].status).toBe("suppressed"); // still visible
  });

  it("does not mutate the input report", () => {
    const f = finding({ severity: "critical", file: "a.ts" });
    const r = report([f]);
    const store = addSuppression(createSuppressionStore(), {
      fingerprint: f.fingerprint!,
      reason: "x",
      createdAt: "2026-06-15T00:00:00.000Z"
    });
    applySuppressions(r, store, NOW);
    expect(r.findings[0].status).toBeUndefined();
    expect(r.verdict).toBe("fail");
  });

  it("preserves the degraded->warn override", () => {
    const f = finding({ severity: "critical", file: "a.ts" });
    const r = report([f], { degraded: true });
    const store = addSuppression(createSuppressionStore(), {
      fingerprint: f.fingerprint!,
      reason: "x",
      createdAt: "2026-06-15T00:00:00.000Z"
    });
    expect(applySuppressions(r, store, NOW).verdict).toBe("warn");
  });

  it("returns the report unchanged when nothing matches", () => {
    const r = report([finding({ file: "a.ts" })]);
    const store = addSuppression(createSuppressionStore(), {
      fingerprint: "deadbeef",
      reason: "x",
      createdAt: "2026-06-15T00:00:00.000Z"
    });
    expect(applySuppressions(r, store, NOW)).toBe(r);
  });
});

describe("finalVerdict ignores suppressed findings (gate consistency)", () => {
  it("a suppressed-only critical yields pass, an active one yields fail", () => {
    const suppressed = finding({ severity: "critical", file: "a.ts", status: "suppressed" });
    const active = finding({ severity: "critical", file: "b.ts" });
    const providers = report([]).providerResults;
    expect(finalVerdict([suppressed], providers, false)).toBe("pass");
    expect(finalVerdict([active], providers, false)).toBe("fail");
  });
});

describe("shouldFailForThreshold ignores suppressed findings", () => {
  it("a suppressed high finding does not trip the high threshold", () => {
    const suppressed = finding({ severity: "high", file: "a.ts", status: "suppressed" });
    expect(shouldFailForThreshold(report([suppressed]), "high")).toBe(false);
    const active = finding({ severity: "high", file: "b.ts" });
    expect(shouldFailForThreshold(report([active]), "high")).toBe(true);
  });
});
