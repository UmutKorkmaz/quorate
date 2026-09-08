/**
 * reviewPullRequest — dependency-injected PR review handler for the GitHub App.
 *
 * The function accepts a narrow AppDeps interface so the real Octokit and pure
 * stub objects are both valid callers; no network calls are made outside deps.
 */

import {
  createDefaultConfig,
  createDecisionRecord,
  analyzeReviewBudget,
  applyBaseline,
  applySuppressions,
  detectPacks,
  isBaselineStale,
  PROVIDER_PRESETS,
  renderMarkdownReport,
  resolvePolicy,
  runCouncil,
  shouldFailForPolicy,
  summarizeDiff,
  type CouncilReport,
  type CouncilRequest,
  type DecisionRecord,
  type Finding,
  type QuorateConfig,
  type QuoratePolicy,
  type Severity,
  type BaselineStore,
  type SuppressionStore
} from "@quorate/core";
import pkg from "../package.json" with { type: "json" };
import { buildPullRequestDiff } from "../../github-action/src/diff.js";
import { upsertReportComment } from "../../github-action/src/comment.js";
import { applyPacks, changedFilesFromDiff } from "../../github-action/src/index.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal Octokit surface required by reviewPullRequest. */
export interface AppOctokit {
  paginate: <T>(endpoint: unknown, parameters: Record<string, unknown>) => Promise<T[]>;
  rest: {
    checks: {
      create: (params: Record<string, unknown>) => Promise<{ data: { id: number } }>;
      update: (params: Record<string, unknown>) => Promise<unknown>;
    };
    pulls: {
      listFiles: unknown;
    };
    issues: {
      listComments: unknown;
      createComment: (parameters: never) => Promise<unknown>;
      updateComment: (parameters: never) => Promise<unknown>;
    };
  };
}

/** All external dependencies for reviewPullRequest. Injected for testability. */
export interface AppDeps {
  readonly octokit: AppOctokit;
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber: number;
  readonly headSha: string;
  readonly baseSha?: string;
  readonly prTitle?: string;
  /** Override config loading — useful for tests. Falls back to base-branch detection. */
  readonly getConfig?: () => Promise<QuorateConfig>;
  /**
   * Load the VerdictGate policy (from the base ref). When omitted the gate is
   * derived from the config's `github` block, matching the Action's behavior.
   */
  readonly getPolicy?: () => Promise<QuoratePolicy | null>;
  readonly getBaseline?: () => Promise<BaselineStore | null>;
  readonly getSuppressions?: () => Promise<SuppressionStore | null>;
  readonly getRepositoryFiles?: () => Promise<string[]>;
  /** Verify that both the queued request and GitHub's current PR still match. */
  readonly isCurrent?: () => Promise<boolean>;
  readonly checkRunId?: number;
  readonly externalId?: string;
  readonly onCheckCreated?: (checkRunId: number) => Promise<void>;
}

export type CheckRunConclusion = "success" | "failure" | "neutral" | "cancelled";

export interface CheckRunResult {
  readonly conclusion: CheckRunConclusion;
  readonly findingsCount: number;
  readonly detectedPacks: string[];
  readonly checkRunId: number;
  readonly decision?: DecisionRecord;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type GitHubAnnotationLevel = "warning" | "failure" | "notice";

function severityToAnnotationLevel(severity: Severity): GitHubAnnotationLevel {
  if (severity === "critical" || severity === "high") return "failure";
  if (severity === "medium") return "warning";
  return "notice";
}

/**
 * Map a report to a Check Run conclusion via the merge policy (not the raw
 * verdict), so the App honors `failOn`/agreement/role gates like the CLI and
 * Action: blocked → failure, clean pass → success, anything else → neutral.
 * An explicit `policy` (loaded from the base ref) wins over the github config.
 */
function reportToConclusion(report: CouncilReport, policy: QuoratePolicy): CheckRunConclusion {
  if (shouldFailForPolicy(report, policy)) return "failure";
  return report.verdict === "pass" ? "success" : "neutral";
}

interface CheckRunAnnotation {
  readonly path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly annotation_level: GitHubAnnotationLevel;
  readonly title: string;
  readonly message: string;
}

/** GitHub allows at most 50 annotations per Check Run update call. */
const GITHUB_ANNOTATION_LIMIT = 50;

function findingsToAnnotations(findings: readonly Finding[]): CheckRunAnnotation[] {
  return findings
    .filter(
      (f): f is Finding & { file: string; line: number } =>
        typeof f.file === "string" && f.file.length > 0 && typeof f.line === "number"
    )
    .slice(0, GITHUB_ANNOTATION_LIMIT)
    .map((f) => ({
      path: f.file,
      start_line: f.line,
      end_line: f.line,
      annotation_level: severityToAnnotationLevel(f.severity),
      title: `[${f.severity}] ${f.title}`,
      message: f.body
    }));
}

/** GitHub limits Check Run text to 65,535 bytes; never publish partial JSON. */
function decisionOutput(decision: DecisionRecord): string {
  const json = JSON.stringify(decision, null, 2).replaceAll("`", "\\u0060").replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  const text = `## Portable decision record\n\nContent integrity only; no execution attestation.\n\n\`\`\`json\n${json}\n\`\`\``;
  return Buffer.byteLength(text, "utf8") <= 65_000 ? text
    : `Decision receipt: ${decision.integrity.hash}. The complete record exceeds GitHub's Check Run text limit and was not embedded. It remains available to the host through the review result.`;
}

function buildSummary(
  report: CouncilReport,
  detectedPacks: string[],
  markdownBody: string,
  conclusion: CheckRunConclusion
): string {
  const { verdict, findings } = report;
  // Describe the gate OUTCOME, not just the raw verdict — when the policy makes
  // a fail/warn non-blocking, the text must not claim it "requires attention".
  const verdictLine =
    conclusion === "failure"
      ? `**Verdict: ${verdict.toUpperCase()}** — blocks merge under the current policy.`
      : verdict === "pass"
        ? "**Verdict: PASS** — no blocking findings."
        : `**Verdict: ${verdict.toUpperCase()}** — informational; does not block merge under the current policy.`;

  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  const countLine = Object.entries(counts)
    .map(([sev, n]) => `${n} ${sev}`)
    .join(", ");

  const packsLine =
    detectedPacks.length > 0
      ? `Detected packs: ${detectedPacks.join(", ")}`
      : "No domain packs detected.";

  const byFile: Record<string, Finding[]> = {};
  for (const f of findings) {
    const key = f.file ?? "(unlocated)";
    if (!byFile[key]) byFile[key] = [];
    byFile[key].push(f);
  }
  const fileLines = Object.entries(byFile)
    .map(([file, fs]) => {
      const items = fs.map((f) => `  - **${f.severity}** ${f.title}`).join("\n");
      return `**${file}**\n${items}`;
    })
    .join("\n\n");

  const agreementNote =
    findings.length > 0
      ? `\n\n> Agreement: ${findings.filter((f) => (f.agreement ?? 1) > 1).length} findings confirmed by multiple providers.`
      : "";

  const truncationNote =
    findings.filter((f) => typeof f.file === "string" && typeof f.line === "number").length >
    GITHUB_ANNOTATION_LIMIT
      ? `\n\n> Annotations truncated to ${GITHUB_ANNOTATION_LIMIT} (GitHub limit). See the PR comment for the full report.`
      : "";

  return [
    verdictLine,
    countLine ? `Findings: ${countLine}` : "No findings.",
    packsLine,
    fileLines ? `\n## Findings by file\n\n${fileLines}` : "",
    agreementNote,
    truncationNote,
    "\n---\n_Powered by [Quorate](https://quorate.dev) — multi-agent code review council._"
  ]
    .filter(Boolean)
    .join("\n\n");
}

const HOSTED_ALLOWLIST_ENV = "QUORATE_APP_PROVIDER_ALLOWLIST";
const RESERVED_CREDENTIAL = /^(?:GH_|GITHUB_|GIT_|APP_|QUORATE_|PRIVATE_KEY(?:_|$)|WEBHOOK(?:_|$))/i;

/** A repository cannot select a host credential and an arbitrary destination. */
function hostedProviderPairs(): Set<string> {
  const pairs = new Set(Object.values(PROVIDER_PRESETS)
    .filter((preset) => preset.baseUrl?.startsWith("https://") && preset.apiKeyEnv)
    .map((preset) => `${new URL(preset.baseUrl!).origin}\n${preset.apiKeyEnv}`));
  const raw = process.env[HOSTED_ALLOWLIST_ENV];
  if (raw === undefined) return pairs;
  const invalid = () => new Error(`${HOSTED_ALLOWLIST_ENV} must be a JSON array of approved { origin, apiKeyEnv } pairs; App and GitHub credentials are forbidden.`);
  let entries: unknown;
  try { entries = JSON.parse(raw); } catch { throw invalid(); }
  if (!Array.isArray(entries) || entries.length > 100) throw invalid();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).some((key) => key !== "origin" && key !== "apiKeyEnv")
      || typeof entry.origin !== "string" || typeof entry.apiKeyEnv !== "string"
      || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.apiKeyEnv) || RESERVED_CREDENTIAL.test(entry.apiKeyEnv)) throw invalid();
    let url: URL;
    try { url = new URL(entry.origin); } catch { throw invalid(); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || url.pathname !== "/") throw invalid();
    pairs.add(`${url.origin}\n${entry.apiKeyEnv}`);
  }
  return pairs;
}

/** Build an api+heuristic-only config under the host operator's credential policy. */
export function buildHostedConfig(changedFiles: string[], base = createDefaultConfig([])): QuorateConfig {
  // Apply the hosting boundary after loading repository settings. A base-branch
  // administrator may configure local CLIs, but cannot execute them on this host.
  const pairs = hostedProviderPairs();
  const providers = base.providers.filter((provider) => provider.type === "api" || provider.type === "mock");
  for (const provider of providers) {
    if (provider.type !== "api") continue;
    const invalid = () => new Error("Hosted API provider rejected: repository configuration must use an approved origin and credential pair, without inline environment values or process environment controls.");
    if (provider.env !== undefined || provider.inheritEnv !== undefined || provider.envAllowlist !== undefined) throw invalid();
    // Disabled incomplete entries cannot execute. Validate any configured
    // destination or credential even when disabled, before later role routing.
    if (provider.enabled === false && provider.baseUrl === undefined && provider.apiKeyEnv === undefined) continue;
    if (!provider.baseUrl || !provider.apiKeyEnv || RESERVED_CREDENTIAL.test(provider.apiKeyEnv)) throw invalid();
    let url: URL;
    try { url = new URL(provider.baseUrl); } catch { throw invalid(); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || !pairs.has(`${url.origin}\n${provider.apiKeyEnv}`)) throw invalid();
  }
  return applyPacks({
    ...base,
    providers
  }, "auto", changedFiles);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run the Quorate council for a single PR and surface results as a GitHub
 * Check Run with inline annotations plus a PR summary comment.
 *
 * Fully DI-testable: pass stub octokit/getConfig to exercise without network.
 */
export async function reviewPullRequest(deps: AppDeps): Promise<CheckRunResult> {
  const { octokit, owner, repo, pullNumber, headSha, prTitle } = deps;

  // 1. Open an in-progress Check Run.
  const checkRunId = deps.checkRunId ?? (await octokit.rest.checks.create({
    owner,
    repo,
    name: "Quorate",
    head_sha: headSha,
    external_id: deps.externalId,
    status: "in_progress",
    started_at: new Date().toISOString()
  })).data.id;
  // Persist before doing expensive work. Recovery can also find the remote
  // check by external_id if the process died between create and this write.
  await deps.onCheckCreated?.(checkRunId);

  async function cancelIfStale(): Promise<CheckRunResult | undefined> {
    if (!deps.isCurrent || await deps.isCurrent()) return undefined;
    await octokit.rest.checks.update({
      owner, repo, check_run_id: checkRunId, status: "completed", conclusion: "cancelled",
      completed_at: new Date().toISOString(),
      output: { title: "Quorate: superseded", summary: "The pull request changed. Review the check on its current commit." }
    });
    return { conclusion: "cancelled", findingsCount: 0, detectedPacks: [], checkRunId };
  }

  try {
    const obsolete = await cancelIfStale();
    if (obsolete) return obsolete;
    // 2. Build the diff and detect changed files.
    const diff = await buildPullRequestDiff(octokit as never, { owner, repo, pullNumber });
    const changedFiles = changedFilesFromDiff(diff);

    // 3. Resolve config — caller override → hosted default.
    const config = buildHostedConfig(changedFiles, deps.getConfig ? await deps.getConfig() : undefined);

    const detectedPackIds = detectPacks({ files: changedFiles });
    const policy = deps.getPolicy ? await deps.getPolicy() : null;
    const resolvedPolicy = resolvePolicy(config, { policy: policy ?? undefined });
    const repositoryFiles = config.supplyChain?.enabled && deps.getRepositoryFiles
      ? await deps.getRepositoryFiles() : undefined;
    const budget = analyzeReviewBudget({ diff, config, request: { mode: "review", subject: `PR #${pullNumber}` } });
    if (!budget.ok || !budget.diff.trim()) throw new Error("No reviewable changes remain or the configured review budget was exceeded.");
    const changedDuringLoad = await cancelIfStale();
    if (changedDuringLoad) return changedDuringLoad;

    // 4. Run the council.
    const request: CouncilRequest = {
      mode: "review",
      subject: `PR #${pullNumber}${prTitle ? `: ${prTitle}` : ""}`,
      diff: budget.diff,
      fullDiff: diff,
      budget: budget.summary,
      repositoryFiles,
      pullRequest: { number: pullNumber, title: prTitle }
    };
    let report = await runCouncil(request, config, {
      requiredRoles: resolvedPolicy.rolesRequired,
      minRealProviders: resolvedPolicy.minRealProviders
    });
    const warnings: string[] = [];
    if (deps.getBaseline) {
      try {
        const baseline = await deps.getBaseline();
        if (baseline && !isBaselineStale(baseline)) report = applyBaseline(report, baseline);
        else if (baseline) warnings.push("The committed baseline expired and was not applied.");
      } catch {
        warnings.push("The committed baseline could not be loaded; all findings remain gated.");
      }
    }
    if (deps.getSuppressions) {
      try {
        const suppressions = await deps.getSuppressions();
        if (suppressions) report = applySuppressions(report, suppressions);
      } catch {
        warnings.push("The committed suppressions could not be loaded; no suppressions were applied.");
      }
    }
    const superseded = await cancelIfStale();
    if (superseded) return superseded;

    // 5. Build summary markdown and the PR comment body. The Check Run
    // conclusion is computed first so the summary text matches the gate outcome.
    const decision = createDecisionRecord(request, config, report, resolvedPolicy, {
      toolVersion: pkg.version,
      source: { kind: "pull-request", headSha: /^[a-f0-9]{40,64}$/.test(headSha) ? headSha : undefined,
        baseSha: deps.baseSha && /^[a-f0-9]{40,64}$/.test(deps.baseSha) ? deps.baseSha : undefined }
    });
    report.metadata.decision = decision;
    const conclusion = reportToConclusion(report, resolvedPolicy);
    const diffSummary = summarizeDiff(diff);
    const prCommentBody = renderMarkdownReport(report, { includeMarker: true, summary: diffSummary })
      + warnings.map((warning) => `\n\n> ${warning}`).join("");
    const checkRunSummary = buildSummary(report, detectedPackIds, prCommentBody, conclusion)
      + `\n\nDecision receipt: \`${decision.integrity.hash}\` (content integrity; no execution attestation).`
      + warnings.map((warning) => `\n\n> ${warning}`).join("");

    // 6. Upsert PR summary comment (best-effort).
    try {
      const commentMode = config.github?.commentMode ?? "update";
      if (commentMode !== "off") {
        await upsertReportComment(octokit as never, {
          owner,
          repo,
          issueNumber: pullNumber,
          body: prCommentBody,
          mode: commentMode
        });
      }
    } catch (commentErr: unknown) {
      logger.warn("Failed to post PR comment (non-fatal)", {
        error: commentErr instanceof Error ? commentErr.message : String(commentErr)
      });
    }

    // 7. Complete the Check Run with conclusion, annotations, and a re-run action.
    const annotations = findingsToAnnotations(report.findings);

    await octokit.rest.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      status: "completed",
      conclusion,
      completed_at: new Date().toISOString(),
      output: {
        title: `Quorate: ${report.verdict.toUpperCase()}`,
        summary: checkRunSummary,
        text: decisionOutput(decision),
        annotations
      },
      actions: [
        {
          label: "Re-run",
          description: "Re-run the Quorate review",
          identifier: "rerun"
        }
      ]
    });

    logger.info("Council complete", { owner, repo, pullNumber, verdict: report.verdict });

    return {
      conclusion,
      findingsCount: report.findings.length,
      detectedPacks: detectedPackIds,
      checkRunId,
      decision
    };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("Council failed, marking check run as failure", { owner, repo, pullNumber, reason });

    try {
      await octokit.rest.checks.update({
        owner,
        repo,
        check_run_id: checkRunId,
        status: "completed",
        conclusion: "failure",
        completed_at: new Date().toISOString(),
        output: {
          title: "Quorate: internal error",
          summary: `The Quorate council encountered an error: ${reason}`
        }
      });
    } catch {
      // ignore secondary failure
    }
    throw err;
  }
}
