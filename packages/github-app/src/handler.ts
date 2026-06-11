/**
 * Core PR review handler — dependency-injected so the logic is unit-testable
 * without a live GitHub API. The server wires up the real octokit; tests can
 * pass stubs.
 *
 * buildPullRequestDiff and upsertReportComment are re-exported from the
 * github-action source tree (same monorepo); esbuild bundles both packages
 * together so no runtime module boundary exists.
 */
import type { Octokit } from "@octokit/rest";
import {
  createDefaultConfig,
  renderMarkdownReport,
  runCouncil,
  summarizeDiff,
  type QuorateConfig
} from "@quorate/core";
import {
  completeCheckRun,
  createInProgressCheckRun,
  failCheckRun
} from "./check-run.js";
import { buildPullRequestDiff } from "../../github-action/src/diff.js";
import { upsertReportComment } from "../../github-action/src/comment.js";
import { logger } from "./logger.js";

export interface HandlerDeps {
  readonly octokit: Octokit;
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber: number;
  readonly headSha: string;
  readonly installationId: number;
  /** Pre-loaded config for this repo (loaded from base branch or default). */
  readonly config: QuorateConfig;
}

export interface HandlePullRequestResult {
  readonly verdict: string;
  readonly checkRunId: number;
  readonly findingsCount: number;
}

/**
 * Run the full Quorate council for one PR:
 * 1. Open an in-progress Check Run
 * 2. Build the diff
 * 3. Run the council
 * 4. Post the markdown comment
 * 5. Complete the Check Run with verdict + annotations
 */
export async function handlePullRequest(deps: HandlerDeps): Promise<HandlePullRequestResult> {
  const { octokit, owner, repo, pullNumber, headSha, config } = deps;
  const checkDeps = { octokit, owner, repo, headSha };

  const { checkRunId } = await createInProgressCheckRun(checkDeps);

  try {
    const diff = await buildPullRequestDiff(
      octokit as never,
      { owner, repo, pullNumber }
    );

    const report = await runCouncil(
      {
        mode: "review",
        subject: `PR #${pullNumber}`,
        diff,
        repoPath: process.cwd()
      },
      config
    );

    const summary = summarizeDiff(diff);
    const body = renderMarkdownReport(report, { includeMarker: true, summary });

    // Post or update the PR comment (best-effort; a failure must not break the Check Run).
    try {
      await upsertReportComment(octokit as never, {
        owner,
        repo,
        issueNumber: pullNumber,
        body,
        mode: config.github?.commentMode ?? "update"
      });
    } catch (commentErr: unknown) {
      logger.warn("Failed to post PR comment (non-fatal)", {
        error: commentErr instanceof Error ? commentErr.message : String(commentErr)
      });
    }

    await completeCheckRun(checkDeps, { checkRunId, report, markdownSummary: body });

    logger.info("Council complete", {
      owner,
      repo,
      pullNumber,
      verdict: report.verdict,
      findings: report.findings.length
    });

    return { verdict: report.verdict, checkRunId, findingsCount: report.findings.length };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("Council failed", { owner, repo, pullNumber, reason });

    try {
      await failCheckRun(checkDeps, { checkRunId, reason });
    } catch {
      // ignore secondary failure
    }

    throw err;
  }
}

/** Load the Quorate config from the PR's base branch; falls back to default. */
export async function loadRepoConfig(
  octokit: Octokit,
  params: { owner: string; repo: string; ref: string }
): Promise<QuorateConfig> {
  const candidates = [".quorate.yml", ".quorate.yaml", "quorate.config.yml"];

  for (const path of candidates) {
    try {
      const res = await octokit.rest.repos.getContent({
        owner: params.owner,
        repo: params.repo,
        path,
        ref: params.ref
      });
      const data = res.data;
      if (!Array.isArray(data) && data.type === "file") {
        const file = data as { content: string; encoding?: string };
        const decoded = Buffer.from(
          file.content,
          file.encoding === "base64" ? "base64" : "utf8"
        ).toString("utf8");
        const { parseConfig } = await import("@quorate/core");
        return parseConfig(decoded);
      }
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status !== 404) throw err;
    }
  }

  return createDefaultConfig();
}
