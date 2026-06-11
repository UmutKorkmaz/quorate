/** Ecosystem pack registry (solana first) — councils + per-role guidance. */
import type { DetectedProvider, ProviderConfig, QuorateConfig } from "./types.js";
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

const accessibility: QuoratePack = {
  id: "accessibility",
  description: "Web/app accessibility (WCAG 2.2 AA) review council",
  councils: [
    "semantic-structure",
    "aria-correctness",
    "keyboard-interaction",
    "perceivable-media",
    "maintainer"
  ],
  roleGuidance: {
    "semantic-structure":
      "Audit document and content structure for native semantics: a single <html lang> declaration, exactly one logical <h1>, and headings that descend without skipping levels (h1 to h2 to h3, never h1 to h3). Flag generic <div>/<span> wrappers used where <button>, <nav>, <main>, <header>, or a heading element exists, since assistive technology relies on the native role and outline. Verify that landmark and heading hierarchy gives screen-reader users a coherent page map.",
    "aria-correctness":
      "Verify that every ARIA attribute is spelled and used correctly per the WAI-ARIA spec: flag typos like aria-labeledby or aria-describ, invalid attribute names, and roles applied to elements that cannot host them. Confirm that aria-label, aria-labelledby, and title are present wherever an icon-only control or unlabelled region needs an accessible name. Reject ARIA that contradicts native semantics or duplicates a visible label, since the first rule of ARIA is to prefer a native element.",
    "keyboard-interaction":
      "Ensure every interactive control is reachable and operable by keyboard alone. Flag onClick handlers on non-interactive elements (div/span) that lack a role plus a keyboard handler (onKeyDown/onKeyUp), and reject positive tabIndex values that fight the natural DOM tab order. Confirm anchors used as buttons carry a real href rather than '#' or 'javascript:void(0)', and that focus order is logical and visible.",
    "perceivable-media":
      "Audit non-text content for text alternatives and user control. Every <img> conveying meaning must carry an alt attribute (empty alt only for purely decorative images), and every form control must have an associated label or aria-label rather than relying on a placeholder. Flag autoplaying <video>/<audio> that is not muted and lacks controls, since unexpected sound and motion violate WCAG and disorient users.",
    "maintainer":
      "Assess the overall structure, test coverage, and maintainability of the accessibility work. Identify missing automated a11y assertions (axe/jest-axe), components that re-implement native semantics instead of composing accessible primitives, and inconsistent labelling patterns across the codebase. Flag dead ARIA, duplicated focus-management logic, and any pattern that will make accessibility hard to verify or extend at team scale."
  }
};

const dataSql: QuoratePack = {
  id: "data-sql",
  description: "Data engineering and SQL pipeline safety review council for queries, warehouses, dbt, and Airflow",
  councils: [
    "query-safety-reviewer",
    "warehouse-cost-reviewer",
    "data-correctness-reviewer",
    "pii-governance-reviewer",
    "maintainer"
  ],
  roleGuidance: {
    "query-safety-reviewer":
      "Verify that no SQL is assembled from string concatenation, f-strings, or string formatting with runtime variables; require parameterized queries or a vetted query builder. Confirm destructive statements (UPDATE, DELETE, DROP, TRUNCATE) are guarded by an explicit WHERE clause or environment check. Treat any interpolated identifier or literal in a SQL string as a potential injection and correctness hazard.",
    "warehouse-cost-reviewer":
      "Flag queries that scan more than necessary: SELECT * in production paths, unbounded result sets missing a LIMIT, and cartesian or cross joins that explode row counts. Confirm columnar warehouses are queried with explicit projections and predicate pushdown. Push back on patterns that turn a cheap query into a full-table or full-partition scan.",
    "data-correctness-reviewer":
      "Ensure monetary and exact-decimal values use DECIMAL/NUMERIC rather than FLOAT, REAL, or DOUBLE to avoid rounding drift. Verify that multiple dependent writes execute inside a single transaction so partial failures cannot leave inconsistent state. Check joins, filters, and aggregations for the silent data-loss patterns that pass tests but corrupt downstream tables.",
    "pii-governance-reviewer":
      "Identify sensitive columns (email, SSN, phone, address, card numbers) that are selected into logs, print statements, or unmasked output. Confirm DSNs, passwords, and connection strings are never hardcoded and come from environment variables or a secret manager. Treat any PII flowing into observability or stdout as a governance violation requiring masking or removal.",
    "maintainer":
      "Assess the structure, testability, and maintainability of pipeline and SQL model code: clear separation of transformation logic, documented assumptions, and tests for boundary conditions. Confirm queries and DAGs are idempotent, parameterized via config, and not duplicated across models. Ensure changes include coverage for the data-correctness edge cases the other reviewers raise."
  }
};

const k8s: QuoratePack = {
  id: "k8s",
  description: "Kubernetes workload manifest hardening review council",
  councils: [
    "pod-security-context-reviewer",
    "host-isolation-reviewer",
    "rbac-scope-reviewer",
    "resource-governance-reviewer",
    "maintainer"
  ],
  roleGuidance: {
    "pod-security-context-reviewer":
      "Scrutinize container and pod securityContext fields for privilege escalation vectors: privileged:true, runAsNonRoot:false, runAsUser:0, allowPrivilegeEscalation:true, and dangerous added capabilities. Require workloads to drop ALL capabilities by default and run as a non-root UID. Treat any privileged container or root execution as a critical finding unless an explicit, justified exception exists.",
    "host-isolation-reviewer":
      "Verify the pod does not break the boundary between container and node. Flag hostNetwork, hostPID, and hostIPC set to true, and hostPath volume mounts that expose the node filesystem. Confirm automountServiceAccountToken is disabled where the workload does not call the Kubernetes API, since a leaked host namespace plus a mounted token is a direct path to cluster compromise.",
    "rbac-scope-reviewer":
      "Audit Role and ClusterRole rules for least privilege. Reject wildcard verbs, resources, or apiGroups that grant broad authority, and confirm rules name specific verbs and resources. Pay special attention to bindings that attach permissive roles to default or automounted service accounts.",
    "resource-governance-reviewer":
      "Ensure every container declares CPU and memory limits so a single workload cannot exhaust node resources or trigger noisy-neighbor denial of service. Flag containers missing resources.limits entirely. Confirm limits are paired with sensible requests for scheduling fairness.",
    "maintainer":
      "Assess manifest structure, naming, label conventions, and whether changes are covered by manifest linting or policy tests (e.g. kubeconform, conftest/OPA, kyverno). Confirm pinned image tags instead of mutable :latest so deployments are reproducible. Ensure the diff is reviewable and does not regress existing hardening."
  }
};

const privacy: QuoratePack = {
  id: "privacy",
  description: "Data-protection & privacy lifecycle review council (GDPR / CCPA)",
  councils: [
    "consent-lawful-basis",
    "data-minimization",
    "retention-erasure",
    "transfer-sharing",
    "maintainer"
  ],
  roleGuidance: {
    "consent-lawful-basis":
      "Verify that any data collection or tracking that depends on consent is gated behind an explicit, opt-in consent check before it fires. Flag analytics, pixels, and cookies set before consent is recorded, and precise-geolocation capture that has no accompanying notice or permission prompt. Confirm the lawful basis for each processing activity is identifiable in code and that consent is freely given, specific, and revocable.",
    "data-minimization":
      "Enforce data minimisation and purpose limitation: code should collect, log, and transmit only the personal data strictly necessary for the stated purpose. Flag PII written to logs, embedded in URLs or query strings, and full-table SELECT * dumps of user records. Require pseudonymisation or anonymisation before personal data is sent to analytics warehouses, ML training, or any secondary use.",
    "retention-erasure":
      "Check that stored personal data has a defined retention period or TTL and that a working right-to-erasure (right to be forgotten) path exists. Flag PII-bearing schemas and tables created without expiry, and soft-delete or deactivation patterns masquerading as deletion when GDPR Art. 17 requires actual erasure or irreversible anonymisation. Confirm deletion cascades to backups, caches, and downstream copies.",
    "transfer-sharing":
      "Scrutinise every flow that sends personal data to a third party or across a border. Flag PII forwarded to external APIs, marketing/CRM platforms, or sub-processors without an evident contract, data-processing agreement, or transfer-mechanism flag. Confirm cross-border transfers rely on an adequacy decision or appropriate safeguards (SCCs) and that 'sale'/'share' of personal information is honoured against CCPA opt-out signals.",
    "maintainer":
      "Assess overall structure, test coverage, and maintainability of the privacy-relevant code. Identify missing consent-gating abstractions, absent unit tests for erasure and retention logic, unclear data-flow boundaries, and any patterns that will make the data-protection posture hard to audit, prove, or extend. Confirm privacy controls are centralised rather than copy-pasted per call site."
  }
};

const mlops: QuoratePack = {
  id: "mlops",
  description: "ML training & model-lifecycle safety review council",
  councils: [
    "artifact-provenance",
    "data-leakage",
    "reproducibility",
    "pipeline-security",
    "maintainer"
  ],
  roleGuidance: {
    "artifact-provenance":
      "Trace every model and dataset artifact back to a trusted, pinned source. Flag deserialization of untrusted weights via pickle.load, torch.load, or joblib.load, and any hub download (from_pretrained, hf_hub_download, load_dataset) that lacks a revision or commit pin. Confirm checksums or signatures gate artifacts before they enter training or serving.",
    "data-leakage":
      "Audit feature engineering and split ordering for information bleeding from test into train. Flag scalers, encoders, or imputers fit on the full dataset before train_test_split, and target-derived columns left in the feature matrix. Verify transforms are fit inside a pipeline or only on training folds.",
    "reproducibility":
      "Confirm every source of randomness is seeded and every dependency is pinned so a run can be reproduced bit-for-bit. Flag training that omits seed_everything / random_state, missing train/validation splits, and model or dataset versions referenced without an explicit version or revision. Reproducibility is a prerequisite for trustworthy evaluation.",
    "pipeline-security":
      "Review config and orchestration code for unsafe loading and credential handling. Flag yaml.load without SafeLoader, eval/exec over experiment config, and hardcoded dataset, registry, or storage credentials. Configuration must be parsed safely and secrets must come from environment or a secret manager.",
    "maintainer":
      "Assess overall pipeline structure, test coverage, and long-term maintainability of the ML codebase. Identify duplicated preprocessing logic, untested data-split and metric code, unclear experiment naming, and any patterns that make training runs hard to audit, reproduce, or extend."
  }
};

const embedded: QuoratePack = {
  id: "embedded",
  description: "Embedded C/C++ firmware safety review council (memory, MISRA, real-time)",
  councils: [
    "memory-safety",
    "misra-conformance",
    "concurrency-isr",
    "realtime-timing",
    "maintainer"
  ],
  roleGuidance: {
    "memory-safety":
      "Audit every buffer operation, allocation, and pointer cast for spatial and temporal safety. Flag unbounded string functions (strcpy, strcat, sprintf, gets), memcpy/memmove calls whose length argument is not provably bounded by the destination size, and any allocation whose returned pointer is dereferenced before a NULL check. Confirm buffer sizes flow from a single named constant rather than ad-hoc literals.",
    "misra-conformance":
      "Enforce MISRA C/C++ discipline on each changed line. Flag use of goto, mixed signed/unsigned comparisons, reliance on implicit conversions, and floating-point equality tests. Verify that essential-type rules are respected and that constructs banned or restricted by MISRA carry a documented, justified deviation rather than slipping in silently.",
    "concurrency-isr":
      "Review every variable shared between an ISR and the main loop, and every memory-mapped hardware register, for a missing volatile qualifier that lets the compiler cache or reorder accesses. Confirm that ISR-shared state is accessed atomically or under a critical section, and that interrupt handlers never call non-reentrant or blocking library routines.",
    "realtime-timing":
      "Hunt for behaviour that destroys deterministic timing: dynamic allocation (malloc, calloc, new) on hot or interrupt paths, unbounded loops, and blocking calls inside time-critical code. Verify that worst-case execution time is bounded and that allocations, if any, happen only during startup rather than in steady-state real-time paths.",
    "maintainer":
      "Assess overall structure, test coverage, and long-term maintainability of the firmware change. Flag ignored return values from system/HAL calls, magic numbers, oversized functions, and missing unit or hardware-in-the-loop tests. Confirm error paths are handled explicitly and that the code will remain auditable against the coding standard as it evolves."
  }
};

const performance: QuoratePack = {
  id: "performance",
  description: "Performance, scalability and reliability review council",
  councils: [
    "latency-io",
    "data-access-scaling",
    "resource-lifecycle",
    "reliability-timeouts",
    "maintainer"
  ],
  roleGuidance: {
    "latency-io":
      "Hunt for serialized I/O on hot paths: await inside for/while loops, sequential network or disk calls that could run concurrently, and synchronous fs calls (readFileSync, existsSync) inside request handlers. Recommend Promise.all / asyncio.gather batching and non-blocking async fs APIs. Quantify the cost: N serial round-trips at p99 latency L means N x L added to the request.",
    "data-access-scaling":
      "Scrutinise every database and ORM access for N+1 patterns (a query issued once per item in a loop) and for list/collection endpoints that fetch without a LIMIT, take, or pagination cursor. Push callers toward batched IN queries, JOINs, dataloaders, and bounded page sizes. Treat any query whose result set grows with tenant data but has no upper bound as a scalability defect.",
    "resource-lifecycle":
      "Track the lifecycle of every acquired resource and every accumulator. Flag new DB clients/connections created per request instead of drawing from a pool, in-memory caches and arrays that grow without an eviction or size cap, JSON.parse over an unbounded request/stream body, and timers or listeners registered without matching teardown. Confirm bounded memory and deterministic cleanup.",
    "reliability-timeouts":
      "Ensure every outbound network call has an explicit timeout or AbortController/AbortSignal so a slow dependency cannot exhaust the request pool or pin connections. Flag fetch/axios/requests calls with no timeout and quadratic O(n^2) scans (nested includes/indexOf over arrays) that turn into CPU cliffs as input grows. Reliability means bounded blast radius under partial failure.",
    "maintainer":
      "Assess overall structure, test coverage and observability of the changed code. Confirm there are load or regression tests around hot paths, that performance-critical constants (page sizes, timeouts, cache caps) are named and configurable, and that the change is easy to reason about. Flag missing metrics/tracing on new I/O paths and any structure that makes future tuning hard."
  }
};

const graphql: QuoratePack = {
  id: "graphql",
  description: "GraphQL API security & design review council",
  councils: [
    "query-execution",
    "resolver-authorization",
    "schema-design",
    "data-access",
    "maintainer"
  ],
  roleGuidance: {
    "query-execution":
      "Audit server configuration for the absence of query-cost controls: depth limits, complexity/cost analysis, and batch/alias amplification guards. Flag introspection left enabled in production, empty validationRules arrays, and allowBatchedHttpRequests: true, all of which let a single request fan out into an expensive operation. Confirm a maximum query depth and a complexity ceiling are enforced before execution, and that timeouts cap long-running resolvers.",
    "resolver-authorization":
      "Verify every sensitive Query and Mutation resolver performs an explicit object- and field-level authorization check using the request context, not just gateway-level authentication. Flag resolvers for privileged operations (deleteUser, setRole, allUsers) that omit the context argument entirely, and any @skip/@include directive whose condition gates an auth-protected field — a classic auth-bypass primitive. Authorization must be re-checked at each resolver because GraphQL lets clients reach nested fields through many paths.",
    "schema-design":
      "Review the SDL for fields that invite abuse by design: list fields whose pagination argument (first, last, limit) has no default or upper bound, and mutations that lack a rate-limit directive. Ensure list resolvers expose cursor- or offset-based pagination with a server-enforced ceiling rather than returning unbounded collections. Confirm error-shaping configuration does not leak stack traces, original errors, or internal exception details to clients.",
    "data-access":
      "Scrutinise resolvers for N+1 query patterns — per-parent findAll/findMany calls that should be batched through a DataLoader — and for raw database queries interpolating GraphQL args or input directly into query strings. Require parameterized queries and batched/loader-based data fetching. Confirm that list resolvers invoked per parent node do not issue an unbounded number of downstream queries.",
    "maintainer":
      "Assess overall schema modularity, resolver test coverage, and long-term maintainability of the GraphQL layer. Identify resolvers without unit tests, duplicated authorization logic that should be a shared directive or middleware, unclear error mapping, and dead schema fields. Check that schema changes are reviewed for breaking-change impact and that complexity/depth limits are covered by integration tests."
  }
};

export const PACKS: Record<string, QuoratePack> = {
  solana, evm, iac, llm, move, ci, fintech, web, healthcare, mobile,
  accessibility, "data-sql": dataSql, k8s, privacy, mlops, embedded, performance, graphql
};
export const PACK_IDS = Object.keys(PACKS);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Distribute `distributedCouncils` across real (non-mock) providers, 2 per
 * provider round-robin.  Providers past the last chunk wrap-around so no
 * provider ever ends up with an empty roles array.
 */
function assignCouncilsToProviders(
  distributedCouncils: string[],
  realProviders: ProviderConfig[],
  mockProviders: ProviderConfig[]
): ProviderConfig[] {
  const updatedReal = realProviders.map((provider, index) => {
    const chunkStart = index * 2;
    const roles = distributedCouncils.slice(chunkStart, chunkStart + 2);
    const finalRoles =
      roles.length > 0 ? roles : [distributedCouncils[index % distributedCouncils.length]];
    return { ...provider, roles: finalRoles };
  });

  const updatedMock = mockProviders.map((provider) => ({
    ...provider,
    roles: ["maintainer"]
  }));

  return [...updatedMock, ...updatedReal];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a QuorateConfig from a list of packs (multi-pack merge).
 *
 * Councils:
 *   - De-duplicated UNION of all packs' councils.
 *   - "maintainer" appears exactly once and is moved to the END.
 *
 * roleGuidance:
 *   - Merged object of all packs' roleGuidance. First-pack wins on collision.
 *
 * Providers:
 *   - Round-robin all non-maintainer union councils across real providers,
 *     2 per provider.  Mock/heuristic providers always get ["maintainer"].
 *
 * When called with a single pack the result is equivalent to buildPackConfig.
 * Pure + immutable.
 */
export function buildMultiPackConfig(
  packs: QuoratePack[],
  detected: DetectedProvider[]
): QuorateConfig {
  // 1. Union of all councils, deduped, maintainer moved to end exactly once.
  const seenCouncils = new Set<string>();
  const unionCouncils: string[] = [];

  for (const pack of packs) {
    for (const council of pack.councils) {
      if (council !== "maintainer" && !seenCouncils.has(council)) {
        seenCouncils.add(council);
        unionCouncils.push(council);
      }
    }
  }
  // Append "maintainer" exactly once at the end.
  const councils = [...unionCouncils, "maintainer"];

  // 2. Merge roleGuidance — first pack wins on key collision.
  const roleGuidance: Record<string, string> = {};
  for (const pack of packs) {
    for (const [key, value] of Object.entries(pack.roleGuidance)) {
      if (!(key in roleGuidance)) {
        roleGuidance[key] = value;
      }
    }
  }

  // 3. Distribute non-maintainer union councils across real providers.
  const base = createDefaultConfig(detected);
  const mockProviders = base.providers.filter((p) => p.type === "mock");
  const realProviders = base.providers.filter((p) => p.type !== "mock");

  const providers = assignCouncilsToProviders(unionCouncils, realProviders, mockProviders);

  return {
    ...base,
    councils,
    roleGuidance,
    providers
  };
}

/**
 * Build a QuorateConfig seeded from a single pack.
 * Delegates to buildMultiPackConfig for consistency.
 */
export function buildPackConfig(
  pack: QuoratePack,
  detected: DetectedProvider[]
): QuorateConfig {
  return buildMultiPackConfig([pack], detected);
}

// ---------------------------------------------------------------------------
// Pack detection
// ---------------------------------------------------------------------------

/**
 * Infer which domain packs apply to a repo from lightweight signals.
 *
 * @param signals.files        Repo-relative file paths (from e.g. `git ls-files`).
 * @param signals.dependencies Optional list of package names (from package.json keys).
 * @returns Matched pack ids in PACK_IDS order, deduped.
 */
export function detectPacks(signals: {
  files: string[];
  dependencies?: string[];
}): string[] {
  const { files, dependencies = [] } = signals;

  const matched = new Set<string>();

  // Normalise to lowercase for case-insensitive comparison.
  const lowerFiles = files.map((f) => f.toLowerCase());

  // ── Solana: any *.rs file present (Anchor.toml / Cargo.toml strengthen the
  //   signal but are not required — *.rs alone is sufficient for v1).
  if (lowerFiles.some((f) => f.endsWith(".rs"))) {
    matched.add("solana");
  }

  // ── EVM: any *.sol file.
  if (lowerFiles.some((f) => f.endsWith(".sol"))) {
    matched.add("evm");
  }

  // ── Move: any *.move file OR Move.toml present.
  if (
    lowerFiles.some((f) => f.endsWith(".move")) ||
    lowerFiles.some((f) => f.endsWith("move.toml"))
  ) {
    matched.add("move");
  }

  // ── IaC: *.tf / *.tfvars OR k8s/kubernetes/deploy YAML.
  if (
    lowerFiles.some((f) => f.endsWith(".tf") || f.endsWith(".tfvars")) ||
    lowerFiles.some(
      (f) =>
        (f.endsWith(".yaml") || f.endsWith(".yml")) &&
        (f.includes("k8s") || f.includes("kubernetes") || f.includes("deploy"))
    )
  ) {
    matched.add("iac");
  }

  // ── CI: any path under .github/workflows/ OR a Dockerfile (any case).
  if (
    lowerFiles.some((f) => f.includes(".github/workflows/")) ||
    lowerFiles.some((f) => {
      const basename = f.split("/").at(-1) ?? f;
      return basename === "dockerfile" || basename.startsWith("dockerfile.");
    })
  ) {
    matched.add("ci");
  }

  // ── Mobile: *.swift / *.kt / *.kts / AndroidManifest.xml / *.plist.
  if (
    lowerFiles.some(
      (f) =>
        f.endsWith(".swift") ||
        f.endsWith(".kt") ||
        f.endsWith(".kts") ||
        f.endsWith("androidmanifest.xml") ||
        f.endsWith(".plist")
    )
  ) {
    matched.add("mobile");
  }

  // ── Kubernetes: *.yaml/*.yml under a k8s/kubernetes/manifests path, or whose
  //   basename names a workload kind (deployment/statefulset/daemonset/pod).
  if (
    lowerFiles.some((f) => {
      if (!f.endsWith(".yaml") && !f.endsWith(".yml")) return false;
      const basename = f.split("/").at(-1) ?? f;
      return (
        f.includes("k8s") ||
        f.includes("kubernetes") ||
        f.includes("manifests") ||
        /^(deployment|statefulset|daemonset|pod|cronjob|job)\b/.test(basename)
      );
    })
  ) {
    matched.add("k8s");
  }

  // ── Accessibility: any web UI component file (jsx/tsx/vue/svelte/html).
  if (
    lowerFiles.some(
      (f) =>
        f.endsWith(".jsx") ||
        f.endsWith(".tsx") ||
        f.endsWith(".vue") ||
        f.endsWith(".svelte") ||
        f.endsWith(".html")
    )
  ) {
    matched.add("accessibility");
  }

  // ── Embedded: C/C++ firmware sources and headers.
  if (
    lowerFiles.some(
      (f) =>
        f.endsWith(".c") ||
        f.endsWith(".h") ||
        f.endsWith(".cpp") ||
        f.endsWith(".cc") ||
        f.endsWith(".cxx") ||
        f.endsWith(".hpp")
    )
  ) {
    matched.add("embedded");
  }

  // ── Data & SQL: *.sql files OR dbt/Airflow project markers.
  if (
    lowerFiles.some((f) => f.endsWith(".sql")) ||
    lowerFiles.some(
      (f) =>
        f.endsWith("dbt_project.yml") ||
        f.includes("/dags/") ||
        f.includes("airflow")
    )
  ) {
    matched.add("data-sql");
  }

  // ── Dependency-based signals (package names, case-insensitive).
  if (dependencies.length > 0) {
    const lowerDeps = dependencies.map((d) => d.toLowerCase());

    const llmPattern = /openai|@anthropic-ai\/sdk|^ai$|langchain|llamaindex/;
    if (lowerDeps.some((d) => llmPattern.test(d))) {
      matched.add("llm");
    }

    const webPattern = /^express$|^fastify$|^koa$|^next$|^@nestjs|^flask$|^django$|^fastapi$/;
    if (lowerDeps.some((d) => webPattern.test(d))) {
      matched.add("web");
    }

    const fintechPattern = /^stripe$|^braintree$|^@stripe|^plaid$|^square$/;
    if (lowerDeps.some((d) => fintechPattern.test(d))) {
      matched.add("fintech");
    }

    const healthcarePattern = /^fhir$|^hl7$|^@medplum|^cerner$|^epic$/;
    if (lowerDeps.some((d) => healthcarePattern.test(d))) {
      matched.add("healthcare");
    }

    const graphqlPattern = /^graphql$|^apollo-server|^@apollo\/server|^type-graphql$|^@nestjs\/graphql|^graphql-yoga$|^mercurius$/;
    if (lowerDeps.some((d) => graphqlPattern.test(d))) {
      matched.add("graphql");
    }

    const mlopsPattern = /^torch$|^tensorflow$|^scikit-learn$|^transformers$|^datasets$|^mlflow$|^joblib$|^xgboost$/;
    if (lowerDeps.some((d) => mlopsPattern.test(d))) {
      matched.add("mlops");
    }
  }

  // Return matched ids in stable PACK_IDS order.
  return PACK_IDS.filter((id) => matched.has(id));
}
