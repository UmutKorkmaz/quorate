import type { CouncilRequest, Finding, ProviderResult } from "./types.js";

interface DiffLine {
  file?: string;
  line?: number;
  text: string;
}

function addedLines(diff: string): DiffLine[] {
  const result: DiffLine[] = [];
  let currentFile: string | undefined;
  let currentLine: number | undefined;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      currentFile = undefined;
      currentLine = undefined;
    } else if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
    } else if (line.startsWith("@@")) {
      const match = /\+(\d+)/.exec(line);
      currentLine = match ? Number(match[1]) : undefined;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      result.push({ file: currentFile, line: currentLine, text: line.slice(1) });
      if (currentLine !== undefined) currentLine += 1;
    } else if (!line.startsWith("-") && currentLine !== undefined) {
      currentLine += 1;
    }
  }

  return result;
}

export function runHeuristicReview(request: CouncilRequest, role = "maintainer"): ProviderResult {
  const startedAt = Date.now();
  const findings: Finding[] = [];
  const lines = addedLines(request.diff ?? "");

  for (const line of lines) {
    const text = line.text;
    const base = { file: line.file, line: line.line, providerId: "heuristic", role };

    if (/\b(describe|it|test)\.only\s*\(/.test(text)) {
      findings.push({
        ...base,
        severity: "high",
        title: "Focused test committed",
        body: "Focused test calls can silently skip most of the suite in CI."
      });
    }

    if (/\b(api[_-]?key|secret|password|token)\b\s*[:=]\s*['"][^'"]{8,}/i.test(text)) {
      findings.push({
        ...base,
        severity: "high",
        title: "Possible secret in added code",
        body: "Added code appears to contain a hard-coded credential-like value."
      });
    }

    if (/\bconsole\.log\s*\(/.test(text)) {
      findings.push({
        ...base,
        severity: "low",
        title: "Console logging added",
        body: "Confirm the log is intentional and safe for production output."
      });
    }

    if (/\b(TODO|FIXME)\b/i.test(text)) {
      findings.push({
        ...base,
        severity: "info",
        title: "Follow-up marker added",
        body: "Track this marker if it represents unfinished behavior."
      });
    }

    if (
      line.file?.endsWith(".rs") &&
      /\bUncheckedAccount\s*<|AccountInfo\s*</.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Unchecked account type",
        body:
          "UncheckedAccount / AccountInfo bypasses Anchor's automatic owner and discriminator checks. " +
          "Document manual validation in a comment and verify signer, owner, and key constraints explicitly."
      });
    }

    if (
      line.file?.endsWith(".rs") &&
      /\binvoke(_signed)?\s*\(/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Raw CPI invocation",
        body:
          "Raw invoke / invoke_signed bypasses Anchor's typed CPI safety checks. " +
          "Verify the target program id and all account constraints before calling."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(line.file ?? "") &&
      /skipPreflight\s*:\s*true/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Preflight checks disabled",
        body:
          "skipPreflight: true skips transaction simulation, so failing transactions still pay fees and errors are masked. " +
          "Remove this flag or restrict it to explicit debug builds."
      });
    }
  }

  if (!request.diff && request.mode === "review") {
    findings.push({
      severity: "info",
      title: "No diff supplied",
      body: "The heuristic reviewer needs a diff to inspect changed lines.",
      providerId: "heuristic",
      role
    });
  }

  return {
    providerId: "heuristic",
    role,
    providerType: "mock",
    status: "ok",
    summary:
      findings.length > 0
        ? `Heuristic review found ${findings.length} issue${findings.length === 1 ? "" : "s"}.`
        : "Heuristic review found no obvious issues.",
    findings,
    durationMs: Date.now() - startedAt
  };
}
