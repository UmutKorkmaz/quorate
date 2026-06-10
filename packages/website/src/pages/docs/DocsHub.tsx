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
    desc: "Solana/Anchor-aware council + ten deterministic on-chain heuristics. Zero-setup sealevel security review."
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
    to: "/docs/ci",
    title: "CI/CD & Supply Chain",
    desc: "Workflow-security and supply-chain council + ten deterministic heuristics covering script injection, unpinned actions, hardcoded secrets, and pipe-to-shell patterns. Zero-setup CI review."
  }
] as const;

export default function DocsHub() {
  return (
    <article className="docs-content">
      <h1>Documentation</h1>
      <p className="lead">
        Quorate turns local AI CLIs and compatible models into a review council for diffs and plans.
        Use the interactive shell locally, run headless checks in CI, or install the GitHub Action to
        put one council verdict on every pull request.
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
