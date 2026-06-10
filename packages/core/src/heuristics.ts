import type { CouncilRequest, Finding, ProviderResult } from "./types.js";

export interface DiffLine {
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

/** Inline suppression marker: `quorate-ignore`, `quorate-ignore-line`,
 *  `quorate-disable-line`, optionally followed by keyword(s) to scope it. */
const SUPPRESS_RE = /quorate-(?:ignore|disable)(?:-(?:next-)?line)?(?:\s+([\w ,-]+))?/i;

/**
 * Drops findings on a line that carries an inline `quorate-ignore` marker —
 * either trailing on the same added line or on the added line directly above.
 * A bare marker mutes every finding on the line; `quorate-ignore <keyword>`
 * mutes only findings whose title contains one of the listed keywords. This is
 * the false-positive escape hatch every heuristic tool needs.
 */
export function applyInlineSuppressions(findings: Finding[], lines: DiffLine[]): Finding[] {
  const textByLoc = new Map<string, string>();
  for (const candidate of lines) {
    if (candidate.file && candidate.line !== undefined) {
      textByLoc.set(`${candidate.file}:${candidate.line}`, candidate.text);
    }
  }
  const scopeMatches = (marker: RegExpExecArray, title: string): boolean => {
    const scope = marker[1]?.trim().toLowerCase();
    if (!scope) return true;
    const keywords = scope.split(/[\s,]+/).filter(Boolean);
    const lowerTitle = title.toLowerCase();
    return keywords.some((keyword) => lowerTitle.includes(keyword));
  };
  return findings.filter((finding) => {
    if (!finding.file || finding.line === undefined) return true;
    const sources = [
      textByLoc.get(`${finding.file}:${finding.line}`) ?? "",
      textByLoc.get(`${finding.file}:${finding.line - 1}`) ?? ""
    ];
    for (const source of sources) {
      const marker = SUPPRESS_RE.exec(source);
      if (marker && scopeMatches(marker, finding.title)) return false;
    }
    return true;
  });
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

    // ── EVM / Solidity checks (added-lines, .sol files only) ──────────────

    if (line.file?.endsWith(".sol") && /\btx\.origin\b/.test(text)) {
      findings.push({
        ...base,
        severity: "high",
        title: "tx.origin used for authorization",
        body:
          "tx.origin is the original transaction sender and is phishable — a malicious contract can relay a call on " +
          "behalf of the victim. Use msg.sender for authorization instead."
      });
    }

    if (line.file?.endsWith(".sol") && /\.delegatecall\s*\(/.test(text)) {
      findings.push({
        ...base,
        severity: "high",
        title: "delegatecall to untrusted target",
        body:
          "delegatecall executes external code in this contract's storage context. If the target address is " +
          "attacker-controlled it can overwrite arbitrary storage slots or drain funds."
      });
    }

    if (
      line.file?.endsWith(".sol") &&
      /\bselfdestruct\s*\(|\bsuicide\s*\(/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "selfdestruct present",
        body:
          "selfdestruct can permanently destroy the contract and force-send ether to any address, bypassing receive " +
          "hooks. Its use is deprecated in EIP-6049; consider whether this path can be triggered by an attacker."
      });
    }

    if (line.file?.endsWith(".sol") && /\bassembly\s*\{/.test(text)) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Inline assembly",
        body:
          "Inline assembly bypasses Solidity type safety and memory/storage protections. Audit every slot access, " +
          "pointer arithmetic, and control-flow path carefully."
      });
    }

    if (
      line.file?.endsWith(".sol") &&
      /block\.(timestamp|number)\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "block.timestamp/number dependence",
        body:
          "block.timestamp can be manipulated by miners within a ~15-second window, and block.number is predictable. " +
          "Avoid using either as a source of randomness or for tight deadlines."
      });
    }

    if (
      line.file?.endsWith(".sol") &&
      /for\s*\([^;]*;[^;]*\.length\s*;/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Unbounded loop over dynamic array",
        body:
          "Iterating over an unbounded dynamic array consumes O(n) gas and can exceed the block gas limit as the " +
          "array grows, causing a permanent DoS. Cap the iteration or use pagination."
      });
    }

    if (line.file?.endsWith(".sol") && /pragma\s+solidity\s+\^/.test(text)) {
      findings.push({
        ...base,
        severity: "low",
        title: "Floating pragma",
        body:
          "A caret pragma (^0.x.y) allows compilation with any compatible minor release, producing non-reproducible " +
          "bytecode. Pin the compiler version (e.g. pragma solidity 0.8.24;) for deterministic builds."
      });
    }

    if (
      line.file?.endsWith(".sol") &&
      /\.call\s*\{\s*value\s*:/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Ether send via low-level call",
        body:
          "Sending ether with a low-level .call{value:...}() is a reentrancy surface. Follow " +
          "checks-effects-interactions ordering and guard the function with nonReentrant where appropriate."
      });
    }

    if (
      line.file?.endsWith(".sol") &&
      /\.call\s*\(/.test(text) &&
      !/=\s*[^;]*\.call\s*\(/.test(text) &&
      !text.includes("(bool")
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Unchecked low-level call return",
        body:
          "A low-level .call() that is not assigned to a (bool, ...) tuple silently ignores failure — the callee " +
          "may revert while the caller continues execution. Always check the success return value."
      });
    }

    if (
      line.file?.endsWith(".sol") &&
      /\b(?!payable\s*\()[a-zA-Z_]\w*\.(transfer|transferFrom)\s*\(/.test(text) &&
      !text.includes("require(") &&
      !text.includes("bool")
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Unchecked ERC20 transfer return",
        body:
          "Non-standard ERC20 tokens return false instead of reverting on failure. Wrap calls in " +
          "SafeERC20.safeTransfer / safeTransferFrom, or explicitly check the boolean return value."
      });
    }

    // ── IaC checks — Terraform (.tf) ─────────────────────────────────────────

    if (
      line.file?.endsWith(".tf") &&
      /\bacl\s*=\s*"public-read(-write)?"/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Public storage ACL",
        body:
          "Setting acl to public-read or public-read-write makes the storage bucket accessible to anyone on the internet. " +
          "Use private ACL and grant access through IAM policies instead."
      });
    }

    if (
      line.file?.endsWith(".tf") &&
      /cidr_blocks\s*=\s*\[?\s*"0\.0\.0\.0\/0"/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Unrestricted ingress (0.0.0.0/0)",
        body:
          "A CIDR block of 0.0.0.0/0 allows traffic from any IP address. Restrict ingress to known IP ranges " +
          "or use a VPN/bastion host for administrative access."
      });
    }

    if (
      line.file?.endsWith(".tf") &&
      /(encrypted\s*=\s*false|encryption\s*=\s*"?(none|disabled)"?)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Encryption disabled",
        body:
          "Disabling encryption for storage or databases leaves data at rest vulnerable. " +
          "Enable encryption with a customer-managed key (CMK) or the provider's default KMS key."
      });
    }

    if (
      line.file?.endsWith(".tf") &&
      /associate_public_ip_address\s*=\s*true/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Public IP assignment",
        body:
          "Assigning a public IP to an instance exposes it directly to the internet. " +
          "Place instances in a private subnet and use a load balancer or NAT gateway for egress."
      });
    }

    if (
      line.file?.endsWith(".tf") &&
      /\b(password|secret_key|access_key|private_key|client_secret)\s*=\s*"[^"]+"/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Hardcoded secret in IaC",
        body:
          "A secret value is hardcoded directly in the Terraform configuration. " +
          "Use input variables with sensitive = true, environment variables, or a secrets manager reference instead."
      });
    }

    // ── IaC checks — Kubernetes (.yaml / .yml) ───────────────────────────────

    if (
      (line.file?.endsWith(".yaml") || line.file?.endsWith(".yml")) &&
      /\bprivileged\s*:\s*true/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Privileged container",
        body:
          "A privileged container has almost all the capabilities of the host and can escape to the node. " +
          "Remove privileged: true and grant only the specific capabilities the container needs."
      });
    }

    if (
      (line.file?.endsWith(".yaml") || line.file?.endsWith(".yml")) &&
      /\b(hostNetwork|hostPID|hostIPC)\s*:\s*true/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Host namespace sharing",
        body:
          "Sharing the host's network, PID, or IPC namespace breaks container isolation and can allow " +
          "a compromised container to observe or interfere with host processes. Remove the host namespace flag."
      });
    }

    if (
      (line.file?.endsWith(".yaml") || line.file?.endsWith(".yml")) &&
      /\brunAsUser\s*:\s*0\b|\brunAsNonRoot\s*:\s*false/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Container runs as root",
        body:
          "Running a container as UID 0 (root) increases the blast radius of a container breakout. " +
          "Set runAsNonRoot: true and specify a non-zero runAsUser in the security context."
      });
    }

    if (
      (line.file?.endsWith(".yaml") || line.file?.endsWith(".yml")) &&
      /\ballowPrivilegeEscalation\s*:\s*true/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Privilege escalation allowed",
        body:
          "allowPrivilegeEscalation: true permits a process to gain more privileges than its parent. " +
          "Set allowPrivilegeEscalation: false in the container security context to prevent escalation attacks."
      });
    }

    if (
      (line.file?.endsWith(".yaml") || line.file?.endsWith(".yml")) &&
      /\bimage\s*:\s*\S+:latest\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "low",
        title: "Mutable image tag (:latest)",
        body:
          "Using the :latest tag means the image pulled at deploy time may differ from the one tested. " +
          "Pin images to a specific digest or immutable version tag for reproducible deployments."
      });
    }

    // ── LLM / AI-app checks — JS/TS files only ───────────────────────────────

    if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(line.file ?? "") &&
      // Match variables unambiguously named for LLM prompts. 'content' is intentionally
      // excluded because it is also used for React children, HTTP headers, and HTML
      // attributes — its presence alone does not indicate an AI prompt context.
      /(prompt|systemPrompt|userPrompt)\s*[:=][^;\n]*\$\{/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Untrusted input interpolated into prompt",
        body:
          "Template-literal interpolation inside a prompt or content field may allow attacker-controlled text to " +
          "override system instructions. Validate, escape, or wrap user-supplied values before inserting them into any prompt."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(line.file ?? "") &&
      // Require an unambiguously LLM-ish identifier in the argument list.
      // Generic names like 'output', 'response', or 'result' are intentionally
      // excluded: they appear in thousands of non-LLM code paths (file I/O, HTTP,
      // build tools) and would produce high false-positive rates. Those cases are
      // caught by the web command-injection check (which requires req./user_input).
      /\b(eval|new Function|execSync|exec|spawn)\s*\([^)]*(completion|chatCompletion|llmResult|aiResult|message\.content|\.choices\b)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "critical",
        title: "Model output passed to code execution",
        body:
          "Passing LLM-generated text directly to eval, new Function, exec, execSync, or spawn is a remote-code-execution " +
          "risk — prompt injection can cause the model to emit malicious payloads. Parse and validate model output with a " +
          "strict schema before using it in any execution context."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(line.file ?? "") &&
      /dangerouslySetInnerHTML\s*[:=]\s*\{+\s*__html\s*:[^}]*(completion|response|output|message|content|aiResult)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Model output rendered as unsanitized HTML",
        body:
          "Rendering model output via dangerouslySetInnerHTML without prior sanitisation enables XSS — prompt injection " +
          "can cause the model to emit HTML/script payloads. Run the output through a vetted sanitiser (e.g. DOMPurify) first."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(line.file ?? "") &&
      /JSON\.parse\s*\([^)]*(tool_calls?|function_call|\.arguments)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Unvalidated tool-call arguments",
        body:
          "JSON.parse on tool-call or function-call arguments without schema validation means the model can supply " +
          "unexpected field types or values. Validate the parsed object against a strict schema (e.g. Zod) before use."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(line.file ?? "") &&
      /(apiKey|api_key)\s*[:=]\s*["'](sk-|sk-ant-|AIza)[^"']+["']/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Hardcoded LLM API key",
        body:
          "An LLM provider API key is hardcoded in source. Keys committed to version control are easily exfiltrated and " +
          "incur unbounded charges. Load the key from an environment variable or secret manager at runtime."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(line.file ?? "") &&
      /console\.(log|info|debug)\s*\([^)]*(prompt|messages|completion|response\.choices|message\.content)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "low",
        title: "LLM prompt/response logged",
        body:
          "Logging full prompts or completions can leak PII, secrets embedded in context, or proprietary content to " +
          "log-aggregation systems. Redact sensitive fields or use structured logging with explicit allow-lists."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(line.file ?? "") &&
      /(safe_?mode|moderation|safetySettings|content_filter)\s*[:=]\s*(false|["']none["']|["']?BLOCK_NONE["']?|off)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Model safety/moderation disabled",
        body:
          "Disabling safety filters or moderation removes the model's built-in guardrails against harmful output. " +
          "Keep safety settings enabled in production; document and gate any deliberate overrides."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(line.file ?? "") &&
      /(prompt|content|messages)\s*[:=][^;\n]*(process\.env|apiKey|password|\bsecret\b|\bssn\b|creditCard)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Secret or PII included in prompt",
        body:
          "Including secrets, API keys, or personal data in a prompt sends them to a third-party model provider and " +
          "may log them in the provider's infrastructure. Redact or omit sensitive values before constructing the prompt."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(line.file ?? "") &&
      /if\s*\([^)]*(completion|response|aiResult|llmResult|model)\b[^)]*(===|==|\.includes\()\s*["'](yes|allow|admin|true|grant)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Authorization decision based on model output",
        body:
          "Granting access or permissions based on a string comparison with model output is unsafe — prompt injection can " +
          "cause the model to reply with the expected token. Perform authorization checks in trusted code, not by parsing model responses."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(line.file ?? "") &&
      /(prompt|content|messages)\s*[:=][^;\n]*(fetch\(|axios|\.get\(|scrape|\.innerHTML|document\.)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Untrusted external content fed into prompt",
        body:
          "Inserting content fetched from external URLs, web-scraped HTML, or untrusted DOM nodes directly into a prompt " +
          "is a prompt-injection vector — the remote content can contain hidden instructions. Sanitise or summarise " +
          "external content before including it in a model context."
      });
    }

    // ── Move (Sui / Aptos) checks — .move files only ─────────────────────────

    if (
      line.file?.endsWith(".move") &&
      /\bpublic\s+entry\s+fun\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Public entry function",
        body:
          "public entry functions are externally callable by any account. Verify the caller is authorized — " +
          "assert signer::address_of(account) == expected_admin or require a capability argument."
      });
    }

    if (
      line.file?.endsWith(".move") &&
      /\bborrow_global_mut\s*</.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Global storage mutated without owner check",
        body:
          "borrow_global_mut grants write access to a resource stored at an address. " +
          "Confirm the target address equals signer::address_of(account) before calling to prevent unauthorized mutation."
      });
    }

    if (
      line.file?.endsWith(".move") &&
      /\bmove_from\s*</.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Resource removed from storage",
        body:
          "move_from removes a resource from global storage. " +
          "Verify ownership — confirm the target address equals signer::address_of(account) before extracting."
      });
    }

    if (
      line.file?.endsWith(".move") &&
      /transfer::(public_)?share_object\s*\(/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Object shared publicly",
        body:
          "transfer::share_object / transfer::public_share_object makes a Sui object shared: any transaction " +
          "can pass it as &mut. Gate every mutation path on an explicit authorization check or capability."
      });
    }

    if (
      line.file?.endsWith(".move") &&
      /\bstruct\s+\w+\s+has\b[^\{]*\bcopy\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Struct has copy ability",
        body:
          "A struct with the copy ability can be duplicated freely. Value or authority resources (tokens, capabilities) " +
          "must not be copyable — remove copy from the ability list."
      });
    }

    if (
      line.file?.endsWith(".move") &&
      /\bas\s+u(8|16|32)\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "low",
        title: "Integer downcast (truncation)",
        body:
          "Casting to a narrower integer type (u8, u16, u32) silently truncates the high bits in Move. " +
          "Validate that the value fits in the target range before casting."
      });
    }

    if (
      line.file?.endsWith(".move") &&
      /\bpublic\s+fun\s+\w*(withdraw|mint|burn|transfer|admin)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Unguarded privileged function",
        body:
          "A public function named withdraw/mint/burn/transfer/admin is callable by any module. " +
          "Gate it with a capability parameter (e.g. AdminCap) or an explicit signer authorization assert."
      });
    }

    if (
      line.file?.endsWith(".move") &&
      /\bvector::borrow\s*\(/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "low",
        title: "Unchecked vector index",
        body:
          "vector::borrow aborts at runtime if the index is out of bounds. " +
          "Validate vector::length before borrowing to prevent transaction abort."
      });
    }

    if (
      line.file?.endsWith(".move") &&
      /\bstruct\s+\w+\s+has\b[^\{]*\bdrop\b[^\{]*\bkey\b|\bhas\b[^\{]*\bkey\b[^\{]*\bdrop\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Key resource has drop ability",
        body:
          "A struct with both key and drop abilities can be silently discarded, permanently losing any asset " +
          "or authority it represents. Remove drop from key resources to force explicit handling."
      });
    }

    if (
      line.file?.endsWith(".move") &&
      /\bfun\s+init\s*\(/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "low",
        title: "Initializer/admin entrypoint",
        body:
          "Module initializer or admin entrypoint detected. Ensure one-time initialization is enforced " +
          "and that AdminCap issuance is restricted to the deployer's signer context."
      });
    }

    // ── CI / supply-chain checks ──────────────────────────────────────────────

    if (
      line.file?.includes(".github/workflows/") &&
      /pull_request_target/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "pull_request_target trigger",
        body:
          "pull_request_target runs in the context of the base repo with access to secrets, even when triggered by a " +
          "fork PR. Checking out or executing the PR head here creates an RCE/secret-exfiltration risk. " +
          "Avoid checking out PR head code or executing PR-supplied scripts in pull_request_target workflows."
      });
    }

    if (
      line.file?.includes(".github/workflows/") &&
      /\$\{\{\s*github\.event\.(issue|pull_request|comment|review|head_commit|commits)[.\w]*\.(title|body|message|ref|name|email|label)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Untrusted input in workflow expression",
        body:
          "Interpolating github.event.* fields (title, body, message, ref, label, email) directly into a run: step " +
          "via ${{ }} is a script-injection sink — an attacker can embed shell metacharacters in a PR title or " +
          "issue body. Pass the value via an intermediate env: variable instead."
      });
    }

    if (
      line.file?.includes(".github/workflows/") &&
      /uses:\s*[\w.\-]+\/[\w.\-]+@(v?\d+(\.\d+)*|main|master|latest)\s*$/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Action not pinned to a commit SHA",
        body:
          "Action references using tags (v1, v2.3) or branch names (main, master, latest) are mutable — the " +
          "upstream repository can push a different commit to that ref at any time. Pin every action to a full " +
          "40-character commit SHA for reproducible, tamper-resistant builds."
      });
    }

    if (
      line.file?.includes(".github/workflows/") &&
      /permissions:\s*write-all|^\s*(contents|packages|id-token|actions|deployments):\s*write\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Over-broad workflow permissions",
        body:
          "Granting write-all or broad per-scope write permissions violates least-privilege. " +
          "Declare only the specific permissions each job requires; default all others to read or none."
      });
    }

    if (
      line.file?.includes(".github/workflows/") &&
      /runs-on:\s*\[?\s*["']?self-hosted/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Self-hosted runner",
        body:
          "Self-hosted runners persist between runs and can retain secrets, build artifacts, or malicious code " +
          "injected by a previous job. Untrusted PRs executing on a self-hosted runner can compromise the host. " +
          "Isolate self-hosted runners, restrict them to trusted branches, or use ephemeral runners."
      });
    }

    if (
      line.file?.includes(".github/workflows/") &&
      /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(sha|ref)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Checks out untrusted PR head",
        body:
          "Checking out github.event.pull_request.head.sha or .ref in a pull_request_target workflow executes " +
          "attacker-controlled code with repository secrets in scope — this is effectively RCE. " +
          "Only check out the base ref in pull_request_target, or move the privileged step to a separate workflow."
      });
    }

    if (
      line.file?.endsWith("package.json") &&
      /"(pre|post)?install"\s*:/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Install script added",
        body:
          "preinstall, install, and postinstall lifecycle scripts run arbitrary commands on every npm install — " +
          "they are a primary supply-chain attack surface. Audit the script carefully; consider using " +
          "--ignore-scripts in CI and documenting why the script is necessary."
      });
    }

    if (
      /_authToken\s*=|npm_[A-Za-z0-9]{30,}|NODE_AUTH_TOKEN\s*:\s*["']?[A-Za-z0-9]{10,}/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Hardcoded registry/auth token",
        body:
          "A registry authentication token is hardcoded in source. Tokens committed to version control can be " +
          "exfiltrated from the repository history. Store tokens in CI secrets and reference them via " +
          "environment variables (e.g. NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }})."
      });
    }

    if (
      /(curl|wget)\s+[^|\n]*\|\s*(sudo\s+)?(ba)?sh\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Pipe-to-shell of a remote script",
        body:
          "Fetching a script with curl or wget and immediately piping it to sh/bash provides no integrity " +
          "guarantee — a compromised CDN or MITM can serve malicious code. Download the script first, " +
          "verify its checksum or signature, then execute it."
      });
    }

    if (
      (line.file?.endsWith("Dockerfile") || line.file?.includes("Dockerfile")) &&
      /^\s*FROM\s+\S+:latest\b|^\s*ADD\s+https?:\/\//.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Unpinned base image or remote ADD",
        body:
          "Using :latest as a base image tag means each build may pull a different image layer, breaking " +
          "reproducibility and potentially introducing regressions or malicious updates. " +
          "Pin FROM by digest (e.g. FROM ubuntu@sha256:<hash>). " +
          "Additionally, ADD <url> fetches remote content without integrity verification — use COPY with " +
          "a pre-downloaded and checksummed file instead."
      });
    }

    // ── Fintech / PCI-DSS checks — backend source files only ─────────────────

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      // First alternative: any monetary-prefixed name assigned from parseFloat() — always a float.
      // Second alternative: type annotation with a float type, but EXCLUDING names that already
      // carry an explicit integer-minor-unit suffix (Cents, Pence, Satoshi, Wei, etc.) — those
      // names self-document that the value is an integer and would generate false positives for
      // well-written payment code that uses the unit in the variable name as a convention.
      /\b(amount|price|balance|total|cost|fee|payment)\w*\s*[:=]\s*parseFloat\(|\b(amount|price|balance|total)(?!Cents|Pence|Satoshi|Wei|Minor|Units?|Int\b|Integer\b)\w*\s*:\s*(number|float|Float|double|Double)\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Monetary value stored as float",
        body:
          "Floating-point types cannot represent all decimal currency values exactly and lose cents over repeated arithmetic. " +
          "Store monetary amounts as integer minor units (cents, pence) or use a decimal library — never float/double/parseFloat."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /(console\.(log|info|debug|warn)|print|println|logger\.\w+)\s*\([^)]*\b(card(_?number)?|pan|cvv|cvc|cvv2|securityCode|cardNumber)\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Card data in logs",
        body:
          "PCI-DSS prohibits logging PAN (card numbers) and CVV/CVC values under any circumstances. " +
          "Remove card data from all log statements; mask PAN to last-4 digits before any output."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /\b4[0-9]{12}(?:[0-9]{3})?\b|\b5[1-5][0-9]{14}\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Card number literal in source",
        body:
          "A payment card number (PAN) is hardcoded in source code. " +
          "PANs must never appear in version-controlled files — use tokenized test card numbers from your payment provider's documentation."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /\b(cvv|cvc|cvv2|securityCode|card_?security)\b\s*[:=]/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "CVV stored/persisted",
        body:
          "PCI-DSS requirement 3.2 forbids storing CVV/CVC security codes after authorization. " +
          "Remove any persistence of CVV fields — do not insert them into databases, caches, or logs."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /(verif\w*Signature|signatureVerification|checkSignature)\s*[:=]\s*(false|False)|verify_?signature\s*=\s*False|skipSignature/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Webhook signature verification disabled",
        body:
          "Disabling webhook signature verification allows any caller to spoof payment events. " +
          "Always verify provider signatures (e.g. Stripe webhook.constructEvent) before processing events."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /\b(amount|price|total|balance|subtotal)\w*\s*[-+*\/]\s*[\d]*\.[\d]/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Floating-point arithmetic on money",
        body:
          "Applying floating-point arithmetic operators to monetary values causes rounding drift — repeated operations " +
          "accumulate errors that result in incorrect totals. Use integer cents arithmetic or a decimal precision library."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /\b(ssn|socialSecurity|social_security|taxId|tax_id|routingNumber|routing_number|accountNumber|account_number|iban)\b\s*[:=]\s*["'][^"']/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Financial PII in plaintext",
        body:
          "Financial personally-identifiable information (SSN, account numbers, routing numbers, IBAN) is assigned a plaintext literal. " +
          "Encrypt sensitive financial PII at rest using a field-level encryption scheme; never hardcode real values in source."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(0|false)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "TLS certificate verification disabled",
        body:
          "Disabling TLS certificate verification exposes payment API connections to man-in-the-middle attacks. " +
          "Always verify server certificates (rejectUnauthorized: true) when communicating with payment gateways and financial APIs."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /\b(amount|price|total|balance)\w*[^;\n]*\.toFixed\s*\(\s*2\s*\)|Math\.round\s*\([^)]*\b(amount|price|total)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "low",
        title: "Float rounding used for currency",
        body:
          "Using .toFixed(2) or Math.round on currency values is a symptom of float-based money handling and introduces " +
          "rounding inconsistencies. Represent monetary values as integer minor units (cents) to avoid rounding altogether."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /(query|sql|execute)\s*[(=][^;\n]*\b(amount|account|card|user|payment|balance)[^;\n]*\+/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "SQL built by string concatenation",
        body:
          "Building SQL queries by string concatenation with financial data is vulnerable to SQL injection attacks. " +
          "Use parameterized queries or a query builder for all database operations involving payment or account data."
      });
    }

    // ── Web / API (OWASP) checks — backend/web source files only ─────────────

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|go|rb|php)$/.test(line.file ?? "") &&
      /(fetch|axios|request|requests\.(get|post)|http\.get|urllib)\s*\([^)]*(req\.(query|params|body)|request\.(GET|args|json)|userInput|user_input)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "SSRF — user input in a server-side request",
        body:
          "A server-side HTTP request is constructed from untrusted user input. An attacker can supply an internal " +
          "URL (e.g. http://169.254.169.254/) to pivot to internal services or cloud metadata. " +
          "Allow-list permitted hosts/schemes and block private IP ranges before making any server-side request."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|go|rb|php)$/.test(line.file ?? "") &&
      /(exec|execSync|spawn|spawnSync|os\.system|subprocess\.(call|run|Popen)|Runtime\.getRuntime)\s*\([^)]*(req\.|request\.|params|argv|user_?input)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "critical",
        title: "Command injection (untrusted input in a shell command)",
        body:
          "User-controlled input is passed directly to a shell execution function. An attacker can escape the intended " +
          "command and execute arbitrary OS commands. Avoid passing user input to shell functions; use parameterized " +
          "APIs, allow-list arguments, or run in a sandboxed environment."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|go|rb|php)$/.test(line.file ?? "") &&
      /(readFile|readFileSync|createReadStream|sendFile|fs\.\w+|open|path\.join)\s*\([^)]*(req\.(query|params|body)|request\.|user_?input)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Path traversal (untrusted input in a file path)",
        body:
          "A file-system operation uses a path derived from untrusted user input. An attacker can supply '../' sequences " +
          "to escape the intended directory and read or write arbitrary files. Validate and normalize paths, resolve " +
          "them against a fixed base directory, and reject any path that escapes the allowed root."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|go|rb|php)$/.test(line.file ?? "") &&
      /(res\.send|res\.write|res\.end|innerHTML\s*=|document\.write)\s*\([^)]*(req\.(query|params|body)|request\.)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Reflected XSS (unescaped input echoed to the response)",
        body:
          "Untrusted request data is echoed directly into an HTTP response or the DOM without HTML encoding. " +
          "An attacker can inject script payloads that execute in the victim's browser. HTML-encode all user-controlled " +
          "values before inserting them into responses; use a templating engine with auto-escaping."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|go|rb|php)$/.test(line.file ?? "") &&
      /(res\.redirect|sendRedirect|redirect)\s*\([^)]*(req\.(query|params|body)|request\.)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Open redirect (user-controlled redirect target)",
        body:
          "A redirect target is constructed from untrusted user input. An attacker can craft a link that redirects " +
          "victims to a malicious site, enabling phishing attacks. Validate redirect URLs against a strict allow-list " +
          "of permitted destinations and reject or strip unexpected origins."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|go|rb|php)$/.test(line.file ?? "") &&
      /(new\s+\w+\s*\(\s*req\.body\s*\)|\.(create|update|insert|save)\s*\(\s*req\.body\b|Object\.assign\s*\([^,]+,\s*req\.body)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Mass assignment (request body bound directly to a model)",
        body:
          "The entire request body is passed directly to a model constructor, create, update, or Object.assign call. " +
          "An attacker can supply unexpected fields (e.g. isAdmin, role, balance) that overwrite protected properties. " +
          "Use an explicit allow-list of permitted fields (e.g. pick/omit) before binding request data to a model."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|go|rb|php)$/.test(line.file ?? "") &&
      /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*["']|origin\s*:\s*["']\*["']|origin\s*:\s*true\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Permissive CORS (wildcard / reflected origin)",
        body:
          "A CORS configuration uses a wildcard origin (*) or reflects the request origin without validation. " +
          "This allows any website to make credentialed cross-origin requests to your API. " +
          "Replace the wildcard with an explicit allow-list of trusted origins."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|go|rb|php)$/.test(line.file ?? "") &&
      /(csrf|csrfProtection|csrf_protect)\s*[:=]\s*(false|False)|@csrf_exempt|csrf\s*:\s*\{?\s*false/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "CSRF protection disabled",
        body:
          "CSRF protection is explicitly disabled on a route or controller. Without CSRF tokens, " +
          "an attacker can trick authenticated users into submitting forged state-changing requests. " +
          "Enable CSRF protection on all state-changing endpoints; only exempt stateless API routes authenticated by tokens."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|go|rb|php)$/.test(line.file ?? "") &&
      /(pickle\.loads|yaml\.load\s*\((?![^)]*Loader)|unserialize|marshal\.loads|JSON\.parse\s*\([^)]*(req\.|request\.))/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Insecure deserialization of untrusted data",
        body:
          "Untrusted data is passed to a deserialization function that can instantiate arbitrary objects. " +
          "pickle.loads, yaml.load (without SafeLoader), PHP unserialize, and marshal.loads can execute arbitrary code " +
          "when given a crafted payload. Use safe alternatives (yaml.safe_load, JSON with schema validation) " +
          "and never deserialize data from untrusted sources with unsafe deserializers."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|go|rb|php)$/.test(line.file ?? "") &&
      /createHash\s*\(\s*["'](md5|sha1)["']|\bMD5\s*\(|\bhashlib\.(md5|sha1)\s*\(|DES\b|["']?ECB["']?|Cipher\.getInstance\s*\(\s*["']DES/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Weak or broken cryptographic algorithm",
        body:
          "A weak or cryptographically broken algorithm is in use: MD5, SHA-1, DES, or ECB mode. " +
          "MD5 and SHA-1 are collision-vulnerable and must not be used for security purposes. " +
          "DES has a 56-bit key and is trivially brute-forced. ECB mode leaks data patterns. " +
          "Replace with SHA-256+ for hashing and AES-GCM or ChaCha20-Poly1305 for encryption."
      });
    }

    // ── Healthcare / HIPAA checks — backend source files only ────────────────
    // All 10 checks are gated to backend source extensions AND keyed on
    // PHI-specific identifiers so they do NOT fire on generic business logic.

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /(console\.(log|info|debug|warn)|print|println|logger\.\w+)\s*\([^)]*\b(ssn|mrn|patient|diagnosis|medicalRecord|healthRecord|dob|dateOfBirth|prescription|icd10)\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "PHI written to logs",
        body:
          "Protected Health Information (PHI) — patient identifiers, diagnoses, MRNs, SSNs, dates of birth, " +
          "prescriptions, or ICD-10 codes — is being written to a log or console output. " +
          "HIPAA prohibits PHI in logs unless the logging destination is itself a HIPAA-compliant, access-controlled audit trail. " +
          "Remove PHI from log statements; log only non-identifying surrogate keys or audit-trail references."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /\b(ssn|mrn|diagnosis|medication|medicalRecord|patientName|dob|icd10|prescription)\b\s*[:=]\s*["'][^"']/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "PHI stored in plaintext literal",
        body:
          "A PHI field (SSN, MRN, diagnosis, medication, medical record, patient name, date of birth, ICD-10 code, " +
          "or prescription) is assigned a plaintext string literal. " +
          "PHI must never be hardcoded in source — it must be encrypted at rest using a field-level encryption scheme " +
          "and never appear as a literal value in version-controlled code."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /(req\.query\.\w*(ssn|mrn|patient|dob)|[?&](ssn|mrn|patient|dob)=)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "PHI in URL/query string",
        body:
          "PHI identifiers (SSN, MRN, patient ID, or date of birth) are present in a URL query string. " +
          "Query strings are logged by web servers, proxies, CDNs, and browser history — transmitting PHI in URLs " +
          "is a HIPAA risk. Pass PHI in an encrypted request body (POST) or via headers; never in the URL."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /(sendEmail|sendgrid|twilio)\s*\([^)]*\b(diagnosis|ssn|mrn|patient|medicalRecord|prescription)\b|axios\.(post|put|patch)\s*\([^)]*\b(diagnosis|ssn|mrn|patient|medicalRecord|prescription)\b|fetch\s*\([^)]*\b(diagnosis|ssn|mrn|patient|medicalRecord|prescription)\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "PHI sent to an external service",
        body:
          "PHI (diagnosis, SSN, MRN, patient identifier, medical record, or prescription) is being passed to an " +
          "external service call — email, SMS, or HTTP API. " +
          "Sending PHI to a third-party service without a Business Associate Agreement (BAA) and appropriate " +
          "data-handling controls violates HIPAA. Verify the receiving service is a covered entity or has a BAA, " +
          "and transmit only the minimum-necessary PHI."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /\b(res\.(json|send)\s*\(|jsonify\s*\(|return\s+\{)[^;\n]*\b(ssn|mrn|diagnosis|medicalRecord|patientName)\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "PHI exposed in API response",
        body:
          "PHI (SSN, MRN, diagnosis, medical record, or patient name) is present in an API response. " +
          "API responses may be cached, logged by API gateways, or intercepted in transit. " +
          "Return only the minimum-necessary PHI fields required by the consumer; mask or omit sensitive identifiers " +
          "and ensure the response is encrypted in transit (TLS)."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /(analytics|mixpanel|segment|amplitude|gtag|track)\s*[.(][^)]*\b(patient|diagnosis|ssn|mrn|medicalRecord)\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "PHI sent to analytics/telemetry",
        body:
          "PHI (patient identifier, diagnosis, SSN, MRN, or medical record) is being sent to an analytics or " +
          "telemetry service. Analytics platforms are not HIPAA-covered entities and do not provide BAAs for " +
          "standard tiers. Sending PHI to analytics is a HIPAA violation. Strip all PHI before sending events; " +
          "use only anonymized or pseudonymized identifiers in analytics payloads."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /(getPatient|findPatient|patientRecord|medicalRecord)\w*\s*\([^)]*req\.(params|query|body)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Patient record fetched by user-supplied id (verify authorization)",
        body:
          "A patient record or medical record is being fetched using an ID from the HTTP request (params, query, or body) " +
          "without a visible authorization check. This is an IDOR (Insecure Direct Object Reference) vulnerability — " +
          "any authenticated user could access any patient's record by guessing or enumerating IDs. " +
          "Verify that the authenticated user is authorized to access the requested patient's record before fetching it."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /\b(fhir|hl7|epic|cerner)[A-Za-z]*(Token|ApiKey|Api_Key|Password|Secret|Credential|Key)\s*[:=]\s*["'][^"']/i.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Hardcoded clinical-system credential",
        body:
          "A credential (token, API key, password, or secret) for a clinical system (FHIR server, HL7 interface, " +
          "Epic, or Cerner) is hardcoded in source code. " +
          "Credentials committed to version control can be exfiltrated from repository history. " +
          "Load all clinical-system credentials from environment variables or a dedicated secret manager at runtime."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      /(SELECT\s+\*[^;]*\b(patient|medical_?record|phi)\b|\.(findAll|find)\s*\(\s*\)[^;]*\b(patient|medicalRecord)\b)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "low",
        title: "Over-broad PHI query (minimum-necessary)",
        body:
          "A query fetches all columns (SELECT *) or all records (.findAll() / .find()) from a patient, medical record, " +
          "or PHI table without a WHERE clause or field selection. " +
          "HIPAA's minimum-necessary standard requires that only the PHI fields required for the specific use-case " +
          "are accessed. Narrow the query to the specific fields and records needed."
      });
    }

    if (
      /\.(ts|tsx|js|jsx|mjs|py|java|rb|go)$/.test(line.file ?? "") &&
      (
        /(createHash\s*\(\s*["'](md5|sha1)["']|encrypt\w*\s*[:=]\s*(false|False|none))[^;\n]*\b(ssn|mrn|patient|phi|medicalRecord)\b/.test(text) ||
        /\b(ssn|mrn|patient|phi|medicalRecord)\b[^;\n]*(createHash\s*\(\s*["'](md5|sha1)["']|md5|sha1|encrypt\w*\s*[:=]\s*(false|False))/.test(text)
      )
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Weak/disabled encryption for PHI",
        body:
          "PHI (SSN, MRN, patient identifier, or medical record) is being protected with a weak or disabled " +
          "cryptographic scheme — MD5 or SHA-1 hashing, or encryption explicitly set to false or 'none'. " +
          "MD5 and SHA-1 are collision-vulnerable and must not be used for PHI protection. " +
          "Use AES-256-GCM or ChaCha20-Poly1305 for encryption, and SHA-256+ for hashing. " +
          "PHI must be encrypted both at rest and in transit under HIPAA Security Rule requirements."
      });
    }

    // ── Mobile (iOS / Android) checks — mobile source files only ────────────
    // Gated to .swift / .kt / .kts / .m / .mm / .plist and AndroidManifest.xml
    // so they never fire on existing web, fintech, healthcare, or benign fixtures.

    const isMobile =
      /\.(swift|kt|kts|m|mm|plist)$/.test(line.file ?? "") ||
      (line.file ?? "").endsWith("AndroidManifest.xml");

    if (
      isMobile &&
      /(UserDefaults|NSUserDefaults|SharedPreferences|getSharedPreferences)[^;\n]*(token|password|secret|apiKey|api_key|pin|credential)/i.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Secret stored in insecure local storage",
        body:
          "A secret (token, password, API key, PIN, or credential) is stored in UserDefaults/NSUserDefaults or SharedPreferences, " +
          "which are unencrypted and readable after a jailbreak or root. " +
          "Use the iOS Keychain (with kSecAttrAccessibleWhenUnlocked) or Android EncryptedSharedPreferences / Keystore instead."
      });
    }

    if (
      isMobile &&
      /(apiKey|api_key|secret|password|token|accessKey)\s*[:=]\s*["'][A-Za-z0-9_\-+\/]{12,}["']/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Hardcoded secret in mobile source",
        body:
          "A secret value (API key, token, password, or access key) is hardcoded as a string literal in mobile source code. " +
          "String literals are embedded in the compiled binary and can be extracted by static analysis. " +
          "Load secrets from build configuration (BuildConfig, Info.plist keys injected at build time) or a secure remote configuration service."
      });
    }

    if (
      isMobile &&
      /usesCleartextTraffic\s*=\s*["']?true|NSAllowsArbitraryLoads|http:\/\/(?!localhost|127\.0\.0\.1|10\.0\.2\.2)/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "Cleartext HTTP / ATS exception",
        body:
          "Cleartext HTTP traffic is explicitly permitted, or an ATS (App Transport Security) exception allows arbitrary HTTP loads. " +
          "All production traffic must use HTTPS. Remove usesCleartextTraffic=true, NSAllowsArbitraryLoads, and non-loopback http:// URLs."
      });
    }

    if (
      isMobile &&
      /android:exported\s*=\s*["']true["']/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Exported Android component",
        body:
          "An Android component (Activity, Service, Receiver, or Provider) is exported without an android:permission guard. " +
          "Any installed application can invoke this component. " +
          "Add android:permission with a signature-level permission, or set android:exported='false' if external access is not required."
      });
    }

    if (
      isMobile &&
      /setJavaScriptEnabled\s*\(\s*true\s*\)|addJavascriptInterface\s*\(/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "WebView JavaScript bridge enabled",
        body:
          "JavaScript is enabled on a WebView, or a Java/Kotlin object is exposed via addJavascriptInterface. " +
          "This opens a JS↔native bridge surface: any script running in the WebView (including injected via XSS) can call native methods. " +
          "Audit every @JavascriptInterface-annotated method; restrict the WebView to trusted origins only."
      });
    }

    if (
      isMobile &&
      /trustAllCerts|allowAllHostnameVerifier|\.disableEvaluation|NSExceptionAllowsInsecureHTTPLoads|checkServerTrusted\s*\([^)]*\)\s*(throws\s+\w+\s*)?\{\s*\}/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "high",
        title: "TLS certificate validation disabled",
        body:
          "TLS certificate validation is explicitly bypassed — either by an empty checkServerTrusted body, " +
          "a trustAllCerts / AllowAllHostnameVerifier implementation, or an NSExceptionAllowsInsecureHTTPLoads ATS exception. " +
          "This enables man-in-the-middle attacks. Restore proper certificate validation and use certificate pinning for critical endpoints."
      });
    }

    if (
      isMobile &&
      /(Log\.(d|v|i|e|w)|NSLog|os_log|print)\s*\([^)]*(password|token|secret|apiKey|creditCard|ssn|otp)/i.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Sensitive data written to device logs",
        body:
          "A sensitive value (password, token, secret, API key, credit card, SSN, or OTP) is passed to a device logging function. " +
          "Device logs (Logcat, os_log, NSLog) are readable by other apps with READ_LOGS permission or via adb. " +
          "Remove sensitive values from log statements; log only non-identifying surrogate keys or event types."
      });
    }

    if (
      isMobile &&
      /android:debuggable\s*=\s*["']true["']|<key>\s*get-task-allow\s*<\/key>/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Debuggable build flag enabled",
        body:
          "The application manifest or entitlements enable debugging in what may be a release build. " +
          "android:debuggable='true' allows arbitrary code injection and memory inspection via adb. " +
          "get-task-allow=true (iOS) allows debugger attachment. " +
          "These flags must be absent or false in production builds; ensure your release build configuration strips them."
      });
    }

    if (
      isMobile &&
      /(Math\.random|java\.util\.Random|\bRandom\s*\(\s*\)|arc4random\b(?!_uniform))[^;\n]*(key|token|iv|nonce|salt|otp|password)/i.test(text)
    ) {
      findings.push({
        ...base,
        severity: "medium",
        title: "Insecure randomness for a security value",
        body:
          "A non-cryptographic random number generator (Math.random, java.util.Random, arc4random) is used to generate a security-sensitive value " +
          "such as a key, token, IV, nonce, salt, OTP, or password. " +
          "These generators are not cryptographically secure and produce predictable output. " +
          "Use SecRandomCopyBytes (iOS/macOS) or java.security.SecureRandom (Android) for all cryptographic randomness."
      });
    }

    if (
      isMobile &&
      /kSecAttrAccessibleAlways\b|kSecAttrAccessibleAlwaysThisDeviceOnly\b/.test(text)
    ) {
      findings.push({
        ...base,
        severity: "low",
        title: "Weak Keychain accessibility",
        body:
          "A Keychain item uses kSecAttrAccessibleAlways or kSecAttrAccessibleAlwaysThisDeviceOnly, " +
          "which keeps the item accessible even when the device is locked. " +
          "Use kSecAttrAccessibleWhenUnlocked or kSecAttrAccessibleAfterFirstUnlock so that the item is " +
          "protected by the device passcode and the Secure Enclave when the screen is locked."
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

  const visible = applyInlineSuppressions(findings, lines);

  return {
    providerId: "heuristic",
    role,
    providerType: "mock",
    status: "ok",
    summary:
      visible.length > 0
        ? `Heuristic review found ${visible.length} issue${visible.length === 1 ? "" : "s"}.`
        : "Heuristic review found no obvious issues.",
    findings: visible,
    durationMs: Date.now() - startedAt
  };
}
