import { randomUUID } from "node:crypto";
import { runApiProvider } from "./api-provider.js";
import { runCliProvider } from "./cli-provider.js";
import { runHeuristicReview } from "./heuristics.js";
import { computeReviewId, fingerprintFinding } from "./identity.js";
import { createDefaultConfig, defaultCouncils } from "./providers.js";
import { PACKS } from "./packs.js";
import { mergeWithMaster } from "./merge.js";
import { areSameFinding } from "./similarity.js";
import { runSupplyChainReview, supplyChainReviewEnabled } from "./supply-chain.js";
import { runWeb3DdReview, web3DdReviewEnabled } from "./web3-dd.js";
import type {
  QuorateConfig,
  CouncilEvent,
  CouncilReport,
  CouncilRequest,
  Finding,
  ProviderConfig,
  ProviderResult,
  ProviderType,
  RunCouncilOptions,
  Severity,
  Verdict
} from "./types.js";

export type {
  CouncilEvent,
  CouncilReport,
  CouncilRequest,
  RunCouncilOptions,
  ProviderResult,
  Verdict
} from "./types.js";

const severityWeight: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    const severityDelta = severityWeight[right.severity] - severityWeight[left.severity];
    if (severityDelta !== 0) return severityDelta;
    const agreementDelta = (right.agreement ?? 1) - (left.agreement ?? 1);
    if (agreementDelta !== 0) return agreementDelta;
    return left.title.localeCompare(right.title);
  });
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function confidenceFor(agreement: number, severity: Severity): number {
  // Higher agreement and higher severity both raise confidence. Tuned so a
  // lone low/info finding stays modest while corroborated criticals approach 1.
  const severityBoost = (severityWeight[severity] - 1) * 0.05; // 0..0.2
  return clamp01(0.4 + 0.15 * (agreement - 1) + severityBoost);
}

/**
 * Greedily clusters findings that describe the same underlying issue (see
 * `areSameFinding`). Each cluster collapses to a single representative finding:
 * the highest-severity member is the base, annotated with `agreedBy`
 * (sorted unique provider ids), `agreement` (their count), and a derived
 * `confidence`. A missing `suggestion` on the base is filled from any member.
 *
 * Singletons survive untouched — including lone `critical`/`high` findings,
 * which are never dropped just because a single provider raised them
 * (popularity-trap guard).
 */
export function clusterFindings(findings: Finding[]): Finding[] {
  const clusters: Finding[][] = [];

  for (const finding of findings) {
    const target = clusters.find((cluster) =>
      cluster.some((member) => {
        const sameLane = member.providerId === finding.providerId && member.role === finding.role;
        if (sameLane && member.title !== finding.title) {
          return false;
        }
        return areSameFinding(member, finding);
      })
    );
    if (target) {
      target.push(finding);
    } else {
      clusters.push([finding]);
    }
  }

  return clusters.map((cluster) => {
    const base = [...cluster].sort(
      (left, right) => severityWeight[right.severity] - severityWeight[left.severity]
    )[0];

    const agreedBy = [
      ...new Set(
        cluster
          .flatMap((member) => [member.providerId, ...(member.agreedBy ?? [])])
          .filter((id): id is string => Boolean(id))
      )
    ].sort();
    const agreement = agreedBy.length > 0 ? agreedBy.length : 1;
    const suggestion = base.suggestion ?? cluster.find((member) => member.suggestion)?.suggestion;

    return {
      ...base,
      suggestion,
      agreedBy,
      agreement,
      confidence: confidenceFor(agreement, base.severity)
    };
  });
}

/**
 * Findings that count toward a verdict/gate. Suppressed findings are tagged
 * `status: "suppressed"` and remain VISIBLE in the report, but they must never
 * influence the verdict or merge gate — so every gate computation filters them
 * out here. See `applySuppressions` in suppression.ts.
 */
export function activeFindings(findings: Finding[]): Finding[] {
  return findings.filter((finding) => finding.status !== "suppressed");
}

export function verdictFor(findings: Finding[], providerResults: ProviderResult[]): Verdict {
  const active = activeFindings(findings);
  if (active.some((finding) => finding.severity === "critical" || finding.severity === "high")) {
    return "fail";
  }

  if (active.some((finding) => finding.severity === "medium")) {
    return "warn";
  }

  if (providerResults.length > 0 && providerResults.every((result) => result.status === "error")) {
    return "warn";
  }

  return "pass";
}

/**
 * The final verdict including the degraded override: a would-be `pass` is
 * downgraded to `warn` when no real provider succeeded (heuristic-only run).
 * Shared by {@link runCouncil} and baseline re-evaluation so the two can never
 * diverge on how a filtered finding set maps to a verdict.
 */
export function finalVerdict(
  findings: Finding[],
  providerResults: ProviderResult[],
  degraded: boolean
): Verdict {
  const base = verdictFor(findings, providerResults);
  return base === "pass" && degraded ? "warn" : base;
}

export function enabledProviders(config: QuorateConfig): ProviderConfig[] {
  const enabled = config.providers.filter((provider) => provider.enabled !== false);
  if (enabled.length > 0) return enabled;

  return createDefaultConfig().providers.filter((provider) => provider.id === "heuristic");
}

export function buildPlannedLanes(
  config: QuorateConfig
): Array<{ provider: ProviderConfig; role: string }> {
  const providers = enabledProviders(config);
  const lanes: Array<{ provider: ProviderConfig; role: string }> = [];
  for (const provider of providers) {
    const roles =
      provider.roles && provider.roles.length > 0 ? provider.roles : [config.councils[0] ?? "maintainer"];
    for (const role of roles) {
      lanes.push({ provider, role });
    }
  }
  return lanes;
}

function providerTypeOf(provider: ProviderConfig): ProviderType {
  return provider.id === "heuristic" ? "mock" : provider.type;
}

interface RunContext {
  councilRunId: string;
  emit: (event: CouncilEvent) => void;
  signal?: AbortSignal;
}

async function runProvider(
  provider: ProviderConfig,
  role: string,
  request: CouncilRequest,
  ctx: RunContext
): Promise<ProviderResult> {
  const providerType = providerTypeOf(provider);

  if (provider.type === "mock" || provider.id === "heuristic") {
    return { ...runHeuristicReview(request, role), providerType };
  }

  if (provider.type === "api") {
    return {
      ...(await runApiProvider(provider, role, request, { signal: ctx.signal })),
      providerType: "api"
    };
  }

  return runCliProvider(provider, role, request, {
    onChunk: (stream, text) =>
      ctx.emit({
        type: "provider/chunk",
        councilRunId: ctx.councilRunId,
        providerId: provider.id,
        role,
        stream,
        text
      }),
    signal: ctx.signal
  });
}

async function runProviderWithEvents(
  provider: ProviderConfig,
  role: string,
  request: CouncilRequest,
  ctx: RunContext
): Promise<ProviderResult> {
  const providerType = providerTypeOf(provider);
  ctx.emit({
    type: "provider/started",
    councilRunId: ctx.councilRunId,
    providerId: provider.id,
    role,
    providerType,
    at: new Date().toISOString()
  });

  let result: ProviderResult;
  try {
    result = await runProvider(provider, role, request, ctx);
  } catch (error) {
    result = {
      providerId: provider.id,
      role,
      providerType,
      status: "error",
      summary: "Provider run threw before producing a result.",
      findings: [],
      error: error instanceof Error ? error.message : String(error),
      durationMs: 0
    };
  }

  // Guarantee the producer-set providerType is correct even for cli results.
  const finalized: ProviderResult = { ...result, providerType };

  ctx.emit({
    type: "provider/done",
    councilRunId: ctx.councilRunId,
    providerId: provider.id,
    role,
    result: finalized
  });

  return finalized;
}

const DEGRADED_NO_REAL_PROVIDER =
  "Only the built-in heuristic and deterministic reviewers ran — enable a real provider (`/use available`) for a trustworthy verdict.";
const DEGRADED_ALL_REAL_FAILED =
  "All real providers failed or were interrupted — this verdict is based only on deterministic reviewers.";

function supplyChainFailureResult(
  status: "error" | "interrupted",
  summary: string,
  error?: string
): ProviderResult {
  return {
    providerId: "supply-chain",
    role: "supply-chain",
    providerType: "mock",
    status,
    summary,
    findings: [
      {
        providerId: "supply-chain",
        role: "supply-chain",
        severity: "high",
        title: "SupplyChainGate did not complete",
        body:
          "The deterministic supply-chain lane did not finish, so this review cannot prove that dependency, workflow, and container changes were gated.",
        suggestion: "Re-run the review and require SupplyChainGate to complete before merging."
      }
    ],
    error,
    durationMs: 0
  };
}

type ProviderLane = ReturnType<typeof buildPlannedLanes>[number];
type Routing = NonNullable<CouncilReport["metadata"]["routing"]>;
const KNOWN_ROLES = new Set([...defaultCouncils, ...Object.values(PACKS).flatMap((pack) => pack.councils)]);

function routeAdaptiveLanes(
  lanes: ProviderLane[], request: CouncilRequest, deterministic: ProviderResult[],
  options: RunCouncilOptions | undefined, maxParallelProviders: number
): { selected: Set<ProviderLane>; routing: Routing } {
  const diff = request.fullDiff ?? request.diff ?? "";
  const headers = diff.split(/\r?\n/).filter((line) => line.startsWith("diff --git "));
  const paths = headers.flatMap((line) => {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    return match ? [match[1], match[2]] : [];
  });
  const completePaths = request.mode === "review" && paths.length > 0 && paths.length === headers.length * 2;
  const highRisk = deterministic.some((result) => result.status !== "ok" || activeFindings(result.findings).some((finding) =>
    finding.severity === "high" || finding.severity === "critical")) ||
    paths.some((path) => /(?:^|\/)(?:\.github|migrations?|auth|security|payments?|contracts?)(?:\/|\.)|(?:^|\/)(?:Dockerfile|package\.json|SECURITY\.md)$|\.(?:sol|tf)$/i.test(path)) ||
    /\[(?:diff|patch)[^\]]*(?:omitted|truncated)|(?:GIT binary patch|Binary files .* differ)/i.test(diff);
  const docsOnly = completePaths && paths.every((path) => /\.(?:md|rst|txt)$/i.test(path));
  const testsOnly = completePaths && paths.every((path) => /(?:^|\/)(?:__tests__|tests?|specs?)\/|\.(?:test|spec)\.[^/]+$/i.test(path));
  const risk: Routing["risk"] = highRisk ? "high" : docsOnly || testsOnly ? "low" : "standard";
  const required = new Set(options?.requiredRoles ?? []);
  const reasons = new Map<ProviderLane, string>();
  for (const lane of lanes) {
    const role = lane.role;
    const reason = required.has(role) ? "Required by policy"
      : risk !== "low" ? (risk === "high" ? "Escalated by deterministic evidence or sensitive paths" : "Full review for mixed, code, or unknown input")
        : role === "maintainer" || role === "architect" ? "General review retained"
          : !KNOWN_ROLES.has(role) ? "Custom role retained conservatively"
            : testsOnly && role === "qa" ? "Test changes require QA review"
              : undefined;
    if (reason) reasons.set(lane, reason);
  }
  const realIds = new Set([...reasons.keys()].filter((lane) => providerTypeOf(lane.provider) !== "mock").map((lane) => lane.provider.id));
  const floor = Math.max(1, options?.minRealProviders ?? 0);
  for (const lane of lanes) {
    if (realIds.size >= floor) break;
    if (providerTypeOf(lane.provider) === "mock" || realIds.has(lane.provider.id)) continue;
    reasons.set(lane, "Retained to meet the real-provider floor");
    realIds.add(lane.provider.id);
  }
  const selected = new Set(reasons.keys());
  const entry = (lane: ProviderLane, reason: string) => ({ providerId: lane.provider.id, role: lane.role, reason });
  return {
    selected,
    routing: {
      mode: "adaptive", risk, maxParallelProviders,
      selected: lanes.filter((lane) => selected.has(lane)).map((lane) => entry(lane, reasons.get(lane)!)),
      skipped: lanes.filter((lane) => !selected.has(lane)).map((lane) => entry(lane,
        docsOnly ? "Documentation-only changes do not select this specialist" : "Test-only changes do not select this specialist"))
    }
  };
}

function unrunLane(lane: ProviderLane, status: "skipped" | "interrupted", summary: string, ctx: RunContext): ProviderResult {
  const result: ProviderResult = {
    providerId: lane.provider.id, role: lane.role, providerType: providerTypeOf(lane.provider),
    status, summary, findings: [], durationMs: 0
  };
  ctx.emit({ type: "provider/done", councilRunId: ctx.councilRunId, providerId: lane.provider.id, role: lane.role, result });
  return result;
}

async function runLanes(lanes: ProviderLane[], request: CouncilRequest, ctx: RunContext, limit?: number): Promise<ProviderResult[]> {
  const run = async (lane: ProviderLane): Promise<ProviderResult> => {
    try {
      return await runProviderWithEvents(lane.provider, lane.role, request, ctx);
    } catch (error) {
      return {
        providerId: lane.provider.id, role: lane.role, providerType: providerTypeOf(lane.provider), status: "error",
        summary: "Provider run rejected unexpectedly.", findings: [],
        error: error instanceof Error ? error.message : String(error), durationMs: 0
      };
    }
  };
  if (limit === undefined) return Promise.all(lanes.map(run));
  const results = new Array<ProviderResult>(lanes.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, lanes.length) }, async () => {
    while (next < lanes.length) {
      const index = next++;
      const lane = lanes[index];
      results[index] = ctx.signal?.aborted
        ? unrunLane(lane, "interrupted", "Provider run interrupted before it started.", ctx)
        : await run(lane);
    }
  }));
  return results;
}

export async function runCouncil(
  request: CouncilRequest,
  config: QuorateConfig = createDefaultConfig(),
  options?: RunCouncilOptions
): Promise<CouncilReport> {
  const startedAt = Date.now();
  const adaptive = config.execution?.mode === "adaptive";
  const maxParallelProviders = config.execution?.maxParallelProviders ?? 3;
  if (adaptive && (!Number.isInteger(maxParallelProviders) || maxParallelProviders < 1 || maxParallelProviders > 16)) {
    throw new Error("execution.maxParallelProviders must be an integer from 1 to 16.");
  }
  if (adaptive && options?.minRealProviders !== undefined && (!Number.isInteger(options.minRealProviders) || options.minRealProviders < 0)) {
    throw new Error("minRealProviders must be a nonnegative integer.");
  }
  const councilRunId = randomUUID();
  const signal = options?.signal;
  const onEvent = options?.onEvent;

  const emit = (event: CouncilEvent): void => {
    if (!onEvent) return;
    try {
      onEvent(event);
    } catch {
      // A misbehaving subscriber must never break the council run.
    }
  };

  const ctx: RunContext = { councilRunId, emit, signal };
  const lanes = buildPlannedLanes(config);
  if (adaptive && !lanes.some((lane) => lane.provider.id === "heuristic")) {
    lanes.unshift({ provider: { id: "heuristic", type: "mock" }, role: "maintainer" });
  }
  const includeSupplyChain = supplyChainReviewEnabled(request, config);
  const includeWeb3Dd = web3DdReviewEnabled(config, request);
  const supplyChainProviderType: ProviderType = "mock";
  const web3DdProviderType: ProviderType = config.integrations?.webacy?.enabled === true ? "api" : "mock";

  const requestedProviders = [
    ...lanes.map((lane) => `${lane.provider.id}:${lane.role}`),
    ...(includeSupplyChain ? ["supply-chain:supply-chain"] : []),
    ...(includeWeb3Dd ? ["web3-dd:web3-due-diligence"] : [])
  ];

  emit({
    type: "council/started",
    councilRunId,
    mode: request.mode,
    subject: request.subject,
    planned: [
      ...lanes.map((lane) => ({
        providerId: lane.provider.id,
        role: lane.role,
        providerType: providerTypeOf(lane.provider)
      })),
      ...(includeSupplyChain
        ? [{ providerId: "supply-chain", role: "supply-chain", providerType: supplyChainProviderType }]
        : []),
      ...(includeWeb3Dd
        ? [{ providerId: "web3-dd", role: "web3-due-diligence", providerType: web3DdProviderType }]
        : [])
    ],
    at: new Date().toISOString(),
    // Optional nesting marker: consumers that predate it see no field at all.
    ...(options?.parent ? { parentRunId: options.parent.runId, parentLane: options.parent.lane } : {})
  });

  // Carry per-role guidance and trusted custom heuristics into every provider
  // prompt / heuristic lane.
  const reviewRequest: CouncilRequest = {
    ...request,
    roleGuidance: config.roleGuidance
      ? { ...(request.roleGuidance ?? {}), ...config.roleGuidance }
      : request.roleGuidance,
    customHeuristics: config.customHeuristics ?? request.customHeuristics
  };

  const providerResults: ProviderResult[] = [];
  let routing: Routing | undefined;
  const runSupplyChainLane = (): void => {
    if (includeSupplyChain) {
      emit({
        type: "provider/started",
        councilRunId,
        providerId: "supply-chain",
        role: "supply-chain",
        providerType: supplyChainProviderType,
        at: new Date().toISOString()
      });

      let supplyChainResult: ProviderResult;
      if (signal?.aborted) {
        supplyChainResult = supplyChainFailureResult(
          "interrupted",
          "SupplyChainGate review was interrupted before it started."
        );
      } else {
        try {
          supplyChainResult =
            runSupplyChainReview(reviewRequest, config) ??
            supplyChainFailureResult(
              "error",
              "SupplyChainGate was planned but did not produce a result."
            );
        } catch (error) {
          supplyChainResult = supplyChainFailureResult(
            "error",
            "SupplyChainGate review threw before producing a result.",
            error instanceof Error ? error.message : String(error)
          );
        }
      }

      providerResults.push(supplyChainResult);
      emit({
        type: "provider/done",
        councilRunId,
        providerId: "supply-chain",
        role: "supply-chain",
        result: supplyChainResult
      });
    }
  };

  if (adaptive) {
    const deterministic = lanes.filter((lane) => providerTypeOf(lane.provider) === "mock");
    providerResults.push(...await runLanes(deterministic, reviewRequest, ctx, 1));
    runSupplyChainLane();
    const models = lanes.filter((lane) => providerTypeOf(lane.provider) !== "mock");
    const decision = routeAdaptiveLanes(models, reviewRequest, providerResults, options, maxParallelProviders);
    routing = decision.routing;
    routing.selected.unshift(...providerResults.map((result) => ({ providerId: result.providerId, role: result.role, reason: "Deterministic preflight" })));
    if (includeWeb3Dd) routing.selected.push({ providerId: "web3-dd", role: "web3-due-diligence", reason: "Configured external evidence lane retained" });
    const selected = models.filter((lane) => decision.selected.has(lane));
    const results = await runLanes(selected, reviewRequest, ctx, maxParallelProviders);
    const byLane = new Map(selected.map((lane, index) => [lane, results[index]]));
    providerResults.push(...models.map((lane) => byLane.get(lane) ?? unrunLane(lane, "skipped",
      routing!.skipped.find((entry) => entry.providerId === lane.provider.id && entry.role === lane.role)!.reason, ctx)));
  } else {
    providerResults.push(...await runLanes(lanes, reviewRequest, ctx));
    runSupplyChainLane();
  }
  if (includeWeb3Dd && !signal?.aborted) {
    try {
      const web3DdResult = await runWeb3DdReview(reviewRequest, config, { signal });
      if (web3DdResult) providerResults.push(web3DdResult);
    } catch (error) {
      providerResults.push({
        providerId: "web3-dd",
        role: "web3-due-diligence",
        providerType: web3DdProviderType,
        status: "error",
        summary: "Web3 DD review threw before producing a result.",
        findings: [],
        error: error instanceof Error ? error.message : String(error),
        durationMs: 0
      });
    }
  }

  // Optional master-agent merge: a selected provider semantically dedupes the
  // raw findings before the built-in clustering (which still runs after, both
  // as a safety net and to compute agreement on anything the master missed).
  const rawFindings = providerResults.flatMap((result) => result.findings);
  let workingFindings = rawFindings;
  let mergedBy: string | undefined;
  const masterId = config.merge?.provider;
  if (masterId && rawFindings.length > 1 && !signal?.aborted) {
    const master = config.providers.find((provider) => provider.id === masterId);
    if (master) {
      const merged = await mergeWithMaster(master, rawFindings, signal);
      if (merged) {
        workingFindings = merged;
        mergedBy = master.id;
      }
    }
  }

  const findings = sortFindings(clusterFindings(workingFindings)).map((finding) => ({
    ...finding,
    fingerprint: fingerprintFinding(finding)
  }));
  const realOk = providerResults.filter(
    (result) =>
      (result.providerType === "cli" || result.providerType === "api") && result.status === "ok"
  );
  const degraded = realOk.length === 0;
  const verdict = finalVerdict(findings, providerResults, degraded);

  const ranProviders = providerResults
    .filter((result) => result.status !== "skipped")
    .map((result) => `${result.providerId}:${result.role}`);

  const issueCount = findings.length;
  const countSummary =
    issueCount > 0
      ? `Quorate found ${issueCount} finding${issueCount === 1 ? "" : "s"} across ${providerResults.length} review run${providerResults.length === 1 ? "" : "s"}.`
      : `Quorate found no blocking findings across ${providerResults.length} review run${providerResults.length === 1 ? "" : "s"}.`;

  let summary = countSummary;
  if (degraded) {
    const anyRealProviderEnabled = lanes.some(
      (lane) => providerTypeOf(lane.provider) === "cli" || providerTypeOf(lane.provider) === "api"
    );
    const note = anyRealProviderEnabled ? DEGRADED_ALL_REAL_FAILED : DEGRADED_NO_REAL_PROVIDER;
    summary = `${note} ${countSummary}`;
  }

  const report: CouncilReport = {
    verdict,
    summary,
    findings,
    providerResults,
    metadata: {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      ...(routing ? { routing } : {}),
      mode: request.mode,
      subject: request.subject,
      providers: ranProviders,
      requestedProviders,
      ranProviders,
      degraded,
      mergedBy,
      budget: request.budget,
      reviewId: computeReviewId({
        mode: request.mode,
        subject: request.subject,
        diff: includeSupplyChain ? request.fullDiff ?? request.diff : request.diff,
        providerIds: [
          ...lanes.map((lane) => lane.provider.id),
          ...(includeSupplyChain ? ["supply-chain"] : [])
        ],
        councils: config.councils
      })
    }
  };

  emit({ type: "council/done", councilRunId, report });
  emit({ type: "verdict", councilRunId, report });

  return report;
}
