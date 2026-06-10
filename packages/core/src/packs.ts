/** Ecosystem pack registry (solana first) — councils + per-role guidance. */
import type { DetectedProvider, QuorateConfig } from "./types.js";
import { createDefaultConfig } from "./providers.js";

export interface QuoratePack {
  id: string;
  description: string;
  councils: string[];
  roleGuidance: Record<string, string>;
}

const solana: QuoratePack = {
  id: "solana",
  description: "Solana / Anchor security review council",
  councils: [
    "solana-security",
    "anchor-accounts",
    "transaction-safety",
    "token-safety",
    "maintainer"
  ],
  roleGuidance: {
    "solana-security":
      "Audit every instruction for missing signer/owner checks and privilege-escalation paths. Scrutinise cross-program invocations (CPI) for arbitrary program-id acceptance, unchecked return values, and re-entrancy risks.",
    "anchor-accounts":
      "Review all #[account(...)] constraints, ensuring has_one, seeds, and bump are correctly specified. Flag every use of UncheckedAccount or AccountInfo that lacks a manual safety comment explaining why the constraint is safe.",
    "transaction-safety":
      "Check that skipPreflight is never set to true in production paths and that blockhash freshness and commitment levels are appropriate. Verify fee-payer selection and confirm that simulation results are checked before sending.",
    "token-safety":
      "Validate SPL token mint addresses, token-account ownership, and decimal precision before any arithmetic involving amounts. Confirm that Associated Token Account (ATA) derivation and ownership are verified, not assumed.",
    "maintainer":
      "Assess overall code structure, test coverage, and upgrade path safety. Identify dead code, unclear error messages, missing integration tests, and any patterns that will make the program hard to audit or extend."
  }
};

const evm: QuoratePack = {
  id: "evm",
  description: "EVM / Solidity security review council",
  councils: [
    "evm-security",
    "access-control",
    "reentrancy",
    "external-calls",
    "upgrade-safety",
    "maintainer"
  ],
  roleGuidance: {
    "evm-security":
      "Audit every Solidity file for tx.origin authentication, delegatecall to untrusted targets, selfdestruct usage, and unsafe inline assembly. Flag any pattern that bypasses EVM safety guarantees or exposes the contract to phishing or storage-collision attacks.",
    "access-control":
      "Verify that all state-changing functions are protected by onlyOwner, role-based access control, or explicit initializer guards. Confirm that initializers cannot be called twice and that privilege-granting functions are not exposed to arbitrary callers.",
    "reentrancy":
      "Enforce checks-effects-interactions ordering on every external call. Flag any function that sends ether or calls an external contract before finalising its own state updates, and confirm that nonReentrant guards are in place where needed.",
    "external-calls":
      "Review all low-level .call, .delegatecall, and ERC20 transfer/transferFrom invocations. Ensure return values are always checked, gas limits are considered, and the push-payment pattern is used to avoid DoS via gas-griefing.",
    "upgrade-safety":
      "Inspect proxied or upgradeable contracts for storage layout collisions, missing storage gaps in base contracts, double-initializer risks, and the use of immutable variables in proxy contexts. Confirm that the upgrade path is access-controlled.",
    "maintainer":
      "Assess overall code structure, test coverage, compiler version pinning, and long-term maintainability. Identify dead code, unclear error messages, missing natspec, and any patterns that will make the contract hard to audit or extend."
  }
};

const iac: QuoratePack = {
  id: "iac",
  description: "Infrastructure-as-Code (Terraform / Kubernetes) security review council",
  councils: [
    "iac-security",
    "network-exposure",
    "secrets-management",
    "identity-access",
    "resilience",
    "maintainer"
  ],
  roleGuidance: {
    "iac-security":
      "Audit all Terraform and Kubernetes manifests for general security posture. Look for insecure defaults, missing security contexts, and configurations that deviate from least-privilege principles. Verify that every resource has appropriate tags, labels, and metadata for traceability.",
    "network-exposure":
      "Review all network configuration for overly permissive ingress rules. Flag any use of 0.0.0.0/0 CIDR blocks in security groups, network ACLs, or firewall rules. Identify publicly accessible storage buckets (public ACLs), public IP assignments, and load balancers exposed without restriction. Ensure private subnets are used for sensitive workloads.",
    "secrets-management":
      "Detect plaintext secrets, passwords, access keys, and private keys hardcoded in Terraform variables, resource arguments, or Kubernetes manifests. Flag unencrypted storage volumes, databases without encryption-at-rest, and any secret stored as a plain ConfigMap instead of a Secret or external secrets manager reference.",
    "identity-access":
      "Scrutinise IAM roles and policies for over-broad permissions (wildcard actions or resources). In Kubernetes, flag privileged containers, containers running as root (runAsUser: 0 or runAsNonRoot: false), allowPrivilegeEscalation: true, and host namespace sharing (hostNetwork, hostPID, hostIPC). Enforce least-privilege for all service accounts and pod security contexts.",
    "resilience":
      "Check for missing CPU and memory resource limits on containers, which can cause noisy-neighbour DoS. Flag mutable image tags (:latest) that break reproducible deployments. Identify single-replica deployments for critical services that require high availability. Verify health probes (liveness, readiness) are configured.",
    "maintainer":
      "Assess overall code structure, module reuse, and long-term maintainability of the IaC. Identify duplicated resource blocks, missing output descriptions, unclear variable names, and lack of comments explaining non-obvious configuration choices. Check that modules are versioned and that the code is organised for team-scale use."
  }
};

const llm: QuoratePack = {
  id: "llm",
  description: "AI / LLM application security review council",
  councils: [
    "prompt-injection",
    "data-privacy",
    "tool-safety",
    "output-safety",
    "model-governance",
    "maintainer"
  ],
  roleGuidance: {
    "prompt-injection":
      "Audit every location where untrusted content — user input, fetched web pages, database records, third-party API responses — is concatenated into a prompt or system message. Flag any pattern that allows attacker-controlled content to override the system prompt, inject new instructions, or hijack the model's persona. Pay close attention to template literals and string interpolation that embed raw input without sanitisation or escaping.",
    "data-privacy":
      "Identify secrets, API keys, personally-identifiable information (PII), and other sensitive data that are included in prompts or logged alongside prompt/response pairs. Flag hardcoded LLM API keys (OpenAI sk-, Anthropic sk-ant-, Google AIza*). Verify that prompt and response logging is intentional, scoped, and complies with data-retention obligations. Ensure sensitive fields are redacted before being forwarded to a model.",
    "tool-safety":
      "Review every location where model-generated content — tool-call arguments, function-call JSON, completion text — is passed to code execution paths such as eval, new Function, exec, execSync, or spawn. Verify that tool-call arguments are schema-validated before use, that the model cannot self-invoke dangerous tools, and that any shell or filesystem operations gated on model output are independently authorised.",
    "output-safety":
      "Audit rendering paths that take model output and emit it as HTML or inject it into the DOM. Flag dangerouslySetInnerHTML, innerHTML assignment, or document.write calls that use completion text without prior sanitisation. Identify authorization or access-control decisions (if/switch/ternary) that are resolved by comparing model output strings, which can be manipulated by prompt injection.",
    "model-governance":
      "Check that moderation, safety filters, and content-policy settings are enabled and not overridden to 'none', false, or BLOCK_NONE. Flag model swaps, provider changes, or version pins that lack accompanying evaluation results. Confirm that rate limits, retry logic, and fallback behaviour are in place and that model configuration is managed through code review rather than ad-hoc changes.",
    "maintainer":
      "Assess overall code structure, test coverage, observability, and long-term maintainability of the LLM integration. Identify missing input-validation layers, absent unit tests for prompt-construction logic, unclear error messages from model calls, and any patterns that will make the AI feature hard to audit, debug, or extend."
  }
};

const move: QuoratePack = {
  id: "move",
  description: "Move (Sui / Aptos) smart-contract security review council",
  councils: [
    "move-security",
    "capability-safety",
    "resource-safety",
    "access-control",
    "maintainer"
  ],
  roleGuidance: {
    "move-security":
      "Audit every public entry function for missing caller-authorization checks — entry functions are externally callable by any account and must explicitly verify the signer. Review shared-object exposure in Sui: objects passed as &mut through shared_object transfer are accessible to any transaction and require careful mutation guards.",
    "capability-safety":
      "Inspect all capability types (AdminCap, MintCap, etc.) for leakage paths — capabilities must not be transferred to untrusted accounts or stored in world-readable locations. Verify that every privileged function is gated by a capability parameter or signer check rather than relying on call-site convention.",
    "resource-safety":
      "Review struct ability declarations (key, store, copy, drop) for correctness: value resources representing authority or assets must not carry copy (duplicable) or drop (silently destroyable) abilities. Audit every borrow_global_mut and move_from call to confirm the caller's address equals signer::address_of(account) before accessing or removing a stored resource.",
    "access-control":
      "Verify that every function performing privileged operations (withdraw, mint, burn, admin actions) performs an explicit signer::address_of check or requires a capability argument. Confirm that init / one-time admin functions are protected from re-invocation and that AdminCap issuance is restricted to the deployer.",
    "maintainer":
      "Assess overall code structure, test coverage, module upgrade path, and long-term maintainability. Identify dead code, unclear error codes, missing unit tests for critical functions, and any patterns that will make the module hard to audit or extend."
  }
};

const ci: QuoratePack = {
  id: "ci",
  description: "CI/CD and supply-chain security review council",
  councils: [
    "workflow-security",
    "dependency-integrity",
    "secrets-exposure",
    "build-provenance",
    "maintainer"
  ],
  roleGuidance: {
    "workflow-security":
      "Audit every GitHub Actions workflow for dangerous trigger configurations. Flag pull_request_target usage that checks out or executes PR head code — this runs untrusted contributor code with repo secrets. Identify expression-injection sinks where github.event.* fields (title, body, message, ref, label, email) are interpolated directly into run: steps via ${{ }} — these must be passed via env vars instead. Review permissions blocks for over-broad grants (write-all, or per-scope write where not needed). Flag self-hosted runners that may execute code from untrusted public pull requests without adequate isolation.",
    "dependency-integrity":
      "Review all uses: action references for mutable pointers — tags (v1, v2.3) and branch names (main, master, latest) are mutable and can be hijacked; every action must be pinned to a full 40-character commit SHA. Audit Dockerfile FROM instructions for :latest tags and remote ADD <url> patterns. Flag package.json changes that introduce install scripts (preinstall, postinstall, install) — these execute arbitrary code on every npm install and are a primary supply-chain attack surface.",
    "secrets-exposure":
      "Identify hardcoded registry and authentication tokens — _authToken in .npmrc, NODE_AUTH_TOKEN assignments, and raw npm_ tokens embedded in source. Flag jobs triggered by pull_request or pull_request_target that have access to secrets.* — untrusted PR code can exfiltrate these. Review workflow expressions that might echo or log secret values. Ensure OIDC token issuance (id-token: write) is scoped only to jobs that genuinely require it.",
    "build-provenance":
      "Verify that every third-party action is pinned to a commit SHA rather than a mutable tag to guarantee reproducible builds. Audit artifact upload/download steps for missing integrity checks. Flag any step that fetches and immediately executes a remote script (curl | sh, wget | bash) without verifying a checksum or signature — this provides no guarantee the fetched code has not been tampered with. Confirm that release workflows generate and attach SLSA provenance attestations where the project's threat model warrants it.",
    "maintainer":
      "Assess the overall security posture and maintainability of the CI/CD pipeline. Identify redundant workflow jobs, missing timeout-minutes settings (which can cause runaway billable minutes), absent concurrency groups, and poorly documented pipeline steps. Check that branch protection rules are consistent with the workflow triggers in use."
  }
};

const fintech: QuoratePack = {
  id: "fintech",
  description: "Fintech / PCI-DSS payment security review council",
  councils: [
    "payment-security",
    "pci-compliance",
    "data-protection",
    "transaction-integrity",
    "maintainer"
  ],
  roleGuidance: {
    "payment-security":
      "Audit every payment webhook handler for missing signature verification (e.g. Stripe constructEvent). " +
      "Verify idempotency keys are used on charge/refund endpoints to prevent double-charging. " +
      "Confirm all connections to payment gateways use TLS with certificate verification enabled — never rejectUnauthorized: false.",
    "pci-compliance":
      "Enforce PCI-DSS card data rules: CVV/CVC must never be stored after authorization — not in databases, caches, or logs. " +
      "Primary Account Numbers (PAN) must be masked (show only last 4 digits) before appearing in any log, error message, or API response. " +
      "Flag any code path that persists raw card numbers or security codes.",
    "data-protection":
      "Identify financial PII (SSN, tax IDs, bank account numbers, routing numbers, IBANs) that is stored or transmitted in plaintext. " +
      "Require encryption at rest for all sensitive financial fields. " +
      "Ensure no secrets, API keys, or credentials are hardcoded in source — load from environment variables or a secret manager.",
    "transaction-integrity":
      "Monetary values must be represented as integer minor units (cents, pence) rather than floating-point numbers — floats cannot represent all decimal currency values exactly and lose cents over repeated arithmetic. " +
      "Flag parseFloat(), float/double/number types on money fields, and floating-point arithmetic operators applied to currency values. " +
      "Verify that amount validation rejects negative, zero, and out-of-range values before processing.",
    "maintainer":
      "Assess overall code structure, test coverage, error handling, and long-term maintainability of the payment integration. " +
      "Identify missing idempotency handling, absent retry logic, unclear error messages from payment APIs, and any patterns that will make the financial logic hard to audit or extend."
  }
};

const web: QuoratePack = {
  id: "web",
  description: "Web & API security (OWASP) review council",
  councils: [
    "injection",
    "broken-access-control",
    "ssrf",
    "auth-session",
    "data-exposure",
    "maintainer"
  ],
  roleGuidance: {
    "injection":
      "Audit every location where untrusted input (req.query, req.params, req.body, request.args, request.GET, request.json) " +
      "flows into shell commands, file-system paths, template engines, or deserialization sinks. " +
      "Flag command injection (exec/spawn with user-controlled arguments), path traversal (readFile/open with unvalidated paths), " +
      "server-side template injection, and insecure deserialization (pickle.loads, yaml.load without SafeLoader, unserialize, marshal.loads). " +
      "Demand allow-listing, strict input validation, and sandboxed execution for any code path that touches these sinks.",
    "broken-access-control":
      "Identify every endpoint or resource access that lacks explicit authorization checks — IDOR patterns where an object ID from " +
      "the request is used directly without verifying the caller owns it, missing role/permission guards on sensitive routes, " +
      "and mass-assignment vulnerabilities where req.body is bound directly to a model (new Model(req.body), Object.assign with req.body, " +
      ".create(req.body)). Flag permissive CORS configurations that use wildcard origins or reflect the request origin without " +
      "an allow-list, which bypass the same-origin policy.",
    "ssrf":
      "Review every server-side HTTP/network request for user-controlled URL or host components. Flag any call to fetch, axios, " +
      "requests.get/post, http.get, urllib, or similar where the URL, host, or path is constructed from req.query, req.params, " +
      "req.body, request.args, or request.GET. Require URL allow-listing, disallow private IP ranges, and enforce scheme restrictions " +
      "to prevent attackers from pivoting to internal services or cloud metadata endpoints. Also flag open-redirect sinks " +
      "(res.redirect, sendRedirect) driven by user input.",
    "auth-session":
      "Audit session and authentication logic for CSRF protection gaps — flag csrf: false, @csrf_exempt, csrfProtection: false, " +
      "and any state-changing endpoint that lacks a CSRF token check. Review JWT configuration for algorithm confusion " +
      "(alg: none, weak HS256 secrets). Identify weak or broken cryptographic primitives: MD5, SHA-1, DES, ECB mode — " +
      "require SHA-256+ and authenticated encryption modes. Verify session cookies use Secure, HttpOnly, and SameSite attributes.",
    "data-exposure":
      "Check every response-building path for reflected XSS: unescaped user input emitted via res.send/res.write/res.end, " +
      "innerHTML assignment, or document.write. Flag any handler that echoes req.query/params/body content directly into " +
      "an HTTP response without HTML encoding. Ensure sensitive data (tokens, PII, internal paths) is not included in " +
      "API responses or error messages. Verify that Content-Type headers are set correctly and that JSON responses are " +
      "not sniffable as HTML.",
    "maintainer":
      "Assess overall code structure, input validation layers, error handling, test coverage, and long-term maintainability " +
      "of the web application. Identify missing validation middleware, absent rate limiting, unclear error messages that leak " +
      "stack traces or internal paths, and any patterns that will make the API hard to audit or extend."
  }
};

const healthcare: QuoratePack = {
  id: "healthcare",
  description: "Healthcare / HIPAA (PHI) security review council",
  councils: [
    "phi-protection",
    "access-audit",
    "data-encryption",
    "clinical-safety",
    "maintainer"
  ],
  roleGuidance: {
    "phi-protection":
      "Audit every code path for PHI leaking outside of secure, authorized channels. " +
      "PHI (patient names, SSNs, MRNs, diagnoses, medications, dates of birth, ICD-10 codes, prescriptions, medical records) " +
      "must never appear in logs, console output, URLs, query strings, analytics events, or unencrypted API responses. " +
      "Enforce minimum-necessary access — queries must retrieve only the specific fields required for the current use-case.",
    "access-audit":
      "Verify that every access to patient records is explicitly authorized before the record is returned. " +
      "Flag any code path where a patient record is fetched using an ID from req.params, req.query, or req.body without " +
      "a prior ownership/authorization check — these are IDOR (Insecure Direct Object Reference) vulnerabilities. " +
      "Confirm that PHI access is logged to an audit trail with the accessor identity, timestamp, and record ID.",
    "data-encryption":
      "Ensure PHI is encrypted at rest using strong, approved algorithms (AES-256-GCM or equivalent). " +
      "Verify that PHI in transit is protected by TLS with certificate verification enabled. " +
      "Flag weak or disabled encryption: MD5 or SHA-1 used on PHI fields, encrypt flags set to false or 'none', " +
      "and any plaintext storage of identifiers like SSN, MRN, date of birth, or diagnosis codes. " +
      "Confirm that encryption keys are managed through a dedicated key management service (KMS), not hardcoded.",
    "clinical-safety":
      "Ensure PHI is never exposed in error messages, exception traces, or API error responses. " +
      "Validate all clinical inputs — ICD-10 codes, medication dosages, MRN formats — against strict schemas " +
      "before processing to prevent garbage data entering clinical workflows. " +
      "Flag any hardcoded credentials for clinical systems (FHIR servers, Epic, Cerner) — these must be loaded " +
      "from environment variables or a secret manager. Confirm that debug endpoints and health-check routes " +
      "do not reveal PHI or internal patient data.",
    "maintainer":
      "Assess overall code structure, test coverage, error handling, and long-term maintainability of the " +
      "healthcare integration. Identify missing input-validation layers, absent audit-logging for PHI access, " +
      "unclear error messages, and any patterns that will make the HIPAA compliance posture hard to audit or extend."
  }
};

const mobile: QuoratePack = {
  id: "mobile",
  description: "Mobile (iOS / Android) app security review council",
  councils: [
    "insecure-storage",
    "platform-config",
    "network-security",
    "crypto-secrets",
    "maintainer"
  ],
  roleGuidance: {
    "insecure-storage":
      "Audit every location where sensitive values — session tokens, passwords, PINs, API keys, biometric hashes — are persisted on the device. " +
      "Flag any use of UserDefaults or NSUserDefaults for secret storage; these are unencrypted plist files readable by any process with filesystem access after a jailbreak. " +
      "Verify that iOS Keychain items use kSecAttrAccessibleWhenUnlocked or kSecAttrAccessibleAfterFirstUnlock, never kSecAttrAccessibleAlways. " +
      "On Android, require EncryptedSharedPreferences or Android Keystore-backed storage rather than plain SharedPreferences for secret values. " +
      "Also flag clipboard (UIPasteboard / ClipboardManager) usage that copies sensitive values, which can be read by any background app.",
    "platform-config":
      "Review the AndroidManifest.xml and iOS entitlements/Info.plist for dangerous configuration flags. " +
      "Flag every android:exported='true' on Activity, Service, BroadcastReceiver, or ContentProvider that lacks a corresponding android:permission guard — any installed app can invoke these components. " +
      "Flag android:debuggable='true' in production manifests; it allows arbitrary code injection via adb. " +
      "Flag iOS get-task-allow entitlement set to true, which enables debugger attachment on release builds. " +
      "Audit WebView configurations: setJavaScriptEnabled(true) and addJavascriptInterface() open the app to XSS-driven native code execution; " +
      "every JS↔native bridge method must be reviewed for injection risk and the allowedOrigins must be enforced.",
    "network-security":
      "Verify that all network traffic uses HTTPS. " +
      "Flag android:usesCleartextTraffic='true', usesCleartextTraffic='true' in network security config, NSAllowsArbitraryLoads in ATS, " +
      "and any http:// URL that is not localhost/127.0.0.1/10.0.2.2. " +
      "Flag NSExceptionAllowsInsecureHTTPLoads in per-domain ATS exceptions — these silently allow plaintext traffic to named hosts. " +
      "Audit TLS validation: empty checkServerTrusted implementations, trustAllCerts patterns, " +
      "AllowAllHostnameVerifier usage, and URLSession delegates that call completionHandler(.useCredential) " +
      "unconditionally all disable certificate validation and enable man-in-the-middle attacks.",
    "crypto-secrets":
      "Identify hardcoded credentials (API keys, secrets, tokens, access keys) embedded as string literals in Swift, Kotlin, or Objective-C source. " +
      "These values end up in compiled binaries and can be extracted by static analysis or strings inspection. " +
      "Secrets must be loaded from build configuration, environment variables, or a remote secret-fetching mechanism at runtime. " +
      "Audit cryptographic randomness: arc4random (without _uniform), java.util.Random, and Math.random are not cryptographically secure and must not be used " +
      "to generate keys, IVs, nonces, salts, OTPs, or session tokens — use SecRandomCopyBytes (iOS) or SecureRandom (Android). " +
      "Flag weak hashing algorithms (MD5, SHA-1) applied to sensitive values.",
    "maintainer":
      "Assess overall code structure, test coverage, and long-term maintainability of the mobile application. " +
      "Identify missing input validation, absent error handling, unclear security comments, dead code, and any patterns " +
      "that will make the app's security posture hard to audit or extend."
  }
};

export const PACKS: Record<string, QuoratePack> = { solana, evm, iac, llm, move, ci, fintech, web, healthcare, mobile };
export const PACK_IDS = Object.keys(PACKS);

/**
 * Build a QuorateConfig seeded from a pack.
 *
 * - Starts from createDefaultConfig(detected) so all provider meta-data
 *   (command, args, inputMode, timeoutMs, …) comes from the existing logic.
 * - Overrides councils and roleGuidance with pack values.
 * - Re-assigns pack councils (minus "maintainer") to real providers round-robin,
 *   2 roles per provider.  The heuristic/mock provider always gets ["maintainer"].
 */
export function buildPackConfig(
  pack: QuoratePack,
  detected: DetectedProvider[]
): QuorateConfig {
  const base = createDefaultConfig(detected);

  // Councils that should be distributed among real (non-mock) providers.
  const distributedCouncils = pack.councils.filter((c) => c !== "maintainer");

  // Split providers into mock (heuristic) and real.
  const mockProviders = base.providers.filter((p) => p.type === "mock");
  const realProviders = base.providers.filter((p) => p.type !== "mock");

  // Assign pack councils to real providers round-robin, 2 per provider.
  const updatedRealProviders = realProviders.map((provider, index) => {
    const chunkStart = index * 2;
    const roles = distributedCouncils.slice(chunkStart, chunkStart + 2);
    // If we've run out of distributed councils give the provider at least one
    // from the pack so the array is never empty.
    const finalRoles = roles.length > 0 ? roles : [distributedCouncils[index % distributedCouncils.length]];
    return { ...provider, roles: finalRoles };
  });

  // Mock providers always carry "maintainer".
  const updatedMockProviders = mockProviders.map((provider) => ({
    ...provider,
    roles: ["maintainer"]
  }));

  return {
    ...base,
    councils: pack.councils,
    roleGuidance: pack.roleGuidance,
    providers: [...updatedMockProviders, ...updatedRealProviders]
  };
}
