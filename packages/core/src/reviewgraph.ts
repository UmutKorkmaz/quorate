import type { CouncilReport } from "./types.js";

export interface ReviewGraphProviderNode {
  id: string;
  roles: string[];
  status: string;
}

export interface ReviewGraphFindingNode {
  id: string;
  severity: string;
  title: string;
  file?: string;
  line?: number;
  agreement: number;
  confidence?: number;
}

export interface ReviewGraphEdge {
  providerId: string;
  findingId: string;
}

export interface ReviewGraph {
  reviewId?: string;
  verdict: string;
  generatedAt: string;
  providers: ReviewGraphProviderNode[];
  findings: ReviewGraphFindingNode[];
  edges: ReviewGraphEdge[];
}

function findingId(index: number, fingerprint?: string): string {
  return fingerprint ?? `finding-${index + 1}`;
}

export function buildReviewGraph(report: CouncilReport): ReviewGraph {
  const providers = new Map<string, ReviewGraphProviderNode>();
  for (const result of report.providerResults) {
    const current = providers.get(result.providerId) ?? { id: result.providerId, roles: [], status: result.status };
    if (!current.roles.includes(result.role)) current.roles.push(result.role);
    if (current.status === "ok" && result.status !== "ok") current.status = result.status;
    providers.set(result.providerId, current);
  }

  const findings = report.findings.map((finding, index) => ({
    id: findingId(index, finding.fingerprint),
    severity: finding.severity,
    title: finding.title,
    file: finding.file,
    line: finding.line,
    agreement: finding.agreement ?? 1,
    confidence: finding.confidence
  }));

  const edges: ReviewGraphEdge[] = [];
  report.findings.forEach((finding, index) => {
    const id = findingId(index, finding.fingerprint);
    const agreedBy = finding.agreedBy && finding.agreedBy.length > 0
      ? finding.agreedBy
      : finding.providerId
        ? [finding.providerId]
        : [];
    for (const providerId of agreedBy) edges.push({ providerId, findingId: id });
  });

  return {
    reviewId: report.metadata.reviewId,
    verdict: report.verdict,
    generatedAt: report.metadata.generatedAt,
    providers: [...providers.values()].sort((a, b) => a.id.localeCompare(b.id)),
    findings,
    edges
  };
}

export function renderReviewGraph(report: CouncilReport): string {
  return `${JSON.stringify(buildReviewGraph(report), null, 2)}\n`;
}

export function renderReviewGraphMarkdown(report: CouncilReport, limit = 10): string {
  if (report.findings.length === 0) return "No agreement graph: no findings.";
  const rows = report.findings.slice(0, limit).map((finding) => {
    const providers = finding.agreedBy?.length ? finding.agreedBy.join(", ") : finding.providerId ?? "unknown";
    const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : "";
    return `- ${finding.agreement ?? 1} reviewer(s): ${finding.severity} ${finding.title}${location ? ` (${location})` : ""} - ${providers}`;
  });
  const hidden = report.findings.length - rows.length;
  if (hidden > 0) rows.push(`- ${hidden} more finding(s) omitted.`);
  return rows.join("\n");
}
