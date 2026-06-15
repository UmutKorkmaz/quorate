import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  DEFAULT_POLICY_PATH,
  explainPolicy,
  parsePolicyYaml,
  resolvePolicy,
  type CouncilReport,
  type QuorateConfig,
  type QuoratePolicy
} from "@quorate/core";

const LAST_REPORT_PATH = ".quorate/last-report.json";

/** Load a standalone policy file, or null when none exists. Throws on a malformed file. */
export function loadPolicyFile(cwd: string, policyPath?: string): QuoratePolicy | null {
  const path = resolve(cwd, policyPath ?? DEFAULT_POLICY_PATH);
  if (!existsSync(path)) return null;
  return parsePolicyYaml(readFileSync(path, "utf8"));
}

const STARTER_POLICY = `# Quorate VerdictGate merge policy — see docs/products/VERDICT-GATE.md
# This file lives under .quorate/ (gitignored by \`quorate init\`); commit it with
#   git add -f .quorate/policy.yml
# so the GitHub Action can read it from the base branch.
version: 1

merge_gate:
  enabled: true
  block_on_verdict: [fail]   # which verdicts fail the check
  allow_warn_merge: true     # warn does not block merge

verdict:
  fail_on: high              # critical/high findings block
  fail_on_degraded: false    # set true to block heuristic-only runs

agreement:
  min_agreement: 2           # a finding must be raised by >= 2 providers to gate
  gate_severity: high

roles_required: []           # e.g. [security, maintainer]

providers:
  min_real_providers: 0      # set >= 1 to require a non-heuristic reviewer
`;

export interface PolicyInitResult {
  path: string;
  overwritten: boolean;
}

/** Write a starter policy.yml, refusing to clobber an existing one without force. */
export function writeStarterPolicy(cwd: string, options: { policyPath?: string; force?: boolean } = {}): PolicyInitResult {
  const path = resolve(cwd, options.policyPath ?? DEFAULT_POLICY_PATH);
  const overwritten = existsSync(path);
  if (overwritten && !options.force) {
    throw new Error(`Policy already exists at ${path}. Use --force to overwrite it.`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, STARTER_POLICY, "utf8");
  return { path, overwritten };
}

export interface PolicyDoctorReport {
  policy: QuoratePolicy;
  /** Config gaps that would make the policy unsatisfiable. */
  warnings: string[];
}

/**
 * Validate the resolved policy against the config: required roles must be in the
 * councils and have an enabled provider, and the provider floor must be reachable.
 */
export function policyDoctor(config: QuorateConfig, policy: QuoratePolicy): PolicyDoctorReport {
  const warnings: string[] = [];
  const enabled = config.providers.filter((p) => p.enabled !== false);
  const coveredRoles = new Set(enabled.flatMap((p) => p.roles ?? []));

  for (const role of policy.rolesRequired) {
    if (!config.councils.includes(role)) {
      warnings.push(`required role "${role}" is not in councils — it will never run.`);
    } else if (!coveredRoles.has(role)) {
      warnings.push(`required role "${role}" has no enabled provider assigned — it will never succeed.`);
    }
  }

  if (policy.minRealProviders > 0) {
    const realEnabled = enabled.filter((p) => p.type === "cli" || p.type === "api").length;
    if (realEnabled < policy.minRealProviders) {
      warnings.push(
        `min_real_providers is ${policy.minRealProviders} but only ${realEnabled} non-heuristic provider(s) are enabled.`
      );
    }
  }

  return { policy, warnings };
}

/** Load the last report for `quorate policy explain`, or null if none exists. */
export function loadLastReport(cwd: string, reportPath?: string): CouncilReport | null {
  const path = resolve(cwd, reportPath ?? LAST_REPORT_PATH);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CouncilReport;
  } catch {
    throw new Error(`Could not parse report at ${path} as JSON.`);
  }
}

export { explainPolicy, resolvePolicy };
