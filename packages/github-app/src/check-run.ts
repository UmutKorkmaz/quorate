import type { Octokit } from "@octokit/rest";
import type { CouncilReport, Finding } from "@quorate/core";

export type CheckRunConclusion = "success" | "failure" | "neutral";

/** Map Quorate verdicts to GitHub Check Run conclusions. */
export function verdictToConclusion(verdict: CouncilReport["verdict"]): CheckRunConclusion {
  if (verdict === "PASS") return "success";
  if (verdict === "FAIL") return "failure";
  return "neutral"; // WARN
}

/** Cap annotation count to GitHub's per-request limit of 50. */
const MAX_ANNOTATIONS = 50;

interface AnnotationLevel {
  readonly warning: "warning";
  readonly failure: "failure";
  readonly notice: "notice";
}

const annotationLevels: AnnotationLevel = {
  warning: "warning",
  failure: "failure",
  notice: "notice"
};

type GitHubAnnotationLevel = "warning" | "failure" | "notice";

function severityToAnnotationLevel(severity: Finding["severity"]): GitHubAnnotationLevel {
  if (severity === "error") return annotationLevels.failure;
  if (severity === "warning") return annotationLevels.warning;
  return annotationLevels.notice;
}

interface CheckRunAnnotation {
  readonly path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly annotation_level: GitHubAnnotationLevel;
  readonly title: string;
  readonly message: string;
}

/** Convert located findings to GitHub Check Run annotations (capped at 50). */
export function findingsToAnnotations(findings: readonly Finding[]): readonly CheckRunAnnotation[] {
  return findings
    .filter(
      (finding): finding is Finding & { file: string; line: number } =>
        typeof finding.file === "string" &&
        finding.file.length > 0 &&
        typeof finding.line === "number"
    )
    .slice(0, MAX_ANNOTATIONS)
    .map((finding) => ({
      path: finding.file,
      start_line: finding.line,
      end_line: finding.line,
      annotation_level: severityToAnnotationLevel(finding.severity),
      title: finding.title,
      message: finding.body
    }));
}

export interface CheckRunDeps {
  readonly octokit: Octokit;
  readonly owner: string;
  readonly repo: string;
  readonly headSha: string;
}

export interface CreateCheckRunResult {
  readonly checkRunId: number;
}

/** Create an in-progress Check Run at the start of processing. */
export async function createInProgressCheckRun(deps: CheckRunDeps): Promise<CreateCheckRunResult> {
  const response = await deps.octokit.rest.checks.create({
    owner: deps.owner,
    repo: deps.repo,
    name: "Quorate Council",
    head_sha: deps.headSha,
    status: "in_progress",
    started_at: new Date().toISOString()
  });
  return { checkRunId: response.data.id };
}

export interface CompleteCheckRunInput {
  readonly checkRunId: number;
  readonly report: CouncilReport;
  readonly markdownSummary: string;
}

/** Complete the Check Run with verdict, summary, and inline annotations. */
export async function completeCheckRun(
  deps: CheckRunDeps,
  input: CompleteCheckRunInput
): Promise<void> {
  const conclusion = verdictToConclusion(input.report.verdict);
  const annotations = findingsToAnnotations(input.report.findings);

  await deps.octokit.rest.checks.update({
    owner: deps.owner,
    repo: deps.repo,
    check_run_id: input.checkRunId,
    status: "completed",
    conclusion,
    completed_at: new Date().toISOString(),
    output: {
      title: `Quorate: ${input.report.verdict}`,
      summary: input.markdownSummary.slice(0, 65535),
      annotations: annotations as never
    }
  });
}

/** Mark a Check Run as failed due to an internal error. */
export async function failCheckRun(
  deps: CheckRunDeps,
  input: { checkRunId: number; reason: string }
): Promise<void> {
  await deps.octokit.rest.checks.update({
    owner: deps.owner,
    repo: deps.repo,
    check_run_id: input.checkRunId,
    status: "completed",
    conclusion: "failure",
    completed_at: new Date().toISOString(),
    output: {
      title: "Quorate: internal error",
      summary: `The Quorate council encountered an error: ${input.reason}`
    }
  });
}
