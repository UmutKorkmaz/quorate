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
      /(prompt|systemPrompt|userPrompt|content)\s*[:=][^;\n]*\$\{/.test(text)
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
      /\b(eval|new Function|execSync|exec|spawn)\s*\([^)]*(completion|response|output|llmResult|aiResult|message\.content|choices)/.test(text)
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
