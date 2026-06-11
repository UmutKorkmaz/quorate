import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

const HEURISTICS = [
  {
    title: "Unchecked account type",
    severity: "high",
    flags: "UncheckedAccount<'_> or AccountInfo<'_> in .rs — account is not validated by the Anchor framework"
  },
  {
    title: "Raw CPI invocation",
    severity: "medium",
    flags: "invoke() or invoke_signed() called directly in .rs — bypasses Anchor's CPI safety helpers"
  },
  {
    title: "Preflight checks disabled",
    severity: "medium",
    flags: "skipPreflight: true in .ts/.js/.tsx/.jsx/.mjs — transaction simulation is skipped on the client"
  },
  {
    title: "Panic in on-chain code",
    severity: "medium",
    flags: "panic!() or unwrap() in .rs program files — program aborts instead of returning a typed error"
  },
  {
    title: "Non-canonical PDA bump",
    severity: "medium",
    flags: "find_program_address result ignored or bump stored without canonicalization in .rs"
  },
  {
    title: "Manual account closing",
    severity: "high",
    flags: "lamport reassignment to close an account without zeroing data in .rs — enables reinitialization attacks"
  },
  {
    title: "Unvalidated token account",
    severity: "medium",
    flags: "SPL token account accessed without mint or owner constraint check in .rs"
  },
  {
    title: "Unchecked arithmetic on funds",
    severity: "medium",
    flags: "checked_add / checked_sub absent on lamport or token-amount arithmetic in .rs"
  },
  {
    title: "Hardcoded keypair material",
    severity: "high",
    flags: "Keypair::from_bytes or bs58-decoded secret embedded in .rs source"
  },
  {
    title: "Anchor account constraint removed",
    severity: "high",
    flags: "has_one, constraint, or seeds constraint commented out or deleted in .rs — breaks account validation"
  }
] as const;

export default function Solana() {
  return (
    <article className="doc-page">
      <h1>Solana / Anchor</h1>
      <p className="lead">
        The Solana pack brings a Solana/Anchor-aware review council and deterministic on-chain
        heuristics to Quorate. Zero-setup static checks catch the most common sealevel
        vulnerability classes before a single model is called, and a dedicated council —
        covering security, account safety, transaction correctness, token safety, and
        maintainability — layers semantic review on top.
      </p>

      <h2>Set up</h2>
      <p>
        Run <InlineCode>quorate init</InlineCode> with the Solana pack to scaffold the config
        and role guidance in your repo:
      </p>
      <CodeBlock language="bash">{`quorate init --pack solana`}</CodeBlock>
      <p>
        This writes a <InlineCode>.quorate.yml</InlineCode> that includes five councils
        pre-configured for Solana/Anchor work:
      </p>
      <ul>
        <li>
          <strong>solana-security</strong> — program authority, signer checks, CPI safety
        </li>
        <li>
          <strong>anchor-accounts</strong> — account constraint completeness, PDA canonicalization
        </li>
        <li>
          <strong>transaction-safety</strong> — client-side preflight, instruction ordering, fee payer
        </li>
        <li>
          <strong>token-safety</strong> — SPL token account validation, mint checks, decimal handling
        </li>
        <li>
          <strong>maintainer</strong> — code clarity, upgrade authority hygiene, test coverage
        </li>
      </ul>
      <p>
        Each council role ships with reviewer guidance tuned to Solana idioms. Run{" "}
        <InlineCode>quorate packs</InlineCode> to see available packs and their bundled councils.
      </p>

      <h2>What it catches</h2>
      <p>
        The heuristic reviewer runs with zero setup — no model, no API key, no CLI install.
        It scans every added line in the diff against ten vulnerability classes drawn from the
        Solana/Anchor security canon. A real council (claude, codex, or any{" "}
        <InlineCode>type: api</InlineCode> model) then adds semantic review using the pack's
        role guidance.
      </p>
      <table>
        <thead>
          <tr>
            <th>Heuristic</th>
            <th>Severity</th>
            <th>What it flags</th>
          </tr>
        </thead>
        <tbody>
          {HEURISTICS.map((h) => (
            <tr key={h.title}>
              <td>
                <strong>{h.title}</strong>
              </td>
              <td>
                <InlineCode>{h.severity}</InlineCode>
              </td>
              <td>{h.flags}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        A heuristic-only review is reported as <strong>degraded</strong> — an honest WARN, never
        a confident green. Add a council provider to get full semantic coverage.
      </p>

      <h2>On every PR</h2>
      <p>
        Commit the <InlineCode>.quorate.yml</InlineCode> scaffolded by{" "}
        <InlineCode>quorate init --pack solana</InlineCode> to your base branch, add the workflow
        below, and set <InlineCode>OPENROUTER_API_KEY</InlineCode> in your repository secrets.
        The workflow uses <InlineCode>runner-mode: api</InlineCode> so it runs on a standard
        GitHub-hosted runner — no self-hosted machine needed.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml (base branch — generated by quorate init --pack solana)
providers:
  - id: heuristic
    type: mock
    enabled: true
  - id: openrouter
    type: api
    enabled: true
    baseUrl: https://openrouter.ai/api/v1
    model: anthropic/claude-sonnet-4.6
    apiKeyEnv: OPENROUTER_API_KEY
    roles: [solana-security, anchor-accounts, transaction-safety, token-safety, maintainer]`}</CodeBlock>
      <CodeBlock language="yaml">{`name: Quorate — Solana review
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: UmutKorkmaz/quorate@v0.7.2
        env:
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
          runner-mode: api`}</CodeBlock>
      <p>
        The heuristic always runs regardless of <InlineCode>runner-mode</InlineCode>. Swap the
        OpenRouter model for any OpenAI-compatible endpoint — see{" "}
        <Link to="/docs/providers">Providers</Link> for presets and the{" "}
        <InlineCode>quorate provider add</InlineCode> command. For general Action options
        (inline comments, <InlineCode>fail-on</InlineCode>, agreement gate) see{" "}
        <Link to="/docs/github-action">GitHub Action</Link>.
      </p>
    </article>
  );
}
