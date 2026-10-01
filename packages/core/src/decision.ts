import { createHash } from "node:crypto";
import { z } from "zod";
import { fingerprintFinding } from "./identity.js";
import { explainPolicy } from "./policy.js";
import { redactSecrets } from "./redact.js";
import { severities, verdicts, type CouncilReport, type CouncilRequest, type QuorateConfig, type QuoratePolicy } from "./types.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const strings = z.array(z.string()).max(10_000);
const sourceSchema = z.object({
  kind: z.enum(["diff", "git", "worktree", "pull-request", "plan"]),
  baseSha: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
  headSha: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
  worktreeHash: digest.optional()
}).strict();
export type DecisionSource = z.infer<typeof sourceSchema>;

const policySchema = z.object({
  enabled: z.boolean(), blockOnVerdict: z.array(z.enum(verdicts)), allowWarnMerge: z.boolean(),
  failOn: z.union([z.enum(severities), z.literal("never")]), failOnDegraded: z.boolean(),
  gate: z.object({ severity: z.enum(severities), minAgreement: z.number().int().positive() }).strict().optional(),
  rolesRequired: strings, minRealProviders: z.number().int().nonnegative()
}).strict();

const decisionSchema = z.object({
  schemaVersion: z.literal(1), generatedAt: z.string().datetime({ offset: true }),
  reviewId: z.string().optional(), toolVersion: z.string().optional(), source: sourceSchema,
  inputs: z.object({ mode: z.enum(["review", "plan"]), diffHash: digest, contextHash: digest.optional(), proofHash: digest.optional() }).strict(),
  configurationHash: digest,
  policy: z.object({ status: z.enum(["resolved", "unavailable"]), hash: digest, value: policySchema }).strict(),
  result: z.object({ verdict: z.enum(verdicts), degraded: z.boolean() }).strict(),
  gate: z.object({ blocked: z.boolean(), reasons: strings }).strict(),
  providers: z.array(z.object({
    id: z.string(), role: z.string(), type: z.enum(["cli", "api", "heuristic", "mock"]),
    model: z.string().optional(), status: z.enum(["ok", "error", "skipped", "interrupted"]),
    durationMs: z.number().nonnegative(), outputHash: digest.optional()
  }).strict()).max(10_000),
  findings: z.array(z.object({
    fingerprint: z.string().regex(/^[a-f0-9]{16}$/), severity: z.enum(severities),
    title: z.string(), file: z.string().optional(), line: z.number().optional(),
    status: z.enum(["active", "suppressed"]).optional(), agreedBy: strings, agreement: z.number().nonnegative()
  }).strict()).max(100_000),
  coverage: z.object({ requested: strings, completed: strings, failed: strings, limitations: strings,
    routing: z.object({ mode: z.literal("adaptive"), risk: z.enum(["low", "standard", "high"]), maxParallelProviders: z.number().int().min(1).max(16),
      selected: z.array(z.object({ providerId: z.string(), role: z.string(), reason: z.string() }).strict()),
      skipped: z.array(z.object({ providerId: z.string(), role: z.string(), reason: z.string() }).strict()) }).strict().optional()
  }).strict(),
  integrity: z.object({ kind: z.literal("sha256-content"), attestation: z.literal("none"), hash: digest }).strict()
}).strict();

export type DecisionRecord = z.infer<typeof decisionSchema>;

/** Canonical encoding preserves regex rule semantics and omits undefined object fields. */
function canonical(value: unknown): string {
  if (value instanceof RegExp) return canonical({ source: value.source, flags: value.flags });
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function decisionInputHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function hash(value: unknown): string { return decisionInputHash(canonical(value)); }

/** A portable evidence commitment, not a signature or an assertion of trusted execution. */
export function createDecisionRecord(
  request: CouncilRequest, config: QuorateConfig, report: CouncilReport, policy: QuoratePolicy,
  options: { toolVersion?: string; source?: DecisionSource; policyUnavailable?: boolean } = {}
): DecisionRecord {
  const explanation = explainPolicy(report, policy);
  const limitations: string[] = [];
  if (!request.proof) limitations.push("No proof execution evidence is attached.");
  if (options.policyUnavailable) limitations.push("Committed policy could not be loaded; merge is blocked and the displayed policy is only a fallback.");
  if (request.proof?.truncated) limitations.push("Attached proof output is truncated.");
  if (report.metadata.degraded) limitations.push("Review coverage is degraded.");
  const failed = report.providerResults.filter((result) => result.status !== "ok").map((result) => `${result.providerId}:${result.role}`);
  if (failed.length) limitations.push("Some requested provider lanes did not complete successfully.");
  if (!report.providerResults.some((result) => (result.providerType === "api" || result.providerType === "cli") && result.status === "ok")) {
    limitations.push("No real AI provider completed successfully.");
  }
  const source = options.source ?? { kind: request.mode === "plan" ? "plan" : "diff" };
  if (source.kind === "diff" || (source.kind === "pull-request" && !source.headSha)) limitations.push("Source revision was not established; this record binds the supplied diff only.");
  const safeConfig = { ...config, providers: config.providers.map((provider) => ({
    ...provider, env: provider.env ? Object.keys(provider.env).sort() : undefined,
    args: provider.args?.map((arg) => redactSecrets(arg)), baseUrl: provider.baseUrl ? redactSecrets(provider.baseUrl.replace(/(\/\/)[^/@\s]+@/, "$1[redacted]@")) : undefined
  })) };
  const body = {
    schemaVersion: 1 as const, generatedAt: report.metadata.generatedAt, reviewId: report.metadata.reviewId,
    toolVersion: options.toolVersion, source,
    inputs: { mode: request.mode, diffHash: decisionInputHash(request.fullDiff ?? request.diff ?? request.subject),
      contextHash: request.context === undefined ? undefined : decisionInputHash(request.context),
      proofHash: request.proof === undefined ? undefined : decisionInputHash(request.proof.content) },
    configurationHash: hash(safeConfig), policy: { status: options.policyUnavailable ? "unavailable" : "resolved", hash: hash(policy), value: policy },
    result: { verdict: report.verdict, degraded: report.metadata.degraded },
    gate: { blocked: options.policyUnavailable || explanation.fail, reasons: options.policyUnavailable ? ["Committed merge policy is unavailable."] : explanation.reasons },
    providers: report.providerResults.map((result) => ({
      id: result.providerId, role: result.role, type: result.providerType,
      model: config.providers.find((provider) => provider.id === result.providerId)?.model,
      status: result.status, durationMs: result.durationMs,
      outputHash: result.rawOutput === undefined ? undefined : decisionInputHash(result.rawOutput)
    })),
    findings: report.findings.map((finding) => ({
      fingerprint: fingerprintFinding(finding), severity: finding.severity, title: redactSecrets(finding.title) ?? finding.title,
      file: finding.file, line: finding.line, status: finding.status,
      agreedBy: [...new Set(finding.agreedBy ?? (finding.providerId ? [finding.providerId] : []))].sort(),
      agreement: finding.agreement ?? 1
    })),
    coverage: { requested: report.metadata.requestedProviders,
      completed: report.providerResults.filter((result) => result.status === "ok").map((result) => `${result.providerId}:${result.role}`),
      failed, limitations, routing: report.metadata.routing }
  };
  return decisionSchema.parse({ ...body, integrity: { kind: "sha256-content", attestation: "none", hash: hash(body) } });
}

export function validateDecisionRecord(value: unknown): value is DecisionRecord {
  try {
    const parsed = decisionSchema.safeParse(value);
    if (!parsed.success) return false;
    const { integrity, ...body } = parsed.data;
    return hash(body) === integrity.hash && hash(body.policy.value) === body.policy.hash;
  } catch { return false; }
}
