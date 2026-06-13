import { describe, expect, it } from "vitest";

import {
  DEFAULT_POLICY_PATH,
  explainPolicy,
  githubConfigToPolicy,
  parsePolicyYaml,
  resolvePolicy,
  shouldFailForPolicy
} from "../src/policy.js";
import type { CouncilReport, Finding, GithubConfig, QuorateConfig, Severity } from "../src/types.js";

// Frozen copy of the ORIGINAL shouldFailForReport logic, used as an independent
// oracle. shouldFailForReport is now a wrapper over the policy engine, so
// comparing against it would be tautological — this pins the historical behavior.
const LEGACY_WEIGHT: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
function legacyShouldFail(report: CouncilReport, gh: GithubConfig): boolean {
  if (gh.failOn !== "never" && report.findings.some((f) => LEGACY_WEIGHT[f.severity] >= LEGACY_WEIGHT[gh.failOn as Severity])) {
    return true;
  }
  if (gh.failOnDegraded === true && report.metadata.degraded) return true;
  if (gh.gate) {
    const w = LEGACY_WEIGHT[gh.gate.severity];
    if (report.findings.some((f) => LEGACY_WEIGHT[f.severity] >= w && (f.agreement ?? 1) >= gh.gate!.minAgreement)) {
      return true;
    }
  }
  return false;
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return { severity: "high", title: "Issue", body: "x", ...overrides };
}

function report(
  findings: Finding[],
  metadata: Partial<CouncilReport["metadata"]> = {},
  providerResults?: CouncilReport["providerResults"]
): CouncilReport {
  return {
    verdict: findings.some((f) => f.severity === "critical" || f.severity === "high")
      ? "fail"
      : findings.some((f) => f.severity === "medium")
        ? "warn"
        : "pass",
    summary: "x",
    findings,
    providerResults: providerResults ?? [
      { providerId: "glm", role: "security", providerType: "api", status: "ok", summary: "ok", findings, durationMs: 1 }
    ],
    metadata: {
      generatedAt: "2026-06-13T00:00:00.000Z",
      mode: "review",
      subject: "PR",
      providers: ["glm:security"],
      requestedProviders: ["glm:security"],
      ranProviders: ["glm:security"],
      degraded: false,
      ...metadata
    }
  };
}

function github(overrides: Partial<GithubConfig> = {}): GithubConfig {
  return { commentMode: "update", failOn: "high", runnerMode: "auto", failOnDegraded: false, ...overrides };
}

describe("githubConfigToPolicy is exact backward-compat", () => {
  // The derived policy must produce the identical gate decision as the legacy
  // shouldFailForReport for every interesting report/github combination.
  const cases: Array<{ name: string; gh: GithubConfig; rep: CouncilReport }> = [
    { name: "high finding, failOn high", gh: github(), rep: report([finding({ severity: "high" })]) },
    { name: "medium finding, failOn high (pass-gate)", gh: github(), rep: report([finding({ severity: "medium" })]) },
    { name: "failOn never", gh: github({ failOn: "never" }), rep: report([finding({ severity: "critical" })]) },
    { name: "failOn critical, high finding", gh: github({ failOn: "critical" }), rep: report([finding({ severity: "high" })]) },
    { name: "degraded + failOnDegraded", gh: github({ failOnDegraded: true }), rep: report([], { degraded: true }) },
    { name: "degraded without failOnDegraded", gh: github({ failOnDegraded: false }), rep: report([], { degraded: true }) },
    {
      name: "agreement gate trips",
      gh: github({ failOn: "never", gate: { severity: "high", minAgreement: 2 } }),
      rep: report([finding({ severity: "high", agreement: 2 })])
    },
    {
      name: "agreement gate below minAgreement",
      gh: github({ failOn: "never", gate: { severity: "high", minAgreement: 3 } }),
      rep: report([finding({ severity: "high", agreement: 2 })])
    }
  ];

  for (const { name, gh, rep } of cases) {
    it(name, () => {
      expect(shouldFailForPolicy(rep, githubConfigToPolicy(gh))).toBe(legacyShouldFail(rep, gh));
    });
  }
});

describe("parsePolicyYaml", () => {
  const yaml = `
version: 1
merge_gate:
  enabled: true
  block_on_verdict: [fail, warn]
  allow_warn_merge: false
verdict:
  fail_on: medium
  fail_on_degraded: true
agreement:
  min_agreement: 3
  gate_severity: high
roles_required:
  - security
  - maintainer
providers:
  min_real_providers: 2
`;

  it("maps snake_case fields onto the internal policy", () => {
    const p = parsePolicyYaml(yaml);
    expect(p.failOn).toBe("medium");
    expect(p.failOnDegraded).toBe(true);
    expect(p.gate).toEqual({ severity: "high", minAgreement: 3 });
    expect(p.rolesRequired).toEqual(["security", "maintainer"]);
    expect(p.minRealProviders).toBe(2);
    expect(p.blockOnVerdict).toEqual(["fail", "warn"]);
    expect(p.allowWarnMerge).toBe(false);
  });

  it("applies spec defaults for a minimal policy", () => {
    const p = parsePolicyYaml("version: 1");
    expect(p.enabled).toBe(true);
    expect(p.failOn).toBe("high");
    expect(p.failOnDegraded).toBe(true);
    expect(p.blockOnVerdict).toEqual(["fail"]);
    expect(p.minRealProviders).toBe(1);
  });

  it("rejects an unsupported version", () => {
    expect(() => parsePolicyYaml("version: 99")).toThrow(/version/i);
  });
});

describe("shouldFailForPolicy — extended dimensions", () => {
  it("blocks when a required role did not run successfully", () => {
    const pol = { ...parsePolicyYaml("version: 1"), failOn: "never" as const, rolesRequired: ["security"] };
    const ok = report([finding({ severity: "low" })], {}, [
      { providerId: "glm", role: "security", providerType: "api", status: "ok", summary: "", findings: [], durationMs: 1 }
    ]);
    const missing = report([finding({ severity: "low" })], {}, [
      { providerId: "glm", role: "qa", providerType: "api", status: "ok", summary: "", findings: [], durationMs: 1 }
    ]);
    expect(shouldFailForPolicy(ok, pol)).toBe(false);
    expect(shouldFailForPolicy(missing, pol)).toBe(true);
  });

  it("blocks when fewer than min_real_providers succeeded (heuristic doesn't count)", () => {
    const pol = { ...parsePolicyYaml("version: 1"), failOn: "never" as const, minRealProviders: 1 };
    const heuristicOnly = report([], { degraded: true }, [
      { providerId: "heuristic", role: "maintainer", providerType: "mock", status: "ok", summary: "", findings: [], durationMs: 1 }
    ]);
    expect(shouldFailForPolicy(heuristicOnly, { ...pol, failOnDegraded: false })).toBe(true);
  });

  it("blocks on verdict via block_on_verdict, honoring allow_warn_merge", () => {
    const warnReport = report([finding({ severity: "medium" })]); // verdict warn
    const blockWarn = { ...parsePolicyYaml("version: 1"), failOn: "never" as const, blockOnVerdict: ["warn"] as const, allowWarnMerge: false };
    expect(shouldFailForPolicy(warnReport, blockWarn)).toBe(true);
    expect(shouldFailForPolicy(warnReport, { ...blockWarn, allowWarnMerge: true })).toBe(false);
  });

  it("never blocks when the merge gate is disabled", () => {
    const pol = { ...parsePolicyYaml("version: 1"), enabled: false };
    expect(shouldFailForPolicy(report([finding({ severity: "critical" })]), pol)).toBe(false);
  });
});

describe("resolvePolicy", () => {
  function config(overrides: Partial<QuorateConfig> = {}): QuorateConfig {
    return { councils: ["security"], providers: [], github: github(), ...overrides };
  }

  it("prefers an explicit policy over github config", () => {
    const explicit = parsePolicyYaml("version: 1\nverdict:\n  fail_on: critical");
    expect(resolvePolicy(config(), { policy: explicit }).failOn).toBe("critical");
  });

  it("derives from github config when no policy is set", () => {
    expect(resolvePolicy(config({ github: github({ failOn: "low" }) })).failOn).toBe("low");
  });

  it("applies a fail-on override on top", () => {
    expect(resolvePolicy(config(), { failOn: "critical" }).failOn).toBe("critical");
  });
});

describe("explainPolicy", () => {
  it("reports the blocking reasons", () => {
    const result = explainPolicy(report([finding({ severity: "critical" })]), githubConfigToPolicy(github()));
    expect(result.fail).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/critical|high/i);
  });

  it("reports a clean pass", () => {
    const result = explainPolicy(report([finding({ severity: "low" })]), githubConfigToPolicy(github()));
    expect(result.fail).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

it("exposes the default policy path", () => {
  expect(DEFAULT_POLICY_PATH).toBe(".quorate/policy.yml");
});
