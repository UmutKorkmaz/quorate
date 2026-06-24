export interface PullRequestContextInput {
  number?: number;
  title?: string;
  body?: string;
  url?: string;
  commits?: Array<{ sha?: string; message?: string }>;
  issues?: Array<{ number?: number; title?: string; url?: string }>;
}

const DEFAULT_MAX_BYTES = 4_096;
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const SECRET_VALUE_RE =
  /\b(api[_-]?key|token|secret|password|authorization|bearer)\b\s*[:=]\s*([^\s"'`]{8,}|["'`][^"'`]{8,}["'`])/gi;
const LONG_TOKEN_RE = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g;

export function redactPrContext(value: string): string {
  return value
    .replace(ANSI_RE, "")
    .replace(CONTROL_RE, "")
    .replace(SECRET_VALUE_RE, (_match, key) => `${key}: [REDACTED]`)
    .replace(LONG_TOKEN_RE, "[REDACTED]");
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) return value;
  const buffer = Buffer.from(value, "utf8").subarray(0, Math.max(0, maxBytes - 32));
  return `${buffer.toString("utf8").replace(/\uFFFD$/u, "")}\n[truncated to ${maxBytes} bytes]`;
}

export function buildPullRequestContext(input: PullRequestContextInput, maxBytes = DEFAULT_MAX_BYTES): string {
  const lines: string[] = [];
  if (input.number !== undefined || input.title) {
    lines.push(`PR: ${input.number !== undefined ? `#${input.number}` : ""}${input.title ? ` ${input.title}` : ""}`.trim());
  }
  if (input.url) lines.push(`URL: ${input.url}`);
  if (input.body && input.body.trim()) {
    lines.push("", "Body:", input.body.trim());
  }
  if (input.issues && input.issues.length > 0) {
    lines.push("", "Linked issues:");
    for (const issue of input.issues.slice(0, 10)) {
      const label = issue.number !== undefined ? `#${issue.number}` : "-";
      lines.push(`- ${label}${issue.title ? ` ${issue.title}` : ""}${issue.url ? ` (${issue.url})` : ""}`);
    }
  }
  if (input.commits && input.commits.length > 0) {
    lines.push("", "Commits:");
    for (const commit of input.commits.slice(0, 20)) {
      const sha = commit.sha ? commit.sha.slice(0, 12) : "";
      const message = commit.message?.split(/\r?\n/, 1)[0] ?? "";
      lines.push(`- ${sha}${message ? ` ${message}` : ""}`.trim());
    }
  }

  return truncateUtf8(redactPrContext(lines.join("\n").trim()), maxBytes);
}
