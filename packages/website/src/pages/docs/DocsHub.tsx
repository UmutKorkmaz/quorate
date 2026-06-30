import { Link } from "react-router-dom";

import { InlineCode } from "../../components/InlineCode";

const CARDS = [
  { to: "/docs/install", title: "Install", desc: "Install Quorate globally and launch your first shell session." },
  { to: "/docs/quickstart", title: "Quick start", desc: "Load a diff, enable agents, and run your first council review." },
  { to: "/docs/commands", title: "Slash commands", desc: "Every / command available in the interactive shell." },
  { to: "/docs/providers", title: "Providers", desc: "See detected AI CLIs, readiness states, and the heuristic reviewer." },
  { to: "/docs/config", title: "Configuration", desc: "Tune councils, providers, and safety limits in .quorate.yml." },
  { to: "/docs/github-action", title: "GitHub Action", desc: "Bring the same council verdict to every pull request." },
  { to: "/docs/faq", title: "FAQ", desc: "Answers for setup, safety, provider behavior, and degraded reviews." },
  {
    to: "/docs/manual-testing",
    title: "Manual testing",
    desc: "A release checklist for the website, shell, keyboard flow, sessions, and headless CLI."
  },
  {
    to: "/docs/solana",
    title: "Solana / Anchor",
    desc: "Start here for the front-page Solana app example: release gate, Anchor constraint diffs, CPI/remaining accounts, Token-2022 review, test-plan guidance, and 21 deterministic heuristics."
  },
  {
    to: "/docs/evm",
    title: "EVM / Solidity",
    desc: "Solidity-aware council + ten deterministic on-chain heuristics. Zero-setup smart-contract security review."
  },
  {
    to: "/docs/iac",
    title: "Infrastructure / IaC",
    desc: "Terraform and Kubernetes security council + ten deterministic heuristics. Zero-setup infrastructure misconfiguration review."
  },
  {
    to: "/docs/llm",
    title: "AI / LLM apps",
    desc: "LLM-application security council + ten deterministic heuristics covering prompt injection, data leakage, tool safety, and unsafe output. Zero-setup AI risk review."
  },
  {
    to: "/docs/move",
    title: "Move (Sui / Aptos)",
    desc: "Sui/Aptos-aware Move security council + ten deterministic heuristics covering resource safety, capability misuse, and access-control gaps. Zero-setup Move review."
  },
  {
    to: "/docs/web3-dd",
    title: "Web3 DD / Webacy",
    desc: "DD.xyz/Webacy-backed due diligence for added addresses, URLs, approvals, raw transaction paths, and typed-data signing changes. Pair it with Solana, EVM, or Move."
  },
  {
    to: "/docs/ci",
    title: "CI/CD & Supply Chain",
    desc: "Workflow-security and supply-chain council + ten deterministic heuristics covering script injection, unpinned actions, hardcoded secrets, and pipe-to-shell patterns. Zero-setup CI review."
  },
  {
    to: "/docs/fintech",
    title: "Fintech / PCI",
    desc: "Payment-security council + ten deterministic heuristics covering card data in logs, CVV persistence, float money types, webhook signature bypass, and SQL injection on financial tables. Zero-setup PCI review."
  },
  {
    to: "/docs/web",
    title: "Web & API (OWASP)",
    desc: "OWASP-aligned web security council + ten deterministic heuristics covering SSRF, command injection, path traversal, reflected XSS, open redirect, mass assignment, permissive CORS, CSRF, insecure deserialization, and weak cryptography. Zero-setup OWASP review."
  },
  {
    to: "/docs/healthcare",
    title: "Healthcare / HIPAA",
    desc: "PHI-protection council + ten deterministic heuristics covering PHI in logs, plaintext PHI, PHI in URLs, external transmission, API exposure, analytics leakage, insecure direct object references, hardcoded clinical credentials, over-broad queries, and weak encryption. Zero-setup HIPAA review."
  },
  {
    to: "/docs/mobile",
    title: "Mobile (iOS / Android)",
    desc: "MASVS-aligned mobile security council + ten deterministic heuristics covering insecure local storage, hardcoded secrets, cleartext HTTP, exported Android components, WebView bridge exposure, disabled TLS validation, sensitive data in logs, debuggable builds, insecure randomness, and weak Keychain accessibility. Zero-setup iOS/Android review."
  },
  {
    to: "/docs/graphql",
    title: "GraphQL API",
    desc: "GraphQL API security council + ten deterministic heuristics covering production introspection, missing depth/complexity limits, resolver N+1, field-level authorization, batch amplification, raw queries from args, verbose errors, unrated mutations, unbounded pagination, and @skip/@include auth bypass. Zero-setup GraphQL review."
  },
  {
    to: "/docs/accessibility",
    title: "Accessibility (WCAG)",
    desc: "WCAG 2.2 AA council + ten deterministic heuristics covering missing alt text, unlabelled inputs, non-interactive click handlers, placeholder href buttons, missing lang, positive tabindex, icon-only buttons, invalid ARIA, unmuted autoplay, and skipped heading levels. Zero-setup accessibility review."
  },
  {
    to: "/docs/mlops",
    title: "ML / MLOps",
    desc: "ML supply-chain and model-lifecycle council + ten deterministic heuristics covering pickle/torch.load deserialization, missing seeds, train/test leakage, hardcoded registry credentials, unsafe yaml.load, unpinned hub downloads, full-dataset training, eval/exec on config, and target leakage. Zero-setup MLOps review."
  },
  {
    to: "/docs/data-sql",
    title: "Data & SQL",
    desc: "Data-engineering council + ten deterministic heuristics covering SQL string interpolation, SELECT *, missing WHERE on UPDATE/DELETE, unbounded queries, unguarded DROP/TRUNCATE, hardcoded DSNs, PII in logs, cross joins, missing transactions, and float money columns. Zero-setup data-pipeline review."
  },
  {
    to: "/docs/k8s",
    title: "Kubernetes",
    desc: "CIS Kubernetes Benchmark council + ten deterministic heuristics covering privileged containers, runAsNonRoot:false, UID 0, privilege escalation, host namespace sharing, dangerous capabilities, empty resource limits, mutable :latest tags, automounted tokens, and wildcard RBAC. Zero-setup workload-manifest review."
  },
  {
    to: "/docs/privacy",
    title: "Privacy (GDPR)",
    desc: "GDPR/CCPA data-protection council + ten deterministic heuristics covering PII in logs, analytics before consent, missing retention TTLs, PII in URLs, third-party sharing, soft-delete vs erasure, cookies without consent, precise geolocation, full PII dumps, and PII to analytics/ML. Zero-setup privacy review."
  },
  {
    to: "/docs/performance",
    title: "Performance & SRE",
    desc: "Performance, scalability, and reliability council + ten deterministic heuristics covering await-in-loop, N+1 queries, missing pagination, sync fs in request paths, fetch without timeout, per-request DB connections, unbounded accumulators, unbounded JSON.parse, O(n²) scans, and leaked intervals. Zero-setup performance review."
  },
  {
    to: "/docs/embedded",
    title: "Embedded (MISRA)",
    desc: "MISRA C/C++ firmware-safety council + ten deterministic heuristics covering unbounded string ops, unchecked malloc, unchecked memcpy length, magic buffer sizes, missing volatile on registers, signed/unsigned loop bounds, goto, allocation on ISR paths, ignored return values, and float equality. Zero-setup firmware review."
  }
] as const;

export default function DocsHub() {
  return (
    <article className="docs-content">
      <h1>Documentation</h1>
      <p className="lead">
        Quorate turns local AI CLIs and compatible models into a review council for diffs and plans.
        The website leads with a Solana app example, but Quorate is generic: use the interactive
        shell locally, run headless checks in CI, or install the GitHub Action to put one council
        verdict on every pull request.
      </p>

      <h2>Why Quorate</h2>
      <ul>
        <li>
          <strong>Many models, one verdict.</strong> Get several independent AI perspectives on a change,
          deduplicated and ranked into one PASS / WARN / FAIL.
        </li>
        <li>
          <strong>Uses the CLIs you already have.</strong> No new API layer to wire up. Quorate detects local
          agents and drives them in headless mode.
        </li>
        <li>
          <strong>Clear about coverage.</strong> The built-in heuristic runs with zero setup, and a
          heuristic-only review is reported as <strong>degraded</strong>, not a confident green.
        </li>
        <li>
          <strong>Guarded execution.</strong> Real providers are opt-in, spawned without a shell, and bounded by
          explicit headless args, byte caps, time caps, and a dangerous-flag denylist.
        </li>
        <li>
          <strong>Designed for the terminal.</strong> Use an inline transcript, a <InlineCode>/</InlineCode>{" "}
          command palette, provider progress, and native severity cards.
        </li>
      </ul>

      <h2>Guides</h2>
      <div className="doc-cards">
        {CARDS.map((card) => (
          <Link key={card.to} to={card.to} className="doc-card">
            <p className="doc-card-title">{card.title}</p>
            <p className="doc-card-desc">{card.desc}</p>
          </Link>
        ))}
      </div>

      <h2>How it works</h2>
      <pre className="doc-diagram">{` diff / plan ─▶ council orchestrator ─▶ local providers, in parallel
                       │                         │ headless, isolated, capped
                       ▼                         ▼
                 dedupe + rank ◀──── findings (severity, file:line, evidence)
                       │
                       ▼
            one verdict  (pass · warn · fail, with degraded mode when limited)`}</pre>
      <p>
        The engine (<InlineCode>@quorate/core</InlineCode>) is shared by the CLI, the interactive shell, and the
        GitHub Action, so the same review logic runs everywhere.
      </p>
    </article>
  );
}
