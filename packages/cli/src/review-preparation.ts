import {
  analyzeReviewBudget,
  formatBudgetSummary,
  isEmptyReviewDiff,
  type CouncilRequest,
  type QuorateConfig
} from "@quorate/core";

/** One source of truth for one-shot and interactive review preparation. */
export function prepareReviewRequest(request: CouncilRequest, config: QuorateConfig): CouncilRequest {
  if (request.mode !== "review" || request.diff === undefined) return request;
  const analysis = analyzeReviewBudget({
    diff: request.diff,
    config,
    request: {
      mode: request.mode,
      subject: request.subject,
      repoPath: request.repoPath,
      pullRequest: request.pullRequest,
      context: request.context,
      proof: request.proof,
      fullDiff: request.fullDiff,
      repositoryFiles: request.repositoryFiles,
      roleGuidance: request.roleGuidance,
      customHeuristics: request.customHeuristics
    }
  });
  if (isEmptyReviewDiff("review", analysis.diff)) {
    throw new Error("No reviewable changes remain after budget/generated-file filtering.");
  }
  if (!analysis.ok) throw new Error(formatBudgetSummary(analysis.summary));
  return {
    ...request,
    fullDiff: request.fullDiff ?? request.diff,
    diff: analysis.diff,
    budget: analysis.summary
  };
}
