import { githubConfigToPolicy, shouldFailForPolicy } from "./policy.js";
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
  // Suppressed findings stay visible but are clearly marked as accepted and
  // ungated, so a quiet verdict is never mistaken for a genuinely clean run.
  const title = finding.status === "suppressed" ? `${finding.title} _(suppressed)_` : finding.title;
  return [
    finding.severity,
    agreementFor(finding),
    finding.providerId ?? "",
    finding.role ?? "",
    locationFor(finding),
    title.replaceAll("|", "\\|"),
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
    `Verdict: **${report.verdict.toUpperCase()}**${report.metadata.degraded ? " _(heuristic only — not a confident pass)_" : ""}`,
    "",
    // When degraded, the blockquote already carries the full summary, so the
    // plain paragraph is dropped to avoid printing it twice.
    report.metadata.degraded ? `> ⚠ Degraded: ${report.summary}` : report.summary,
    // Explain a quiet report: "No findings" after a baseline run must be
    // distinguishable from a genuinely clean run.
    report.metadata.baselinedFindings
      ? `\n_(${report.metadata.baselinedFindings} finding${report.metadata.baselinedFindings === 1 ? "" : "s"} suppressed by the committed baseline)_`
      : undefined,
    report.metadata.suppressedFindings
      ? `\n_(${report.metadata.suppressedFindings} finding${report.metadata.suppressedFindings === 1 ? "" : "s"} accepted as suppressed — visible but not gating)_`
      : undefined,
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
  // Suppressed findings stay visible but never count toward the threshold, so a
  // suppressed critical cannot trip the gate. Mirrors the policy engine.
  return report.findings.some(
    (finding) => finding.status !== "suppressed" && severityWeight[finding.severity] >= severityWeight[threshold]
  );
}

/**
 * Backward-compatible gate over the legacy `github:` config. Delegates to the
 * unified policy engine via {@link githubConfigToPolicy}, which reproduces this
 * function's historical behavior exactly. New code should resolve a policy and
 * call {@link shouldFailForPolicy} directly.
 */
export function shouldFailForReport(report: CouncilReport, github: GithubConfig): boolean {
  return shouldFailForPolicy(report, githubConfigToPolicy(github));
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

export interface DiffFileStat {
  path: string;
  added: number;
  removed: number;
}

export interface DiffStats {
  files: DiffFileStat[];
  added: number;
  removed: number;
}

/**
 * Per-file added/removed line counts from a unified diff, for the TUI's diff
 * summary card. Deterministic and dependency-free; counts hunk `+`/`-` lines and
 * ignores the `+++`/`---` headers.
 */
export function diffStats(diff: string): DiffStats {
  const files: DiffFileStat[] = [];
  let current: DiffFileStat | undefined;
  let pendingGitPath: string | undefined;

  const open = (path: string): void => {
    if (!path || path === "/dev/null") {
      current = undefined;
      return;
    }
    current = { path, added: 0, removed: 0 };
    files.push(current);
  };

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      open(line.slice("+++ b/".length).trim());
      pendingGitPath = undefined;
    } else if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      pendingGitPath = match ? match[2].trim() : undefined;
      current = undefined;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      if (current) current.added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      if (current) current.removed += 1;
    } else if (pendingGitPath && (line.startsWith("Binary ") || line.startsWith("rename "))) {
      open(pendingGitPath);
      pendingGitPath = undefined;
    }
  }

  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0)
  };
}
