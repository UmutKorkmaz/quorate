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

function agreementFor(finding: Finding): string {
  return String(finding.agreement ?? 1);
}

function findingRow(finding: Finding): string {
  return [
    finding.severity,
    agreementFor(finding),
    finding.providerId ?? "",
    finding.role ?? "",
    locationFor(finding),
    finding.title.replaceAll("|", "\\|"),
    finding.body.replaceAll("\n", " ").replaceAll("|", "\\|")
  ].join(" | ");
}

export function renderMarkdownReport(
  report: CouncilReport,
  options: { includeMarker?: boolean; summary?: string } = {}
): string {
  const hasSummary = typeof options.summary === "string" && options.summary.trim().length > 0;
  const lines = [
    options.includeMarker ? reportCommentMarker : undefined,
    "# Quorate Report",
    "",
    `Verdict: **${report.verdict.toUpperCase()}**`,
    report.metadata.degraded ? "" : undefined,
    report.metadata.degraded ? `> ⚠ Degraded: ${report.summary}` : undefined,
    "",
    report.summary,
    hasSummary ? "" : undefined,
    hasSummary ? "## Summary" : undefined,
    hasSummary ? "" : undefined,
    hasSummary ? (options.summary as string) : undefined,
    "",
    "## Findings"
  ].filter((line): line is string => line !== undefined);

  if (report.findings.length === 0) {
    lines.push("", "No findings.");
  } else {
    lines.push(
      "",
      "Severity | Agreement | Provider | Role | Location | Title | Details",
      "--- | --- | --- | --- | --- | --- | ---",
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
  if (github.failOnDegraded === true && report.metadata.degraded) return true;

  const gate = github.gate;
  if (gate) {
    const gateWeight = severityWeight[gate.severity];
    if (
      report.findings.some(
        (finding) =>
          severityWeight[finding.severity] >= gateWeight && (finding.agreement ?? 1) >= gate.minAgreement
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Parses a unified diff and returns a short Markdown summary: a count of files
 * changed and a bulleted list of changed file paths. Returns an empty string
 * for an empty diff. Deterministic and dependency-free.
 */
export function summarizeDiff(diff: string): string {
  if (!diff || diff.trim().length === 0) return "";

  const files: string[] = [];
  const seen = new Set<string>();
  let pendingGitPath: string | undefined;

  const addFile = (path: string): void => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    files.push(path);
  };

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      const path = line.slice("+++ b/".length).trim();
      if (path && path !== "/dev/null") addFile(path);
      pendingGitPath = undefined;
    } else if (line.startsWith("diff --git ")) {
      // Fallback for diffs without +++ headers (e.g. pure renames/mode changes).
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      pendingGitPath = match ? match[2].trim() : undefined;
    } else if (line.startsWith("+++ ") && pendingGitPath) {
      addFile(pendingGitPath);
      pendingGitPath = undefined;
    }
  }

  // Capture any trailing diff --git block that had no usable +++ header.
  if (pendingGitPath) addFile(pendingGitPath);

  if (files.length === 0) return "";

  const heading = `**${files.length} file${files.length === 1 ? "" : "s"} changed**`;
  const bullets = files.map((path) => `- \`${path}\``);
  return [heading, "", ...bullets].join("\n");
}
