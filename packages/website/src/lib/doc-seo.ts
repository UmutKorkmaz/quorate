import type { DocPath } from "../components/DocNav";

export const DOC_DESCRIPTIONS: Record<DocPath, string> = {
  "/docs":
    "Quorate documentation — install, quick start, slash commands, providers, configuration, and GitHub Action.",
  "/docs/install":
    "Install Quorate globally with npm. Requires Node 22+. Verify setup with quorate doctor.",
  "/docs/quickstart":
    "Quick start guide: open the shell, load a diff, enable providers, and run your first council review.",
  "/docs/commands":
    "Every slash command in the Quorate interactive shell — /review, /diff, /git, /pr, /plan, and more.",
  "/docs/providers":
    "Detected AI CLIs (claude, codex, qwen, kimi) and the built-in heuristic reviewer.",
  "/docs/config":
    "Configure councils, providers, headless args, and safety limits in .quorate.yml.",
  "/docs/github-action":
    "Run the Quorate council on every pull request with the GitHub Action.",
  "/docs/faq":
    "Frequently asked questions about Quorate — install, providers, degraded reviews, and the GitHub Action.",
  "/docs/manual-testing":
    "Manual testing checklist for Quorate — website, CLI shell, keyboard shortcuts, sessions, headless commands, and edge cases.",
  "/docs/solana":
    "Quorate Solana pack — Anchor-aware review council and ten deterministic on-chain heuristics for sealevel security.",
  "/docs/evm":
    "Quorate EVM pack — Solidity-aware review council and ten deterministic on-chain heuristics for smart-contract security.",
  "/docs/iac":
    "Quorate IaC pack — Terraform and Kubernetes security council and ten deterministic heuristics for infrastructure misconfiguration review.",
  "/docs/llm":
    "Quorate LLM app pack — AI-application security council and ten deterministic heuristics for prompt injection, data leakage, tool safety, and unsafe output review.",
  "/docs/move":
    "Quorate Move pack — Sui/Aptos-aware security council and ten deterministic heuristics for resource safety, capability misuse, and access-control review.",
  "/docs/ci":
    "Quorate CI pack — workflow-security and supply-chain council and ten deterministic heuristics for script injection, unpinned actions, hardcoded secrets, and pipe-to-shell review.",
  "/docs/fintech":
    "Quorate Fintech pack — payment-security and PCI-compliance council and ten deterministic heuristics for card data in logs, CVV persistence, float money types, webhook signature bypass, and SQL injection on financial tables.",
  "/docs/web":
    "Quorate Web pack — OWASP-aligned web security council and ten deterministic heuristics for SSRF, command injection, path traversal, reflected XSS, open redirect, mass assignment, permissive CORS, CSRF, insecure deserialization, and weak cryptographic algorithms.",
  "/docs/healthcare":
    "Quorate Healthcare pack — PHI-protection and HIPAA Security Rule-aligned council and ten deterministic heuristics for PHI in logs, plaintext PHI literals, PHI in URLs, external PHI transmission, API over-exposure, analytics leakage, insecure direct object references on patient records, hardcoded clinical-system credentials, over-broad PHI queries, and weak or disabled encryption for PHI.",
  "/docs/mobile":
    "Quorate Mobile pack — MASVS-aligned iOS/Android security council and ten deterministic heuristics for insecure local storage, hardcoded secrets in mobile source, cleartext HTTP and ATS exceptions, exported Android components, WebView JavaScript bridge exposure, disabled TLS certificate validation, sensitive data in device logs, debuggable release builds, insecure randomness for security values, and weak Keychain accessibility.",
  "/docs/accessibility":
    "Quorate Accessibility pack — WCAG 2.2 AA review council and ten deterministic heuristics for missing alt text, unlabelled form inputs, non-interactive click handlers, placeholder href buttons, missing lang, positive tabindex, icon-only buttons without a name, invalid ARIA, unmuted autoplay, and skipped heading levels.",
  "/docs/data-sql":
    "Quorate Data & SQL pack — data-engineering review council and ten deterministic heuristics for SQL string interpolation, SELECT *, missing WHERE on UPDATE/DELETE, unbounded queries, unguarded DROP/TRUNCATE, hardcoded DSNs, PII in logs, cross joins, missing transactions, and float money columns.",
  "/docs/k8s":
    "Quorate Kubernetes pack — CIS Kubernetes Benchmark review council and ten deterministic heuristics for privileged containers, runAsNonRoot:false, UID 0, privilege escalation, host namespace sharing, dangerous capabilities, empty resource limits, mutable :latest tags, automounted service-account tokens, and wildcard RBAC.",
  "/docs/privacy":
    "Quorate Privacy pack — GDPR/CCPA data-protection review council and ten deterministic heuristics for PII in logs, analytics before consent, missing retention TTLs, PII in URLs, third-party sharing, soft-delete vs erasure, cookies without consent, precise geolocation, full PII dumps, and PII to analytics/ML.",
  "/docs/mlops":
    "Quorate ML / MLOps pack — ML supply-chain and model-lifecycle review council and ten deterministic heuristics for pickle/torch.load deserialization, missing random seeds, train/test leakage, hardcoded model-registry credentials, unsafe yaml.load, unpinned hub downloads, full-dataset training, eval/exec on config, and target leakage.",
  "/docs/embedded":
    "Quorate Embedded pack — MISRA C/C++ firmware-safety review council and ten deterministic heuristics for unbounded string ops, unchecked malloc, unchecked memcpy length, magic buffer sizes, missing volatile on hardware registers, signed/unsigned loop bounds, goto, dynamic allocation on ISR paths, ignored return values, and float equality comparisons.",
  "/docs/performance":
    "Quorate Performance & SRE pack — performance, scalability, and reliability review council and ten deterministic heuristics for await-in-loop, N+1 queries, missing pagination, sync fs in request paths, fetch without timeout, per-request DB connections, unbounded accumulators, JSON.parse of unbounded bodies, O(n²) scans, and leaked intervals.",
  "/docs/graphql":
    "Quorate GraphQL pack — GraphQL API security and design review council and ten deterministic heuristics for production introspection, missing depth/complexity limits, resolver N+1, missing field-level authorization, batch amplification, raw queries from GraphQL args, verbose error leakage, unrated mutations, unbounded pagination, and @skip/@include auth bypass."
};