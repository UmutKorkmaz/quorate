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

function removedLines(diff: string): DiffLine[] {
  const result: DiffLine[] = [];
  let currentFile: string | undefined;
  let newSideLine: number | undefined;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      currentFile = undefined;
      newSideLine = undefined;
    } else if (line.startsWith("--- a/")) {
      currentFile = line.slice("--- a/".length);
    } else if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
    } else if (line.startsWith("@@")) {
      const match = /\+(\d+)/.exec(line);
      newSideLine = match ? Number(match[1]) : undefined;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      result.push({ file: currentFile, line: newSideLine, text: line.slice(1) });
    } else if (!line.startsWith("+") && newSideLine !== undefined) {
      newSideLine += 1;
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

    if (
      line.file?.endsWith(".rs") &&
      /\.unwrap\(\)|\.expect\(|panic!\(|unreachable!\(/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Panic in on-chain code",
        body:
          "on-chain programs should return Err, not panic — a panic aborts the transaction and can be a DoS/footgun; " +
          "use ? / require! / proper error returns."
      });
    }

    if (
      line.file?.endsWith(".rs") &&
      /create_program_address\s*\(/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Non-canonical PDA bump",
        body:
          "create_program_address accepts any bump; canonicalize with find_program_address or validate against a stored " +
          "canonical bump (bump-seed canonicalization)."
      });
    }

    if (
      line.file?.endsWith(".rs") &&
      /lamports\s*\.\s*borrow_mut\(\)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Manual account closing",
        body:
          "draining lamports by hand can leave a revivable/zombie account; use Anchor's close = <recipient> or zero " +
          "the discriminator + defund atomically (closing-accounts attack)."
      });
    }

    if (
      line.file?.endsWith(".rs") &&
      /(Account|Mint)::unpack\s*\(|spl_token::state::/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Unvalidated token account",
        body:
          "unpacking SPL token Account/Mint data without checking owner == token program and the expected mint enables " +
          "account-substitution; validate owner and mint (and decimals) before trusting amounts."
      });
    }

    if (
      line.file?.endsWith(".rs") &&
      /(amount|balance|lamports|supply)\b[^;=]*[-+*]=(?!=)/.test(text) &&
      !text.includes("checked_")
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Unchecked arithmetic on funds",
        body:
          "balance/amount math without checked_add/checked_sub can overflow/underflow; " +
          "use checked_* and handle None."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(line.file ?? "") &&
      /fromSecretKey\s*\(|secretKey\s*[:=]\s*(\[|Uint8Array|new Uint8Array|bs58)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Hardcoded keypair material",
        body:
          "a secret key embedded in source is committed forever; load from env/secret manager, never inline."
      });
    }
  }

  for (const line of removedLines(request.diff ?? "")) {
    const text = line.text;
    const base = { file: line.file, line: line.line, providerId: "heuristic", role };

    if (
      line.file?.endsWith(".rs") &&
      /#\[account|has_one\s*=|constraint\s*=|address\s*=|seeds\s*=/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Anchor account constraint removed",
        body:
          "a removed #[account(...)] constraint (has_one/constraint/address/seeds/signer) drops an authorization or " +
          "validation check — confirm this is intentional."
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
