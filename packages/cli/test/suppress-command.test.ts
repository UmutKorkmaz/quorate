import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applySuppressions, createSuppressionStore, fingerprintFinding, type CouncilReport, type Finding } from "@quorate/core";

import { applySuppressionStore, loadSuppressionStore, removeSuppressionFromStore, writeSuppression } from "../src/suppress-command.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "quorate-suppress-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function finding(overrides: Partial<Finding> = {}): Finding {
  const base: Finding = { severity: "critical", title: "SQL injection", body: "x", ...overrides };
  return { ...base, fingerprint: fingerprintFinding(base) };
}

function report(findings: Finding[]): CouncilReport {
  return {
    verdict: findings.some((f) => f.severity === "critical" || f.severity === "high") ? "fail" : "pass",
    summary: "x",
    findings,
    providerResults: [{ providerId: "glm", role: "security", providerType: "api", status: "ok", summary: "ok", findings, durationMs: 1 }],
    metadata: {
      generatedAt: "2026-06-15T00:00:00.000Z",
      mode: "review",
      subject: "PR #1",
      providers: ["glm:security"],
      requestedProviders: ["glm:security"],
      ranProviders: ["glm:security"],
      degraded: false
    }
  };
}

describe("writeSuppression / loadSuppressionStore", () => {
  it("writes a store from a fingerprint + reason and reads it back", () => {
    const { path } = writeSuppression(dir, "abc123", "accepted risk", { createdAt: "2026-06-15T00:00:00.000Z" });
    expect(existsSync(path)).toBe(true);
    const store = loadSuppressionStore(dir);
    expect(store?.suppressions[0].reason).toBe("accepted risk");
  });

  it("appends to an existing store without dropping entries", () => {
    writeSuppression(dir, "abc", "first", { createdAt: "2026-06-15T00:00:00.000Z" });
    writeSuppression(dir, "def", "second", { createdAt: "2026-06-15T00:00:00.000Z" });
    const store = loadSuppressionStore(dir);
    expect(store?.suppressions.map((e) => e.fingerprint).sort()).toEqual(["abc", "def"]);
  });

  it("rejects a blank reason", () => {
    expect(() => writeSuppression(dir, "abc", "  ", { createdAt: "2026-06-15T00:00:00.000Z" })).toThrow(/reason/i);
  });
});

describe("removeSuppressionFromStore", () => {
  it("removes a fingerprint and returns true; false when absent", () => {
    writeSuppression(dir, "abc", "x", { createdAt: "2026-06-15T00:00:00.000Z" });
    expect(removeSuppressionFromStore(dir, "abc")).toBe(true);
    expect(loadSuppressionStore(dir)?.suppressions).toHaveLength(0);
    expect(removeSuppressionFromStore(dir, "abc")).toBe(false);
  });
});

describe("applySuppressionStore", () => {
  it("tags a matching finding suppressed and flips fail -> pass", () => {
    const f = finding({ file: "a.ts" });
    writeSuppression(dir, f.fingerprint!, "accepted", { createdAt: "2026-06-15T00:00:00.000Z" });
    const r = report([f]);
    const out = applySuppressionStore(r, dir);
    expect(out.report.verdict).toBe("pass");
    expect(out.report.findings[0].status).toBe("suppressed");
    expect(out.notes.join(" ")).toMatch(/suppressed/i);
  });

  it("soft no-ops (no notes) when no store exists", () => {
    const r = report([finding({ file: "a.ts" })]);
    const out = applySuppressionStore(r, dir);
    expect(out.report.verdict).toBe("fail");
    expect(out.store).toBeNull();
    expect(out.notes).toHaveLength(0);
  });

  it("warns (does not crash) when the store is malformed, gating on all findings", () => {
    mkdirSync(resolve(dir, ".quorate"), { recursive: true });
    writeFileSync(resolve(dir, ".quorate", "suppressions.json"), "not json");
    const r = report([finding({ file: "a.ts" })]);
    const out = applySuppressionStore(r, dir);
    expect(out.report.verdict).toBe("fail");
    expect(out.notes.join(" ")).toMatch(/not valid JSON|Invalid/i);
  });

  it("is a no-op when the store is empty", () => {
    mkdirSync(resolve(dir, ".quorate"), { recursive: true });
    writeFileSync(resolve(dir, ".quorate", "suppressions.json"), JSON.stringify(createSuppressionStore()));
    const r = report([finding({ file: "a.ts" })]);
    // empty store -> applySuppressions returns the report unchanged (reference equality)
    const out = applySuppressionStore(r, dir);
    expect(out.report).toBe(r);
  });
});
