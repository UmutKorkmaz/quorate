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
      { title: "Preflight checks disabled", standard: "sealevel-attacks", reference: "sealevel: preflight-checks" },
      { title: "Panic in on-chain code", standard: "sealevel-attacks", reference: "sealevel: panic-denial-of-service" },
      { title: "Non-canonical PDA bump", standard: "sealevel-attacks", reference: "sealevel: bump-seed-canonicalization" },
      { title: "Manual account closing", standard: "sealevel-attacks", reference: "sealevel: closing-accounts" },
      { title: "Unvalidated token account", standard: "sealevel-attacks", reference: "sealevel: account-data-matching" },
      { title: "Unchecked arithmetic on funds", standard: "sealevel-attacks", reference: "sealevel: integer-overflow" },
      { title: "Hardcoded keypair material", standard: "sealevel-attacks", reference: "sealevel: signer-authorization" },
      { title: "Anchor account constraint removed", standard: "sealevel-attacks", reference: "sealevel: owner-checks" }
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
  }
];
