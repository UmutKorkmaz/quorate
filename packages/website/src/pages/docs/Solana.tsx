import { Link } from "react-router";
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
    flags: "invoke() or invoke_signed() called directly in .rs — reviewers must verify program id, account metas, and remaining_accounts safety"
  },
  {
    title: "Unchecked remaining_accounts used in CPI",
    severity: "high",
    flags: "remaining_accounts read in .rs — caller-supplied accounts need explicit owner/key/signer/writable validation before CPI or authority use"
  },
  {
    title: "CPI program account not pinned",
    severity: "high",
    flags: "CPI target program id comes from caller-controlled accounts — pin it to the expected token, system, or application program"
  },
  {
    title: "Preflight checks disabled",
    severity: "medium",
    flags: "skipPreflight: true in .ts/.js/.tsx/.jsx/.mjs — transaction simulation is skipped on the client"
  },
  {
    title: "Transaction sent without confirmation",
    severity: "medium",
    flags: "sendTransaction or sendRawTransaction without adjacent confirmation — UI state can advance before finality is known"
  },
  {
    title: "Blockhash expiry not tracked",
    severity: "medium",
    flags: "getLatestBlockhash() used without carrying lastValidBlockHeight — retries and expiry handling become ambiguous"
  },
  {
    title: "Confirmation missing blockhash expiry guard",
    severity: "medium",
    flags: "signature-only confirmTransaction call — confirmation is not bound to the transaction blockhash and lastValidBlockHeight"
  },
  {
    title: "Deprecated blockhash freshness API",
    severity: "medium",
    flags: "getRecentBlockhash or getFeeCalculatorForBlockhash in client code — migrate to getLatestBlockhash and explicit confirmation strategy"
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
    flags: "SPL token account accessed without mint or owner constraint check in .rs — including Token-2022 paths where the token program can vary"
  },
  {
    title: "Token-2022 extension constraints missing",
    severity: "medium",
    flags: "TokenInterface or InterfaceAccount paths without extension constraints — transfer hooks, close authorities, and other extensions need policy checks"
  },
  {
    title: "Token-2022 extensions not validated",
    severity: "high",
    flags: "Token-2022 extension state read without validation — extension behavior can change transfer, authority, or fee semantics"
  },
  {
    title: "Unchecked arithmetic on funds",
    severity: "medium",
    flags: "checked_add / checked_sub absent on lamport or token-amount arithmetic in .rs"
  },
  {
    title: "Authority invariant changed",
    severity: "medium",
    flags: "authority or owner key comparison changes in .rs — signer and program authority invariants need review and regression tests"
  },
  {
    title: "Hardcoded keypair material",
    severity: "high",
    flags: "Keypair::from_bytes or bs58-decoded secret embedded in .rs source"
  },
  {
    title: "Anchor account constraint removed",
    severity: "high",
    flags: "has_one, signer, owner, constraint, or seeds/bump constraint commented out or deleted in .rs — breaks account validation"
  },
  {
    title: "Anchor account constraint weakened",
    severity: "high",
    flags: "Anchor account attribute replaced with a less restrictive form — require equivalent validation before accepting the diff"
  },
  {
    title: "Solana invariant check removed",
    severity: "high",
    flags: "require! / assert! guard removed from balance, reserve, supply, fee, debt, or authority logic — keep or replace the invariant"
  }
] as const;

const SOLANA_REVIEW_COMMAND = `quorate init --pack solana
quorate solana doctor --strict
quorate solana test-plan
quorate review --fail-on high \\
  --write-sarif out/quorate.sarif \\
  --write-html out/quorate.html \\
  --write-md out/quorate.md`;

const SOLANA_TEST_PLAN = `Release gate:
- Block merge on high+ Solana findings: removed Anchor constraints, unsafe close, unchecked accounts, hardcoded keypairs.
- Treat heuristic-only reviews as degraded until at least one real provider reviews the Solana roles.
- Keep .quorate.yml, .quorate/policy.yml, baselines, and suppressions on the base branch.

Anchor constraint diff:
- Prove each removed or weakened has_one, signer, owner, mut, seeds, bump, close, and custom constraint is intentional.
- Add negative tests for wrong authority, wrong mint, wrong PDA seeds, stale bump, and unexpected owner.

CPI and remaining_accounts:
- Prefer typed Anchor CPI contexts; if raw invoke/invoke_signed is used, verify the program id and every AccountMeta.
- Treat remaining_accounts as untrusted input: check order, owner, signer/writable flags, PDA derivation, and duplicate accounts.

Transaction safety:
- Do not hide simulation failures with skipPreflight.
- Confirm recent blockhash, fee payer, signer set, instruction order, retry/confirmation strategy, and user-facing failure handling.

Token and Token-2022:
- Check mint, token owner, token program id, decimals, delegate/freeze/close authorities, and transfer-hook or extension behavior.
- Add Token-2022 extension cases when the program supports token-2022 accounts.

Invariants:
- Vault authority and PDA ownership never move without the intended signer.
- Escrow close zeroes data and cannot be reinitialized with stale state.
- Token and lamport totals are conserved except for rent and explicit fees.`;

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
        For wallet-facing dApps, pair it with the optional Web3 due-diligence pack:
      </p>
      <CodeBlock language="bash">{`quorate init --pack solana,web3-dd`}</CodeBlock>
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

      <h2>Example: AI-built Solana app</h2>
      <p>
        Use the Solana pack after an agent, teammate, or scaffold creates a Solana app. The
        workflow is still generic Quorate: review the diff, export reports, and fail the gate
        only when policy says the finding is severe enough.
      </p>
      <CodeBlock language="bash">{SOLANA_REVIEW_COMMAND}</CodeBlock>
      <p>A typical finding on an Anchor escrow change looks like this:</p>
      <CodeBlock language="text">{`FAIL HIGH programs/escrow/src/lib.rs:88
Anchor account constraint removed - close_escrow no longer proves the vault belongs to the escrow authority.

WARN MED app/actions/closeEscrow.ts:41
Client sends the transaction with skipPreflight enabled, so simulation failures are hidden from users.`}</CodeBlock>
      <p>
        The same CLI can review non-Solana work by changing the pack. Solana is the front-page
        example because account constraints, PDA derivation, CPI safety, transaction preflight,
        and token-account validation are easy to regress in AI-generated code.
      </p>
      <p>
        Add <Link to="/docs/web3-dd">Web3 DD / Webacy</Link> when the same PR introduces wallet
        addresses, mint/program ids, claim URLs, approvals, or raw transaction paths. Quorate will
        keep the Solana heuristics and add DD.xyz/Webacy evidence when configured.
      </p>

      <h2>Release gate</h2>
      <p>
        Use the Solana pack as a release gate, not just an advisory audit note. In CI, set{" "}
        <InlineCode>fail-on: high</InlineCode> or a stricter VerdictGate policy so high-risk
        Anchor and transaction-safety findings block the merge before a preview build or deploy job
        is allowed to run.
      </p>
      <p>
        For release readiness outside a pull request, run <InlineCode>quorate solana doctor</InlineCode>
        to inspect <InlineCode>Anchor.toml</InlineCode>, <InlineCode>Cargo.toml</InlineCode>, IDLs,
        deployed program metadata, verifiable build evidence, and whether the Solana pack is active.
        Run <InlineCode>quorate solana test-plan</InlineCode> to turn those signals into the next
        commands reviewers should execute.
      </p>
      <p>
        The Action writes one PR comment and updates it on reruns. That comment is the verified
        review record for the build: verdict, changed-file summary, degraded status, active
        findings, and suppressed findings. Keep SARIF upload and deploy-preview comments as
        separate downstream evidence, but make those jobs depend on the Quorate review job.
      </p>

      <h2>Solana review checklist</h2>
      <p>
        The deterministic rules catch the most obvious regressions. The Solana council should also
        ask for proof around these review topics whenever the diff touches programs, clients, or
        tests:
      </p>
      <ul>
        <li>
          <strong>Anchor constraint diff</strong> — no weakened <InlineCode>has_one</InlineCode>,{" "}
          <InlineCode>signer</InlineCode>, <InlineCode>owner</InlineCode>,{" "}
          <InlineCode>seeds</InlineCode>, <InlineCode>bump</InlineCode>,{" "}
          <InlineCode>close</InlineCode>, or custom constraint without a matching test.
        </li>
        <li>
          <strong>Transaction safety</strong> — preflight stays enabled, blockhash and confirmation
          handling are explicit, and signer / fee-payer changes are visible in the diff.
        </li>
        <li>
          <strong>CPI and remaining accounts</strong> — raw CPI and{" "}
          <InlineCode>remaining_accounts</InlineCode> are treated as untrusted; program ids, account
          order, signer and writable flags, ownership, and duplicate accounts are verified before
          invocation.
        </li>
        <li>
          <strong>Token and Token-2022</strong> — token account checks include mint, owner, token
          program id, decimals, delegate/freeze/close authority, and extension behavior such as
          transfer hooks when Token-2022 accounts are supported.
        </li>
      </ul>

      <h2>Test plan and invariants</h2>
      <p>
        Ask reviewers to turn serious Solana findings into a concrete test plan. The CLI can print
        the starter plan from local repository evidence:
      </p>
      <CodeBlock language="bash">{`quorate solana test-plan --json`}</CodeBlock>
      <CodeBlock language="text">{SOLANA_TEST_PLAN}</CodeBlock>

      <h2>What it catches</h2>
      <p>
        The heuristic reviewer runs with zero setup — no model, no API key, no CLI install.
        It scans every added line in the diff against 21 vulnerability classes drawn from the
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
      - uses: UmutKorkmaz/quorate@1e7796b0f86cdbacadf149637c87b9812b246303
        env:
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
          runner-mode: api
          pack: solana
          fail-on: high`}</CodeBlock>
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
