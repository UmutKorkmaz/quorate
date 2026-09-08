import { describe, expect, it } from "vitest";
import { createDecisionRecord, validateDecisionRecord } from "../src/decision.js";
import { createDefaultConfig } from "../src/providers.js";
import { resolvePolicy } from "../src/policy.js";
import type { CouncilReport } from "../src/types.js";

const report: CouncilReport = {
  verdict: "fail", summary: "Issue", findings: [{ severity: "high", title: "Unsafe query", body: "Input reaches SQL", file: "a.ts", line: 4, agreedBy: ["a", "b"], agreement: 2 }],
  providerResults: [{ providerId: "a", providerType: "api", role: "security", status: "ok", summary: "Issue", findings: [], durationMs: 3 }],
  metadata: { generatedAt: "2026-09-08T10:00:00.000Z", mode: "review", subject: "test", providers: ["a:security"], requestedProviders: ["a:security"], ranProviders: ["a:security"], degraded: false }
};

describe("portable decision records", () => {
  it("binds input, policy, configuration, provenance and the final gate without copying credentials", () => {
    const config = createDefaultConfig();
    config.providers.push({ id: "a", type: "api", model: "test-model", baseUrl: "http://example.test", env: { TOKEN: "DO_NOT_EXPORT" } });
    const record = createDecisionRecord({ mode: "review", subject: "test", diff: "+change" }, config, report, resolvePolicy(config));
    expect(record.gate.blocked).toBe(true);
    expect(record.findings[0].agreedBy).toEqual(["a", "b"]);
    expect(record.providers[0].model).toBe("test-model");
    expect(record.integrity.kind).toBe("sha256-content");
    expect(JSON.stringify(record)).not.toContain("DO_NOT_EXPORT");
    expect(validateDecisionRecord(JSON.parse(JSON.stringify(record)))).toBe(true);
    expect(validateDecisionRecord({ ...record, gate: { ...record.gate, blocked: false } })).toBe(false);
    const changed = createDecisionRecord({ mode: "review", subject: "test", diff: "+different" }, config, report, resolvePolicy(config));
    expect(changed.integrity.hash).not.toBe(record.integrity.hash);
    expect(changed.inputs.diffHash).not.toBe(record.inputs.diffHash);
  });

  it("retains limitations and distinguishes content integrity from trusted execution", () => {
    const config = createDefaultConfig();
    const record = createDecisionRecord({ mode: "review", subject: "test", diff: "+change" }, config, report, resolvePolicy(config), {
      source: { kind: "git", baseSha: "a".repeat(40), headSha: "b".repeat(40) }, toolVersion: "1.4.0"
    });
    expect(record.source.headSha).toBe("b".repeat(40));
    expect(record.coverage.limitations.join(" ")).toContain("No proof");
    expect(record.integrity.attestation).toBe("none");
    expect(validateDecisionRecord(null)).toBe(false);
    expect(validateDecisionRecord({ ...record, extra: "unversioned" })).toBe(false);
  });

  it("does not call failed lanes completed and blocks when the committed policy is unavailable", () => {
    const config = createDefaultConfig();
    const failedReport = { ...report, providerResults: [{ ...report.providerResults[0], status: "error" as const }] };
    const record = createDecisionRecord({ mode: "review", subject: "test", diff: "+change" }, config, failedReport, resolvePolicy(config), { policyUnavailable: true });
    expect(record.coverage.completed).toEqual([]);
    expect(record.coverage.failed).toEqual(["a:security"]);
    expect(record.policy.status).toBe("unavailable");
    expect(record.gate.blocked).toBe(true);
    const changedConfig = { ...config, severityThreshold: "critical" as const };
    const changed = createDecisionRecord({ mode: "review", subject: "test", diff: "+change" }, changedConfig, report, { ...resolvePolicy(config), minRealProviders: 2 });
    expect(changed.configurationHash).not.toBe(record.configurationHash);
    expect(changed.policy.hash).not.toBe(record.policy.hash);
  });
});
