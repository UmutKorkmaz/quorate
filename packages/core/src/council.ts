import { randomUUID } from "node:crypto";
import { runCliProvider } from "./cli-provider.js";
import { runHeuristicReview } from "./heuristics.js";
import { createDefaultConfig } from "./providers.js";
import { areSameFinding } from "./similarity.js";
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
      cluster.some((member) => areSameFinding(member, finding))
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
          .map((member) => member.providerId)
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

export function verdictFor(findings: Finding[], providerResults: ProviderResult[]): Verdict {
  if (findings.some((finding) => finding.severity === "critical" || finding.severity === "high")) {
    return "fail";
  }

  if (findings.some((finding) => finding.severity === "medium")) {
    return "warn";
  }

  if (providerResults.length > 0 && providerResults.every((result) => result.status === "error")) {
    return "warn";
  }

  return "pass";
}

function enabledProviders(config: QuorateConfig): ProviderConfig[] {
  const enabled = config.providers.filter((provider) => provider.enabled !== false);
  if (enabled.length > 0) return enabled;

  return createDefaultConfig().providers.filter((provider) => provider.id === "heuristic");
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
      providerId: provider.id,
      role,
      providerType,
      status: "skipped",
      summary: "API providers are configurable but not implemented in the local MVP.",
      findings: [],
      durationMs: 0
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
  "Only the built-in heuristic ran — enable a real provider (`/use available`) for a trustworthy verdict.";
const DEGRADED_ALL_REAL_FAILED =
  "All real providers failed or were interrupted — this verdict is based only on the heuristic.";

export async function runCouncil(
  request: CouncilRequest,
  config: QuorateConfig = createDefaultConfig(),
  options?: RunCouncilOptions
): Promise<CouncilReport> {
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
  const providers = enabledProviders(config);

  const lanes: Array<{ provider: ProviderConfig; role: string }> = [];
  for (const provider of providers) {
    const roles =
      provider.roles && provider.roles.length > 0 ? provider.roles : [config.councils[0] ?? "maintainer"];
    for (const role of roles) {
      lanes.push({ provider, role });
    }
  }

  const requestedProviders = lanes.map((lane) => `${lane.provider.id}:${lane.role}`);

  emit({
    type: "council/started",
    councilRunId,
    mode: request.mode,
    subject: request.subject,
    planned: lanes.map((lane) => ({
      providerId: lane.provider.id,
      role: lane.role,
      providerType: providerTypeOf(lane.provider)
    })),
    at: new Date().toISOString()
  });

  const settled = await Promise.allSettled(
    lanes.map((lane) => runProviderWithEvents(lane.provider, lane.role, request, ctx))
  );

  const providerResults: ProviderResult[] = settled.map((outcome, index) => {
    if (outcome.status === "fulfilled") return outcome.value;
    const lane = lanes[index];
    return {
      providerId: lane.provider.id,
      role: lane.role,
      providerType: providerTypeOf(lane.provider),
      status: "error",
      summary: "Provider run rejected unexpectedly.",
      findings: [],
      error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      durationMs: 0
    };
  });

  const findings = sortFindings(clusterFindings(providerResults.flatMap((result) => result.findings)));
  const baseVerdict = verdictFor(findings, providerResults);

  const realOk = providerResults.filter(
    (result) =>
      (result.providerType === "cli" || result.providerType === "api") && result.status === "ok"
  );
  const degraded = realOk.length === 0;
  const verdict: Verdict = baseVerdict === "pass" && degraded ? "warn" : baseVerdict;

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
      mode: request.mode,
      subject: request.subject,
      providers: ranProviders,
      requestedProviders,
      ranProviders,
      degraded
    }
  };

  emit({ type: "council/done", councilRunId, report });

  return report;
}
