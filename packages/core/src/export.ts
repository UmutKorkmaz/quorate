import { findingRuleId } from "./identity.js";
import type { CouncilReport, Finding, Severity } from "./types.js";

/**
 * Report exporters for CI ecosystems beyond the Markdown PR comment:
 *
 * - SARIF 2.1.0 → GitHub Code Scanning (Security tab), GitLab Code Quality.
 * - JUnit XML → CI test dashboards (Jenkins, GitLab, Azure DevOps).
 * - HTML → standalone shareable report.
 *
 * All exporters are pure `(CouncilReport) -> string` functions with no new
 * dependencies. SARIF rule ids come from K0's `findingRuleId`, so a finding
 * class maps to one stable Code Scanning rule across runs.
 */

const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
const HTML_FINDING_LIMIT = 500;

type SarifLevel = "error" | "warning" | "note";

function sarifLevel(severity: Severity): SarifLevel {
  if (severity === "critical" || severity === "high") return "error";
  if (severity === "medium") return "warning";
  return "note";
}

export interface ExportOptions {
  /** Tool version recorded in SARIF `driver.version` (omitted when absent). */
  toolVersion?: string;
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: SarifLevel };
}

interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: { text: string };
  locations?: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: { startLine: number };
    };
  }>;
  partialFingerprints?: Record<string, string>;
}

/** Render a CouncilReport as SARIF 2.1.0 JSON for GitHub Code Scanning. */
export function renderSarif(report: CouncilReport, options: ExportOptions = {}): string {
  const rulesById = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const finding of report.findings) {
    const ruleId = findingRuleId(finding);
    if (!rulesById.has(ruleId)) {
      rulesById.set(ruleId, {
        id: ruleId,
        name: finding.title,
        shortDescription: { text: finding.title },
        defaultConfiguration: { level: sarifLevel(finding.severity) }
      });
    }

    const result: SarifResult = {
      ruleId,
      level: sarifLevel(finding.severity),
      message: { text: finding.body || finding.title }
    };
    if (finding.file) {
      result.locations = [
        {
          physicalLocation: {
            artifactLocation: { uri: finding.file },
            ...(finding.line ? { region: { startLine: finding.line } } : {})
          }
        }
      ];
    }
    if (finding.fingerprint) {
      result.partialFingerprints = { quorateFingerprint: finding.fingerprint };
    }
    results.push(result);
  }

  const driver: Record<string, unknown> = {
    name: "Quorate",
    informationUri: "https://quorate.dev",
    rules: [...rulesById.values()]
  };
  if (options.toolVersion) driver.version = options.toolVersion;

  const sarif = {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [{ tool: { driver }, results }]
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function locationOf(finding: Finding): string {
  if (!finding.file) return "";
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}

/**
 * Render a CouncilReport as JUnit XML. Each finding is a failing testcase so CI
 * test dashboards surface and count them; a clean report is a single passing case.
 */
export function renderJunit(report: CouncilReport): string {
  const findings = report.findings;
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];

  if (findings.length === 0) {
    lines.push('<testsuites name="Quorate" tests="1" failures="0" errors="0">');
    lines.push('  <testsuite name="Quorate review" tests="1" failures="0" errors="0">');
    lines.push('    <testcase name="No blocking findings" classname="quorate" />');
    lines.push("  </testsuite>");
    lines.push("</testsuites>");
    return `${lines.join("\n")}\n`;
  }

  lines.push(`<testsuites name="Quorate" tests="${findings.length}" failures="${findings.length}" errors="0">`);
  lines.push(
    `  <testsuite name="Quorate review" tests="${findings.length}" failures="${findings.length}" errors="0">`
  );
  for (const finding of findings) {
    const loc = locationOf(finding);
    const name = escapeXml(loc ? `${finding.title} (${loc})` : finding.title);
    const classname = escapeXml(finding.file ?? "quorate");
    const detail = escapeXml([finding.body, loc ? `Location: ${loc}` : ""].filter(Boolean).join("\n"));
    lines.push(`    <testcase name="${name}" classname="${classname}">`);
    lines.push(
      `      <failure message="${escapeXml(finding.title)}" type="${escapeXml(finding.severity)}">${detail}</failure>`
    );
    lines.push("    </testcase>");
  }
  lines.push("  </testsuite>");
  lines.push("</testsuites>");
  return `${lines.join("\n")}\n`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#b91c1c",
  high: "#dc2626",
  medium: "#d97706",
  low: "#2563eb",
  info: "#6b7280"
};

/** Render a CouncilReport as a standalone, self-contained HTML document. */
export function renderHtml(report: CouncilReport): string {
  const verdict = report.verdict.toUpperCase();
  const verdictColor = report.verdict === "fail" ? "#dc2626" : report.verdict === "warn" ? "#d97706" : "#16a34a";
  const shown = report.findings.slice(0, HTML_FINDING_LIMIT);
  const truncated = report.findings.length - shown.length;

  const rows = shown
    .map((finding) => {
      const color = SEVERITY_COLOR[finding.severity];
      return `<tr>
      <td><span style="color:${color};font-weight:600">${escapeHtml(finding.severity)}</span></td>
      <td>${escapeHtml(locationOf(finding) || "—")}</td>
      <td><strong>${escapeHtml(finding.title)}</strong><br><span style="color:#4b5563">${escapeHtml(finding.body)}</span></td>
      <td>${finding.agreement ?? 1}</td>
    </tr>`;
    })
    .join("\n");

  const findingsSection =
    shown.length === 0
      ? "<p>No findings.</p>"
      : `<table>
    <thead><tr><th>Severity</th><th>Location</th><th>Finding</th><th>Agreement</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>${truncated > 0 ? `<p class="muted">… ${truncated} more finding(s) truncated.</p>` : ""}`;

  const baselineNote = report.metadata.baselinedFindings
    ? `<p class="muted">${report.metadata.baselinedFindings} finding(s) suppressed by the committed baseline.</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quorate Report — ${escapeHtml(report.metadata.subject)}</title>
<style>
  :root { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #111827; }
  body { max-width: 960px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .verdict { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 6px; color: #fff; font-weight: 700; background: ${verdictColor}; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  th { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; color: #6b7280; }
  .muted { color: #6b7280; font-size: 0.9rem; }
</style>
</head>
<body>
  <h1>Quorate Report</h1>
  <p>Verdict: <span class="verdict">${escapeHtml(verdict)}</span>${report.metadata.degraded ? ' <span class="muted">(heuristic only — not a confident pass)</span>' : ""}</p>
  <p>${escapeHtml(report.summary)}</p>
  ${baselineNote}
  <h2>Findings</h2>
  ${findingsSection}
  <p class="muted">${escapeHtml(report.metadata.subject)} · generated ${escapeHtml(report.metadata.generatedAt)}${report.metadata.reviewId ? ` · review ${escapeHtml(report.metadata.reviewId)}` : ""}</p>
</body>
</html>
`;
}
