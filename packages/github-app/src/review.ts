/**
 * reviewPullRequest — dependency-injected PR review handler for the GitHub App.
 *
 * The function accepts a narrow AppDeps interface so the real Octokit and pure
 * stub objects are both valid callers; no network calls are made outside deps.
 */

import {
  createDefaultConfig,
  detectPacks,
  PACKS,
  renderMarkdownReport,
  runCouncil,
  summarizeDiff,
  type CouncilReport,
  type Finding,
  type QuorateConfig,
  type Severity
} from "@quorate/core";
import { buildPullRequestDiff } from "../../github-action/src/diff.js";
import { upsertReportComment } from "../../github-action/src/comment.js";
import { changedFilesFromDiff } from "../../github-action/src/index.js";
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
  readonly prTitle?: string;
  /** Override config loading — useful for tests. Falls back to base-branch detection. */
  readonly getConfig?: () => Promise<QuorateConfig>;
}

export type CheckRunConclusion = "success" | "failure" | "neutral";

export interface CheckRunResult {
  readonly conclusion: CheckRunConclusion;
  readonly findingsCount: number;
  readonly detectedPacks: string[];
  readonly checkRunId: number;
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

function verdictToConclusion(verdict: CouncilReport["verdict"]): CheckRunConclusion {
  if (verdict === "fail") return "failure";
  if (verdict === "warn") return "neutral";
  return "success";
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

function buildSummary(
  report: CouncilReport,
  detectedPacks: string[],
  markdownBody: string
): string {
  const { verdict, findings } = report;
  const verdictLine = verdict === "fail"
    ? "**Verdict: FAIL** — critical or high-severity findings require attention."
    : verdict === "warn"
      ? "**Verdict: WARN** — medium-severity findings found."
      : "**Verdict: PASS** — no blocking findings.";

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

/** Build an api+heuristic-only config suited for a hosted environment. */
function buildHostedConfig(changedFiles: string[]): QuorateConfig {
  const packIds = detectPacks({ files: changedFiles });
  const detectedPacks = packIds.map((id) => PACKS[id]).filter(Boolean);

  const base = createDefaultConfig([]);
  // Keep only api and mock (heuristic) providers — no CLI providers on a hosted server.
  const apiAndHeuristic = {
    ...base,
    providers: base.providers.map((p) => ({
      ...p,
      enabled: p.type === "api" || p.type === "mock"
    }))
  };

  if (detectedPacks.length === 0) return apiAndHeuristic;

  // Layer detected packs' councils and roleGuidance onto the base config.
  const councils = [...apiAndHeuristic.councils];
  for (const pack of detectedPacks) {
    for (const council of pack.councils) {
      if (!councils.includes(council)) councils.push(council);
    }
  }
  const roleGuidance: Record<string, string> = {};
  for (const pack of detectedPacks) {
    for (const [role, text] of Object.entries(pack.roleGuidance)) {
      if (!(role in roleGuidance)) roleGuidance[role] = text;
    }
  }
  return {
    ...apiAndHeuristic,
    councils,
    roleGuidance: { ...roleGuidance, ...(apiAndHeuristic.roleGuidance ?? {}) }
  };
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
  const createResponse = await octokit.rest.checks.create({
    owner,
    repo,
    name: "Quorate",
    head_sha: headSha,
    status: "in_progress",
    started_at: new Date().toISOString()
  });
  const checkRunId = createResponse.data.id;

  try {
    // 2. Build the diff and detect changed files.
    const diff = await buildPullRequestDiff(octokit as never, { owner, repo, pullNumber });
    const changedFiles = changedFilesFromDiff(diff);

    // 3. Resolve config — caller override → hosted default.
    const config = deps.getConfig
      ? await deps.getConfig()
      : buildHostedConfig(changedFiles);

    const detectedPackIds = detectPacks({ files: changedFiles });

    // 4. Run the council.
    const report = await runCouncil(
      {
        mode: "review",
        subject: `PR #${pullNumber}${prTitle ? `: ${prTitle}` : ""}`,
        diff,
        pullRequest: {
          number: pullNumber,
          title: prTitle
        }
      },
      config
    );

    // 5. Build summary markdown and the PR comment body.
    const diffSummary = summarizeDiff(diff);
    const prCommentBody = renderMarkdownReport(report, { includeMarker: true, summary: diffSummary });
    const checkRunSummary = buildSummary(report, detectedPackIds, prCommentBody);

    // 6. Upsert PR summary comment (best-effort).
    try {
      await upsertReportComment(octokit as never, {
        owner,
        repo,
        issueNumber: pullNumber,
        body: prCommentBody,
        mode: config.github?.commentMode ?? "update"
      });
    } catch (commentErr: unknown) {
      logger.warn("Failed to post PR comment (non-fatal)", {
        error: commentErr instanceof Error ? commentErr.message : String(commentErr)
      });
    }

    // 7. Complete the Check Run with conclusion, annotations, and a re-run action.
    const conclusion = verdictToConclusion(report.verdict);
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
      checkRunId
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
