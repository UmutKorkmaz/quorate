import YAML from "yaml";
import { z } from "zod";

import { severities, verdicts } from "./types.js";
import type {
  CouncilReport,
  GithubConfig,
  QuorateConfig,
  QuoratePolicy,
  Severity,
  Verdict
} from "./types.js";

export type { QuoratePolicy };

/**
 * VerdictGate policy — the single source of truth for "does this report block
 * merge?", shared by the CLI exit code, the GitHub Action check, and the App
 * Check Run conclusion. See docs/products/VERDICT-GATE.md and
 * .quorate/policy.yml.example.
 *
 * Policy defines WHEN a verdict blocks; `.quorate.yml` providers define WHICH
 * agents run. A policy can come from a standalone `.quorate/policy.yml`, a
 * `policy:` block in `.quorate.yml`, or be derived from the legacy `github:`
 * config for exact backward compatibility.
 */

export const POLICY_VERSION = 1;
export const DEFAULT_POLICY_PATH = ".quorate/policy.yml";

const severityWeight: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

const severitySchema = z.enum(severities);

const policyYamlSchema = z.object({
  version: z.number().int().optional(),
  merge_gate: z
    .object({
      enabled: z.boolean().optional(),
      block_on_verdict: z.array(z.enum(verdicts)).optional(),
      allow_warn_merge: z.boolean().optional()
    })
    .optional(),
  verdict: z
    .object({
      fail_on: z.union([severitySchema, z.literal("never")]).optional(),
      fail_on_degraded: z.boolean().optional()
    })
    .optional(),
  agreement: z
    .object({
      min_agreement: z.number().int().positive().optional(),
      gate_severity: severitySchema.optional()
    })
    .optional(),
  roles_required: z.array(z.string().min(1)).optional(),
  providers: z.object({ min_real_providers: z.number().int().nonnegative().optional() }).optional()
});

/**
 * Normalize an already-parsed policy object (snake_case) into a resolved policy,
 * applying the documented spec defaults for any omitted field. Used for both a
 * standalone policy.yml and an inline `policy:` block in `.quorate.yml`.
 */
export function parsePolicyObject(data: unknown): QuoratePolicy {
  const parsed = policyYamlSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new Error(`Invalid policy: ${parsed.error.issues[0]?.message ?? "schema mismatch"}.`);
  }
  const p = parsed.data;
  if (p.version !== undefined && p.version !== POLICY_VERSION) {
    throw new Error(`Unsupported policy version ${p.version} (expected ${POLICY_VERSION}).`);
  }
  const agreement = p.agreement;
  return {
    enabled: p.merge_gate?.enabled ?? true,
    blockOnVerdict: p.merge_gate?.block_on_verdict ?? ["fail"],
    allowWarnMerge: p.merge_gate?.allow_warn_merge ?? false,
    failOn: p.verdict?.fail_on ?? "high",
    failOnDegraded: p.verdict?.fail_on_degraded ?? true,
    gate: agreement
      ? { severity: agreement.gate_severity ?? "high", minAgreement: agreement.min_agreement ?? 2 }
      : undefined,
    rolesRequired: p.roles_required ?? [],
    minRealProviders: p.providers?.min_real_providers ?? 1
  };
}

/** Parse a standalone policy.yml string into a resolved policy. */
export function parsePolicyYaml(source: string): QuoratePolicy {
  let data: unknown;
  try {
    data = YAML.parse(source) ?? {};
  } catch {
    throw new Error("Invalid policy file: not valid YAML.");
  }
  return parsePolicyObject(data);
}

/**
 * Derive a policy from the legacy `github:` config. This MUST reproduce the
 * exact behavior of the historical `shouldFailForReport`, so the extended
 * dimensions (verdict block list, required roles, provider floor) are left
 * neutral — only the threshold, degraded, and agreement gates apply.
 */
export function githubConfigToPolicy(github: GithubConfig): QuoratePolicy {
  return {
    enabled: true,
    blockOnVerdict: [],
    allowWarnMerge: true,
    failOn: github.failOn,
    failOnDegraded: github.failOnDegraded ?? false,
    gate: github.gate,
    rolesRequired: [],
    minRealProviders: 0
  };
}

/**
 * The policy in force for a run: an explicit policy (loaded from a standalone
 * `.quorate/policy.yml`) wins; otherwise derive from the legacy `github:` config.
 * A `failOn` override (e.g. the Action/CLI `--fail-on` input) is layered on top.
 */
export function resolvePolicy(
  config: QuorateConfig,
  options?: { policy?: QuoratePolicy; failOn?: Severity | "never" }
): QuoratePolicy {
  const base = options?.policy ?? githubConfigToPolicy(config.github);
  return options?.failOn ? { ...base, failOn: options.failOn } : base;
}

function exceedsThreshold(report: CouncilReport, failOn: Severity | "never"): boolean {
  if (failOn === "never") return false;
  return report.findings.some((finding) => severityWeight[finding.severity] >= severityWeight[failOn]);
}

function agreementGateTrips(report: CouncilReport, gate: { severity: Severity; minAgreement: number }): boolean {
  const gateWeight = severityWeight[gate.severity];
  return report.findings.some(
    (finding) => severityWeight[finding.severity] >= gateWeight && (finding.agreement ?? 1) >= gate.minAgreement
  );
}

/** Roles that the policy requires but which had no successful lane in the report. */
export function requiredRolesMissing(report: CouncilReport, rolesRequired: string[]): string[] {
  const satisfied = new Set(
    report.providerResults.filter((result) => result.status === "ok").map((result) => result.role)
  );
  return rolesRequired.filter((role) => !satisfied.has(role));
}

/** Count of distinct non-heuristic providers that ran successfully. */
function realProviderOkCount(report: CouncilReport): number {
  const ids = new Set(
    report.providerResults
      .filter((r) => (r.providerType === "cli" || r.providerType === "api") && r.status === "ok")
      .map((r) => r.providerId)
  );
  return ids.size;
}

function verdictBlocks(verdict: Verdict, policy: QuoratePolicy): boolean {
  if (verdict === "warn" && policy.allowWarnMerge) return false;
  return policy.blockOnVerdict.includes(verdict);
}

/** The single gate decision used by the CLI, Action, and App. */
export function shouldFailForPolicy(report: CouncilReport, policy: QuoratePolicy): boolean {
  if (!policy.enabled) return false;
  if (exceedsThreshold(report, policy.failOn)) return true;
  if (policy.failOnDegraded && report.metadata.degraded) return true;
  if (policy.gate && agreementGateTrips(report, policy.gate)) return true;
  if (verdictBlocks(report.verdict, policy)) return true;
  if (requiredRolesMissing(report, policy.rolesRequired).length > 0) return true;
  if (policy.minRealProviders > 0 && realProviderOkCount(report) < policy.minRealProviders) return true;
  return false;
}

export interface PolicyExplanation {
  fail: boolean;
  reasons: string[];
}

/** Human-readable account of why a report does or doesn't block merge. */
export function explainPolicy(report: CouncilReport, policy: QuoratePolicy): PolicyExplanation {
  if (!policy.enabled) {
    return { fail: false, reasons: ["merge gate disabled (merge_gate.enabled: false)"] };
  }
  const reasons: string[] = [];
  if (exceedsThreshold(report, policy.failOn)) {
    reasons.push(`a finding meets or exceeds the fail-on severity "${policy.failOn}"`);
  }
  if (policy.failOnDegraded && report.metadata.degraded) {
    reasons.push("the run was degraded (no real provider succeeded) and fail_on_degraded is set");
  }
  if (policy.gate && agreementGateTrips(report, policy.gate)) {
    reasons.push(
      `a ${policy.gate.severity}+ finding was agreed by ≥ ${policy.gate.minAgreement} providers (agreement gate)`
    );
  }
  if (verdictBlocks(report.verdict, policy)) {
    reasons.push(`the verdict "${report.verdict}" is in block_on_verdict`);
  }
  const missingRoles = requiredRolesMissing(report, policy.rolesRequired);
  if (missingRoles.length > 0) {
    reasons.push(`required role(s) did not complete successfully: ${missingRoles.join(", ")}`);
  }
  if (policy.minRealProviders > 0 && realProviderOkCount(report) < policy.minRealProviders) {
    reasons.push(`fewer than ${policy.minRealProviders} real provider(s) succeeded`);
  }
  if (reasons.length > 0) return { fail: true, reasons };
  return { fail: false, reasons: ["no policy condition blocks merge"] };
}
