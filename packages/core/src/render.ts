import type { CouncilReport, Finding, GithubConfig, Severity } from "./types.js";

export const reportCommentMarker = "<!-- quorate-report -->";

const severityWeight: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

function locationFor(finding: Finding): string {
  if (!finding.file) return "";
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}

function findingRow(finding: Finding): string {
  return [
    finding.severity,
    finding.providerId ?? "",
    finding.role ?? "",
    locationFor(finding),
    finding.title.replaceAll("|", "\\|"),
    finding.body.replaceAll("\n", " ").replaceAll("|", "\\|")
  ].join(" | ");
}

export function renderMarkdownReport(report: CouncilReport, options: { includeMarker?: boolean } = {}): string {
  const lines = [
    options.includeMarker ? reportCommentMarker : undefined,
    "# Quorate Report",
    "",
    `Verdict: **${report.verdict.toUpperCase()}**`,
    report.metadata.degraded ? "" : undefined,
    report.metadata.degraded ? `> ⚠ Degraded: ${report.summary}` : undefined,
    "",
    report.summary,
    "",
    "## Findings"
  ].filter((line): line is string => line !== undefined);

  if (report.findings.length === 0) {
    lines.push("", "No findings.");
  } else {
    lines.push(
      "",
      "Severity | Provider | Role | Location | Title | Details",
      "--- | --- | --- | --- | --- | ---",
      ...report.findings.map(findingRow)
    );
  }

  lines.push("", "## Provider Runs", "", "Provider | Role | Status | Summary", "--- | --- | --- | ---");
  for (const result of report.providerResults) {
    lines.push(
      [
        result.providerId,
        result.role,
        result.status,
        result.summary.replaceAll("\n", " ").replaceAll("|", "\\|")
      ].join(" | ")
    );
  }

  lines.push("", `Generated: ${report.metadata.generatedAt}`);
  return `${lines.join("\n")}\n`;
}

export function shouldFailForThreshold(report: CouncilReport, threshold: Severity | "never"): boolean {
  if (threshold === "never") return false;
  return report.findings.some((finding) => severityWeight[finding.severity] >= severityWeight[threshold]);
}

export function shouldFailForReport(report: CouncilReport, github: GithubConfig): boolean {
  if (shouldFailForThreshold(report, github.failOn)) return true;
  return github.failOnDegraded === true && report.metadata.degraded;
}
