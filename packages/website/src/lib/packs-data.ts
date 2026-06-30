export interface PackClass {
  title: string;
  standard: string;
  reference: string;
}

export interface PackInfo {
  id: string;
  label: string;
  tagline: string;
  councils: string[];
  classes: PackClass[];
}

export const PACKS_DATA: PackInfo[] = [
  {
    id: "solana",
    label: "Solana / Anchor",
    tagline: "Sealevel-aware council for on-chain programs and client-side transaction safety.",
    councils: ["solana-security", "anchor-accounts", "transaction-safety", "token-safety", "maintainer"],
    classes: [
      { title: "Unchecked account type", standard: "sealevel-attacks", reference: "sealevel: account-types" },
      { title: "Raw CPI invocation", standard: "sealevel-attacks", reference: "sealevel: arbitrary-cpi" },
      { title: "Unchecked remaining_accounts used in CPI", standard: "sealevel-attacks", reference: "sealevel: remaining-accounts" },
      { title: "CPI program account not pinned", standard: "sealevel-attacks", reference: "sealevel: arbitrary-cpi" },
      { title: "Preflight checks disabled", standard: "sealevel-attacks", reference: "sealevel: preflight-checks" },
      { title: "Transaction sent without confirmation", standard: "Solana transaction confirmation", reference: "confirmation: confirm-with-blockhash-and-lastValidBlockHeight" },
      { title: "Blockhash expiry not tracked", standard: "Solana transaction confirmation", reference: "confirmation: blockhash-expiry" },
      { title: "Confirmation missing blockhash expiry guard", standard: "Solana transaction confirmation", reference: "confirmation: blockhash-expiry" },
      { title: "Deprecated blockhash freshness API", standard: "Solana transaction confirmation", reference: "confirmation: latest-blockhash" },
      { title: "Panic in on-chain code", standard: "sealevel-attacks", reference: "sealevel: panic-denial-of-service" },
      { title: "Non-canonical PDA bump", standard: "sealevel-attacks", reference: "sealevel: bump-seed-canonicalization" },
      { title: "Manual account closing", standard: "sealevel-attacks", reference: "sealevel: closing-accounts" },
      { title: "Unvalidated token account", standard: "sealevel-attacks", reference: "sealevel: account-data-matching" },
      { title: "Token-2022 extension constraints missing", standard: "Anchor token constraints", reference: "anchor: token-extensions" },
      { title: "Token-2022 extensions not validated", standard: "Token-2022 extensions", reference: "token-2022: extension-policy" },
      { title: "Unchecked arithmetic on funds", standard: "sealevel-attacks", reference: "sealevel: integer-overflow" },
      { title: "Authority invariant changed", standard: "sealevel-attacks", reference: "sealevel: signer-authorization" },
      { title: "Hardcoded keypair material", standard: "sealevel-attacks", reference: "sealevel: signer-authorization" },
      { title: "Anchor account constraint removed", standard: "sealevel-attacks", reference: "sealevel: owner-checks" },
      { title: "Anchor account constraint weakened", standard: "sealevel-attacks", reference: "sealevel: constraint-validation" },
      { title: "Solana invariant check removed", standard: "sealevel-attacks", reference: "sealevel: invariant-checks" }
    ]
  },
  {
    id: "evm",
    label: "EVM / Solidity",
    tagline: "SWC-grounded council for Solidity smart contracts and EVM-layer vulnerabilities.",
    councils: ["evm-security", "access-control", "reentrancy", "external-calls", "upgrade-safety", "maintainer"],
    classes: [
      { title: "tx.origin used for authorization", standard: "SWC", reference: "SWC-115 tx.origin" },
      { title: "delegatecall to untrusted target", standard: "SWC", reference: "SWC-112 delegatecall" },
      { title: "selfdestruct present", standard: "SWC", reference: "SWC-106 selfdestruct" },
      { title: "Inline assembly", standard: "SWC", reference: "SWC-127 arbitrary-jump / unsafe-assembly" },
      { title: "block.timestamp/number dependence", standard: "SWC", reference: "SWC-116 timestamp-dependence" },
      { title: "Unbounded loop over dynamic array", standard: "SWC", reference: "SWC-128 dos-unbounded-loop" },
      { title: "Floating pragma", standard: "SWC", reference: "SWC-103 floating-pragma" },
      { title: "Ether send via low-level call", standard: "SWC", reference: "SWC-105 unprotected-ether-withdrawal" },
      { title: "Unchecked low-level call return", standard: "SWC", reference: "SWC-104 unchecked-call-return" },
      { title: "Unchecked ERC20 transfer return", standard: "SWC", reference: "SWC-104 unchecked-erc20-return" }
    ]
  },
  {
    id: "move",
    label: "Move (Sui / Aptos)",
    tagline: "Resource-safety and capability-aware council for Move smart contracts.",
    councils: ["move-security", "capability-safety", "resource-safety", "access-control", "maintainer"],
    classes: [
      { title: "Public entry function", standard: "Move", reference: "access-control: public-entry-exposure" },
      { title: "Global storage mutated without owner check", standard: "Move", reference: "access-control: borrow-global-mut-unchecked" },
      { title: "Resource removed from storage", standard: "Move", reference: "resource-safety: move-from-unchecked" },
      { title: "Object shared publicly", standard: "Move", reference: "access-control: shared-object-exposure" },
      { title: "Struct has copy ability", standard: "Move", reference: "resource-safety: copy-ability-on-valuable-struct" },
      { title: "Integer downcast (truncation)", standard: "Move", reference: "resource-safety: integer-truncation" },
      { title: "Unguarded privileged function", standard: "Move", reference: "capability-safety: unguarded-privileged-function" },
      { title: "Unchecked vector index", standard: "Move", reference: "resource-safety: unchecked-vector-index" },
      { title: "Key resource has drop ability", standard: "Move", reference: "resource-safety: drop-ability-on-key-resource" },
      { title: "Initializer/admin entrypoint", standard: "Move", reference: "access-control: initializer-admin-entrypoint" }
    ]
  },
  {
    id: "web3-dd",
    label: "Web3 DD / Webacy",
    tagline: "DD.xyz/Webacy-backed due diligence for addresses, URLs, approvals, raw transactions, and signing changes.",
    councils: ["web3-due-diligence", "wallet-safety", "transaction-safety", "phishing-safety", "maintainer"],
    classes: [
      { title: "Webacy high-risk address introduced", standard: "DD.xyz / Webacy", reference: "address risk, sanctions, fund-flow screening" },
      { title: "Webacy high-risk URL introduced", standard: "DD.xyz / Webacy", reference: "URL phishing and malware detection" },
      { title: "Webacy medium-risk indicator introduced", standard: "DD.xyz / Webacy", reference: "configurable warnOn risk threshold" },
      { title: "Hardcoded Web3 address introduced", standard: "Web3 Review", reference: "chain, owner, token, contract, and program due diligence" },
      { title: "External Web3 URL introduced", standard: "Web3 Review", reference: "claim, metadata, RPC, explorer, and wallet URL review" },
      { title: "High-risk token approval pattern", standard: "Web3 Review", reference: "approve, setApprovalForAll, MaxUint256 allowance checks" },
      { title: "Raw transaction or typed-data signing path changed", standard: "Web3 Review", reference: "raw tx, signTypedData, verifyingContract, chain id review" }
    ]
  },
  {
    id: "iac",
    label: "IaC (Terraform / K8s)",
    tagline: "CIS-benchmark council for Terraform, Kubernetes, and cloud infrastructure configs.",
    councils: ["iac-security", "network-exposure", "secrets-management", "identity-access", "resilience", "maintainer"],
    classes: [
      { title: "Public storage ACL", standard: "CIS", reference: "CIS-AWS S3 public access" },
      { title: "Unrestricted ingress (0.0.0.0/0)", standard: "CIS", reference: "CIS-AWS unrestricted-ingress" },
      { title: "Encryption disabled", standard: "CIS", reference: "CIS-AWS encryption-at-rest" },
      { title: "Public IP assignment", standard: "CIS", reference: "CIS-AWS public-ip-assignment" },
      { title: "Hardcoded secret in IaC", standard: "CIS", reference: "CIS-AWS hardcoded-credentials" },
      { title: "Privileged container", standard: "CIS", reference: "CIS-K8s privileged-container" },
      { title: "Host namespace sharing", standard: "CIS", reference: "CIS-K8s host-namespace-sharing" },
      { title: "Container runs as root", standard: "CIS", reference: "CIS-K8s run-as-non-root" },
      { title: "Privilege escalation allowed", standard: "CIS", reference: "CIS-K8s allow-privilege-escalation" },
      { title: "Mutable image tag (:latest)", standard: "CIS", reference: "CIS-K8s mutable-image-tag" }
    ]
  },
  {
    id: "llm",
    label: "LLM / AI Applications",
    tagline: "OWASP LLM Top-10 council for prompt injection, data privacy, and model governance.",
    councils: ["prompt-injection", "data-privacy", "tool-safety", "output-safety", "model-governance", "maintainer"],
    classes: [
      { title: "Untrusted input interpolated into prompt", standard: "OWASP-LLM", reference: "LLM01 Prompt Injection" },
      { title: "Model output passed to code execution", standard: "OWASP-LLM", reference: "LLM02 Insecure Output Handling" },
      { title: "Model output rendered as unsanitized HTML", standard: "OWASP-LLM", reference: "LLM02 Insecure Output Handling" },
      { title: "Unvalidated tool-call arguments", standard: "OWASP-LLM", reference: "LLM07 Insecure Plugin/Tool Design" },
      { title: "Hardcoded LLM API key", standard: "OWASP-LLM", reference: "LLM06 Sensitive Info Disclosure" },
      { title: "LLM prompt/response logged", standard: "OWASP-LLM", reference: "LLM06 Sensitive Info Disclosure" },
      { title: "Model safety/moderation disabled", standard: "OWASP-LLM", reference: "LLM08 Excessive Agency" },
      { title: "Secret or PII included in prompt", standard: "OWASP-LLM", reference: "LLM06 Sensitive Info Disclosure" },
      { title: "Authorization decision based on model output", standard: "OWASP-LLM", reference: "LLM08 Excessive Agency" },
      { title: "Untrusted external content fed into prompt", standard: "OWASP-LLM", reference: "LLM01 Prompt Injection" }
    ]
  },
  {
    id: "ci",
    label: "CI/CD & Supply Chain",
    tagline: "OpenSSF Scorecard council for GitHub Actions workflows and supply-chain integrity.",
    councils: ["workflow-security", "dependency-integrity", "secrets-exposure", "build-provenance", "maintainer"],
    classes: [
      { title: "pull_request_target trigger", standard: "OpenSSF", reference: "Scorecard: Dangerous-Workflow" },
      { title: "Untrusted input in workflow expression", standard: "OpenSSF", reference: "CWE-78 command-injection via expression" },
      { title: "Action not pinned to a commit SHA", standard: "OpenSSF", reference: "Scorecard: Pinned-Dependencies" },
      { title: "Over-broad workflow permissions", standard: "OpenSSF", reference: "Scorecard: Token-Permissions" },
      { title: "Self-hosted runner", standard: "OpenSSF", reference: "Scorecard: Dangerous-Workflow" },
      { title: "Checks out untrusted PR head", standard: "OpenSSF", reference: "Scorecard: Dangerous-Workflow" },
      { title: "Install script added", standard: "OpenSSF", reference: "CWE-78 supply-chain-install-script" },
      { title: "Hardcoded registry/auth token", standard: "OpenSSF", reference: "CWE-798 hardcoded-credential" },
      { title: "Pipe-to-shell of a remote script", standard: "OpenSSF", reference: "CWE-494 download-of-code-without-integrity-check" },
      { title: "Unpinned base image or remote ADD", standard: "OpenSSF", reference: "Scorecard: Pinned-Dependencies" }
    ]
  },
  {
    id: "fintech",
    label: "Fintech / Payments",
    tagline: "PCI-DSS council for payment processing, card data handling, and financial precision.",
    councils: ["payment-security", "pci-compliance", "data-protection", "transaction-integrity", "maintainer"],
    classes: [
      { title: "Monetary value stored as float", standard: "PCI-DSS", reference: "PCI 3.4 PAN-protection" },
      { title: "Card data in logs", standard: "PCI-DSS", reference: "PCI 3.2 no-CVV-storage" },
      { title: "Card number literal in source", standard: "PCI-DSS", reference: "PCI 3.4 PAN-protection" },
      { title: "CVV stored/persisted", standard: "PCI-DSS", reference: "PCI 3.2 no-CVV-storage" },
      { title: "Webhook signature verification disabled", standard: "PCI-DSS", reference: "PCI 6.4 secure-software-practices" },
      { title: "Floating-point arithmetic on money", standard: "PCI-DSS", reference: "PCI 6.4 secure-coding-monetary-precision" },
      { title: "Financial PII in plaintext", standard: "PCI-DSS", reference: "PCI 3.4 PAN-protection" },
      { title: "TLS certificate verification disabled", standard: "PCI-DSS", reference: "PCI 4 TLS" },
      { title: "Float rounding used for currency", standard: "PCI-DSS", reference: "PCI 6.4 secure-coding-monetary-precision" },
      { title: "SQL built by string concatenation", standard: "PCI-DSS", reference: "PCI 6.3 injection-prevention" }
    ]
  },
  {
    id: "web",
    label: "Web & API",
    tagline: "OWASP Top-10 council for web backends, REST APIs, and server-side injection risks.",
    councils: ["injection", "broken-access-control", "ssrf", "auth-session", "data-exposure", "maintainer"],
    classes: [
      { title: "SSRF — user input in a server-side request", standard: "OWASP", reference: "A10 SSRF" },
      { title: "Command injection (untrusted input in a shell command)", standard: "OWASP", reference: "A03 Injection" },
      { title: "Path traversal (untrusted input in a file path)", standard: "OWASP", reference: "A01 Broken Access Control" },
      { title: "Reflected XSS (unescaped input echoed to the response)", standard: "OWASP", reference: "A03 Injection" },
      { title: "Open redirect (user-controlled redirect target)", standard: "OWASP", reference: "A01 Broken Access Control" },
      { title: "Mass assignment (request body bound directly to a model)", standard: "OWASP", reference: "A01 Broken Access Control" },
      { title: "Permissive CORS (wildcard / reflected origin)", standard: "OWASP", reference: "A05 Security Misconfiguration" },
      { title: "CSRF protection disabled", standard: "OWASP", reference: "A01 Broken Access Control" },
      { title: "Insecure deserialization of untrusted data", standard: "OWASP", reference: "A08 Insecure Deserialization" },
      { title: "Weak or broken cryptographic algorithm", standard: "OWASP", reference: "A02 Cryptographic Failures" }
    ]
  },
  {
    id: "healthcare",
    label: "Healthcare / HIPAA",
    tagline: "HIPAA-aligned council for PHI protection, access audit, and clinical data encryption.",
    councils: ["phi-protection", "access-audit", "data-encryption", "clinical-safety", "maintainer"],
    classes: [
      { title: "PHI written to logs", standard: "HIPAA", reference: "164.312(b) audit" },
      { title: "PHI stored in plaintext literal", standard: "HIPAA", reference: "164.312(a) access-control" },
      { title: "PHI in URL/query string", standard: "HIPAA", reference: "164.312(e) transmission-security" },
      { title: "PHI sent to an external service", standard: "HIPAA", reference: "164.312(e) transmission-security" },
      { title: "PHI exposed in API response", standard: "HIPAA", reference: "164.514 de-identification" },
      { title: "PHI sent to analytics/telemetry", standard: "HIPAA", reference: "164.514 de-identification" },
      { title: "Patient record fetched by user-supplied id (verify authorization)", standard: "HIPAA", reference: "164.312(a) access-control" },
      { title: "Hardcoded clinical-system credential", standard: "HIPAA", reference: "164.312(a) access-control" },
      { title: "Over-broad PHI query (minimum-necessary)", standard: "HIPAA", reference: "164.502(b) minimum-necessary" },
      { title: "Weak/disabled encryption for PHI", standard: "HIPAA", reference: "164.312(e) transmission-security" }
    ]
  },
  {
    id: "mobile",
    label: "Mobile (iOS / Android)",
    tagline: "MASVS council for insecure storage, platform config, network security, and crypto hygiene.",
    councils: ["insecure-storage", "platform-config", "network-security", "crypto-secrets", "maintainer"],
    classes: [
      { title: "Secret stored in insecure local storage", standard: "MASVS", reference: "MASVS-STORAGE" },
      { title: "Hardcoded secret in mobile source", standard: "MASVS", reference: "MASVS-STORAGE" },
      { title: "Cleartext HTTP / ATS exception", standard: "MASVS", reference: "MASVS-NETWORK" },
      { title: "Exported Android component", standard: "MASVS", reference: "MASVS-PLATFORM" },
      { title: "WebView JavaScript bridge enabled", standard: "MASVS", reference: "MASVS-PLATFORM" },
      { title: "TLS certificate validation disabled", standard: "MASVS", reference: "MASVS-NETWORK" },
      { title: "Sensitive data written to device logs", standard: "MASVS", reference: "MASVS-STORAGE" },
      { title: "Debuggable build flag enabled", standard: "MASVS", reference: "MASVS-RESILIENCE" },
      { title: "Insecure randomness for a security value", standard: "MASVS", reference: "MASVS-CRYPTO" },
      { title: "Weak Keychain accessibility", standard: "MASVS", reference: "MASVS-STORAGE" }
    ]
  },
  {
    id: "accessibility",
    label: "Accessibility (WCAG)",
    tagline: "Catch missing alt text, unlabelled inputs, keyboard traps, and broken ARIA before they reach users.",
    councils: ["semantic-structure", "aria-correctness", "keyboard-interaction", "perceivable-media", "maintainer"],
    classes: [
      { title: "Image missing alt attribute", standard: "WCAG 2.2", reference: "WCAG 1.1.1 Non-text Content" },
      { title: "Form input relies on placeholder instead of a label", standard: "WCAG 2.2", reference: "WCAG 1.3.1 Info and Relationships / 4.1.2 Name, Role, Value" },
      { title: "Click handler on non-interactive element without role or keyboard handler", standard: "WCAG 2.2", reference: "WCAG 2.1.1 Keyboard" },
      { title: "Anchor with empty or placeholder href used as a button", standard: "WCAG 2.2", reference: "WCAG 4.1.2 Name, Role, Value / 2.1.1 Keyboard" },
      { title: "Root <html> element missing lang attribute", standard: "WCAG 2.2", reference: "WCAG 3.1.1 Language of Page" },
      { title: "Positive tabindex value disrupts focus order", standard: "WCAG 2.2", reference: "WCAG 2.4.3 Focus Order" },
      { title: "Icon-only button without an accessible name", standard: "WCAG 2.2", reference: "WCAG 4.1.2 Name, Role, Value" },
      { title: "Misspelled or invalid aria-* attribute", standard: "WCAG 2.2", reference: "WCAG 4.1.2 Name, Role, Value" },
      { title: "Autoplaying media that is not muted", standard: "WCAG 2.2", reference: "WCAG 1.4.2 Audio Control" },
      { title: "Heading level skipped (h1 directly to h3)", standard: "WCAG 2.2", reference: "WCAG 1.3.1 Info and Relationships" }
    ]
  },
  {
    id: "data-sql",
    label: "Data & SQL",
    tagline: "Catches unsafe SQL, unbounded warehouse scans, destructive statements, and data-correctness hazards in pipeline code.",
    councils: ["query-safety-reviewer", "warehouse-cost-reviewer", "data-correctness-reviewer", "pii-governance-reviewer", "maintainer"],
    classes: [
      { title: "SQL query built by string concatenation or f-string interpolation", standard: "Data Engineering", reference: "OWASP A03:2021 Injection / parameterized query practice" },
      { title: "SELECT * used in a production query", standard: "Data Engineering", reference: "Warehouse query optimization — explicit projection" },
      { title: "UPDATE or DELETE statement missing a WHERE clause", standard: "Data Engineering", reference: "Destructive DML safety — mandatory WHERE predicate" },
      { title: "Unbounded query missing a LIMIT clause", standard: "Data Engineering", reference: "Warehouse cost control — bounded result sets" },
      { title: "DROP or TRUNCATE TABLE without an existence or environment guard", standard: "Data Engineering", reference: "DDL safety — guarded destructive operations" },
      { title: "Hardcoded database connection string or DSN", standard: "Data Engineering", reference: "Secret management — no credentials in source" },
      { title: "PII column selected into logs or printed output", standard: "Data Engineering", reference: "Data governance — PII minimization in observability" },
      { title: "Cartesian or cross join that explodes row counts", standard: "Data Engineering", reference: "Join correctness — avoid unintended cartesian products" },
      { title: "Multiple dependent writes executed without a transaction", standard: "Data Engineering", reference: "Atomicity — group dependent writes in a transaction" },
      { title: "FLOAT or REAL used for a monetary column", standard: "Data Engineering", reference: "Schema correctness — exact decimal for money" }
    ]
  },
  {
    id: "k8s",
    label: "Kubernetes",
    tagline: "Hardens Kubernetes workload manifests against privilege, isolation, RBAC, and resource-exhaustion risks per the CIS Kubernetes Benchmark.",
    councils: ["pod-security-context-reviewer", "host-isolation-reviewer", "rbac-scope-reviewer", "resource-governance-reviewer", "maintainer"],
    classes: [
      { title: "Privileged container in securityContext", standard: "CIS Kubernetes", reference: "CIS Kubernetes 5.2.5 Minimize the admission of privileged containers" },
      { title: "Container allowed to run as root", standard: "CIS Kubernetes", reference: "CIS Kubernetes 5.2.6 Minimize the admission of root containers" },
      { title: "Container runs as UID 0 (root)", standard: "CIS Kubernetes", reference: "CIS Kubernetes 5.2.6 Minimize the admission of root containers" },
      { title: "Pod container allows privilege escalation", standard: "CIS Kubernetes", reference: "CIS Kubernetes 5.2.5 Minimize the admission of containers with allowPrivilegeEscalation" },
      { title: "Host namespace sharing enabled", standard: "CIS Kubernetes", reference: "CIS Kubernetes 5.2.2-5.2.4 Minimize admission of pods sharing host PID, IPC, or network namespaces" },
      { title: "Dangerous Linux capability added", standard: "CIS Kubernetes", reference: "CIS Kubernetes 5.2.8-5.2.9 Minimize admission of containers with added capabilities" },
      { title: "Container missing resource limits", standard: "CIS Kubernetes", reference: "CIS Kubernetes 5.7.x / Pod Security — Memory and CPU limits" },
      { title: "Mutable :latest image tag", standard: "CIS Kubernetes", reference: "CIS Kubernetes 5.5.1 / Supply chain — pin image tags by digest" },
      { title: "Service account token automounted", standard: "CIS Kubernetes", reference: "CIS Kubernetes 5.1.6 Ensure that Service Account Tokens are only mounted where necessary" },
      { title: "RBAC rule grants wildcard access", standard: "CIS Kubernetes", reference: "CIS Kubernetes 5.1.3 Minimize wildcard use in Roles and ClusterRoles" }
    ]
  },
  {
    id: "privacy",
    label: "Privacy (GDPR)",
    tagline: "Reviews the personal-data lifecycle — consent, retention, erasure, and cross-border transfer — against GDPR and CCPA.",
    councils: ["consent-lawful-basis", "data-minimization", "retention-erasure", "transfer-sharing", "maintainer"],
    classes: [
      { title: "PII written to logs", standard: "GDPR", reference: "GDPR Art. 5(1)(c) Data Minimisation; Art. 32 Security of Processing" },
      { title: "Analytics fired before consent", standard: "GDPR", reference: "GDPR Art. 6(1)(a) & Recital 32; ePrivacy Directive Art. 5(3)" },
      { title: "PII stored without retention/TTL", standard: "GDPR", reference: "GDPR Art. 5(1)(e) Storage Limitation" },
      { title: "PII in URL/query string", standard: "GDPR", reference: "GDPR Art. 5(1)(f) Integrity & Confidentiality; Art. 32" },
      { title: "PII shared with third party without contract flag", standard: "GDPR", reference: "GDPR Art. 28 Processor; Art. 44 Transfers; CCPA §1798.140(ah) Sharing" },
      { title: "Soft-delete used instead of right-to-erasure", standard: "GDPR", reference: "GDPR Art. 17 Right to Erasure; CCPA §1798.105 Right to Delete" },
      { title: "Cookie set without consent gating", standard: "GDPR", reference: "ePrivacy Directive Art. 5(3); GDPR Recital 32" },
      { title: "Precise geolocation captured without notice", standard: "GDPR", reference: "GDPR Art. 9 / Recital 51; Art. 13 Information to be Provided" },
      { title: "Full PII table dumped", standard: "GDPR", reference: "GDPR Art. 5(1)(c) Data Minimisation; Art. 25 Data Protection by Design" },
      { title: "PII sent to analytics/ML without anonymisation", standard: "GDPR", reference: "GDPR Art. 5(1)(b) Purpose Limitation; Art. 25 & Recital 28 Pseudonymisation" }
    ]
  },
  {
    id: "mlops",
    label: "ML / MLOps",
    tagline: "Guards ML pipelines against untrusted artifacts, data leakage, and non-reproducible training.",
    councils: ["artifact-provenance", "data-leakage", "reproducibility", "pipeline-security", "maintainer"],
    classes: [
      { title: "Untrusted model artifact deserialized via pickle/torch/joblib load", standard: "ML Supply Chain", reference: "MITRE ATLAS AML.T0010 ML Supply Chain Compromise" },
      { title: "torch.load called without weights_only=True", standard: "ML Supply Chain", reference: "PyTorch Security: torch.load weights_only" },
      { title: "No random seed set — training is non-reproducible", standard: "ML Supply Chain", reference: "ML Reproducibility: deterministic seeding" },
      { title: "Data leakage — scaler/transform fit before train-test split", standard: "ML Supply Chain", reference: "ML Evaluation Integrity: fit transforms on training data only" },
      { title: "Hardcoded dataset/registry/storage credentials", standard: "ML Supply Chain", reference: "ML Supply Chain: secret management for data and registries" },
      { title: "Unsafe yaml.load for experiment/pipeline config", standard: "ML Supply Chain", reference: "CWE-502 Deserialization of Untrusted Data" },
      { title: "Unpinned model/dataset download from hub", standard: "ML Supply Chain", reference: "MITRE ATLAS AML.T0010: pin artifacts by revision" },
      { title: "Model trained on full dataset with no train/test split", standard: "ML Supply Chain", reference: "ML Evaluation Integrity: hold-out evaluation" },
      { title: "eval/exec on experiment config or hyperparameters", standard: "ML Supply Chain", reference: "CWE-95 Eval Injection" },
      { title: "Target/identifier leakage column kept in training features", standard: "ML Supply Chain", reference: "ML Evaluation Integrity: exclude leakage features" }
    ]
  },
  {
    id: "embedded",
    label: "Embedded (MISRA)",
    tagline: "Catches firmware memory-safety, MISRA-discipline, and real-time hazards in C/C++ before they reach the device.",
    councils: ["memory-safety", "misra-conformance", "concurrency-isr", "realtime-timing", "maintainer"],
    classes: [
      { title: "Unbounded string operation (strcpy/strcat/sprintf/gets)", standard: "MISRA C 2012", reference: "MISRA C:2012 Rule 21.17 / Dir 4.1 — use of unbounded string functions" },
      { title: "Allocation result used without NULL check", standard: "MISRA C 2012", reference: "MISRA C:2012 Dir 4.12 / Rule 22.1 — dynamic memory and resource validation" },
      { title: "memcpy/memmove with an unchecked length", standard: "MISRA C 2012", reference: "MISRA C:2012 Rule 18.1 / Dir 4.1 — pointer arithmetic and array bounds" },
      { title: "Magic buffer-size literal in array declaration", standard: "MISRA C 2012", reference: "MISRA C:2012 Dir 4.6 / Rule 7.x — avoid unnamed numeric constants" },
      { title: "Hardware-register/ISR-shared variable missing volatile", standard: "MISRA C 2012", reference: "MISRA C:2012 Rule 8.6 / Dir 4.x — volatile-qualified access to memory-mapped and shared objects" },
      { title: "Signed/unsigned comparison mismatch in loop bound", standard: "MISRA C 2012", reference: "MISRA C:2012 Rule 10.4 / 14.4 — operands of compatible essential type" },
      { title: "Use of goto", standard: "MISRA C 2012", reference: "MISRA C:2012 Rule 15.1 — the goto statement should not be used" },
      { title: "Dynamic allocation via new on a real-time/ISR path", standard: "MISRA C++ 2008", reference: "MISRA C++:2008 Rule 18-4-1 — dynamic heap memory allocation shall not be used" },
      { title: "Ignored return value of a system/library call", standard: "MISRA C 2012", reference: "MISRA C:2012 Dir 4.7 / Rule 17.7 — value returned by a function shall be used" },
      { title: "Floating-point equality comparison", standard: "MISRA C 2012", reference: "MISRA C:2012 Dir 1.1 / Rule 14.x — floating-point values shall not be tested for exact equality" }
    ]
  },
  {
    id: "performance",
    label: "Performance & SRE",
    tagline: "Latency-, resource- and reliability-aware council for hot paths, request handlers and data access.",
    councils: ["latency-io", "data-access-scaling", "resource-lifecycle", "reliability-timeouts", "maintainer"],
    classes: [
      { title: "await inside a loop (serialized I/O)", standard: "Performance & SRE", reference: "Latency: serialized-io-in-loop" },
      { title: "Database query inside a loop (N+1)", standard: "Performance & SRE", reference: "Scalability: n-plus-one-query" },
      { title: "List endpoint missing pagination/LIMIT", standard: "Performance & SRE", reference: "Scalability: unbounded-result-set" },
      { title: "Synchronous fs call in a request path", standard: "Performance & SRE", reference: "Latency: blocking-event-loop" },
      { title: "Outbound fetch/axios without a timeout", standard: "Performance & SRE", reference: "Reliability: missing-network-timeout" },
      { title: "New DB connection per request (no pool)", standard: "Performance & SRE", reference: "Resource-efficiency: connection-per-request" },
      { title: "Unbounded in-memory accumulator growth", standard: "Performance & SRE", reference: "Resource-efficiency: unbounded-memory-growth" },
      { title: "JSON.parse of an unbounded request body", standard: "Performance & SRE", reference: "Reliability: unbounded-body-parse" },
      { title: "O(n^2) nested includes/indexOf scan", standard: "Performance & SRE", reference: "Scalability: quadratic-scan" },
      { title: "setInterval without cleanup handle (leak)", standard: "Performance & SRE", reference: "Resource-efficiency: timer-leak" }
    ]
  },
  {
    id: "graphql",
    label: "GraphQL API",
    tagline: "Catches GraphQL-specific schema, resolver, and query-execution risks before they reach production.",
    councils: ["query-execution", "resolver-authorization", "schema-design", "data-access", "maintainer"],
    classes: [
      { title: "GraphQL introspection enabled in production", standard: "GraphQL Security", reference: "OWASP API8:2023 Security Misconfiguration — GraphQL introspection disclosure" },
      { title: "Missing query depth/complexity limit", standard: "GraphQL Security", reference: "OWASP GraphQL Cheat Sheet — Query depth & cost analysis limiting" },
      { title: "List resolver causes N+1 queries (no DataLoader)", standard: "GraphQL Security", reference: "GraphQL Best Practices — Server-side batching with DataLoader" },
      { title: "Privileged resolver missing object/field-level authorization", standard: "GraphQL Security", reference: "OWASP API1:2023 Broken Object Level Authorization — GraphQL resolvers" },
      { title: "Query batching amplification enabled", standard: "GraphQL Security", reference: "OWASP GraphQL Cheat Sheet — Batching attacks & request amplification" },
      { title: "Raw database query built from GraphQL args", standard: "GraphQL Security", reference: "OWASP GraphQL Cheat Sheet — Injection via resolver argument interpolation" },
      { title: "Verbose GraphQL error leaks internals", standard: "GraphQL Security", reference: "OWASP GraphQL Cheat Sheet — Error handling & information disclosure" },
      { title: "Mutation type without rate-limit directive", standard: "GraphQL Security", reference: "OWASP API4:2023 Unrestricted Resource Consumption — GraphQL mutations" },
      { title: "Unbounded list pagination argument", standard: "GraphQL Security", reference: "OWASP GraphQL Cheat Sheet — Pagination limits on list fields" },
      { title: "@skip/@include used to bypass auth-protected field", standard: "GraphQL Security", reference: "GraphQL Spec §3.13 Directives — auth-bypass via @skip/@include conditions" }
    ]
  }
];
