import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

const CONFIG = `# .quorate.yml
councils:
  - web3-due-diligence
  - wallet-safety
  - transaction-safety
  - phishing-safety
  - maintainer

integrations:
  webacy:
    enabled: true
    apiKeyEnv: WEBACY_API_KEY
    chains: [eth, base, sol]
    failOn:
      riskLevel: high
      sanctioned: true
      maliciousUrl: true
    warnOn:
      riskLevel: medium
    allowlist:
      addresses: []
      domains: []
      urls: []
    cache:
      ttlHours: 24`;

const WORKFLOW = `name: Quorate Web3 DD
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: UmutKorkmaz/quorate@34afb7c13faa405bdf833a096f401a42a71f6f1b
        env:
          WEBACY_API_KEY: \${{ secrets.WEBACY_API_KEY }}
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
          runner-mode: api
          pack: solana,web3-dd
          fail-on: high
          inline-comments: true`;

export default function Web3Dd() {
  return (
    <article className="doc-page">
      <h1>Web3 DD / Webacy</h1>
      <p className="lead">
        The Web3 DD pack turns DD.xyz/Webacy risk intelligence into normal Quorate findings.
        It extracts only added Web3 indicators from the diff — addresses, URLs, approval
        patterns, raw transaction paths, and typed-data signing changes — then optionally
        enriches those indicators with Webacy address and URL risk.
      </p>

      <h2>When to use it</h2>
      <p>
        Use <InlineCode>web3-dd</InlineCode> alongside <InlineCode>solana</InlineCode>,{" "}
        <InlineCode>evm</InlineCode>, or <InlineCode>move</InlineCode> when a dApp PR can
        introduce hardcoded mints, token contracts, program ids, claim URLs, transaction builders,
        or wallet signing flows.
      </p>
      <CodeBlock language="bash">{`quorate init --pack solana,web3-dd
quorate review --base main --head HEAD --fail-on high`}</CodeBlock>

      <h2>What runs without an API key</h2>
      <p>
        The pack always runs static due-diligence checks when selected. These findings do not call
        Webacy and do not require secrets:
      </p>
      <ul>
        <li>hardcoded EVM or Solana addresses in wallet/token/program contexts,</li>
        <li>external URLs in wallet, token metadata, claim, RPC, or transaction contexts,</li>
        <li>approval patterns such as <InlineCode>approve</InlineCode>,{" "}
          <InlineCode>setApprovalForAll</InlineCode>, and <InlineCode>MaxUint256</InlineCode>,</li>
        <li>raw transaction submission and EIP-712 typed-data signing changes.</li>
      </ul>

      <h2>Enable Webacy evidence</h2>
      <p>
        Add <InlineCode>integrations.webacy</InlineCode> to the config committed on the base branch.
        Quorate reads the API key from the named environment variable and never stores it in config.
      </p>
      <CodeBlock language="yaml">{CONFIG}</CodeBlock>
      <p>
        Webacy is opt-in. If the integration is disabled, Quorate still runs the static Web3 DD
        checks. If the integration is enabled but the key is missing, Quorate emits a high-severity
        setup finding so CI shows a clear, actionable failure.
      </p>

      <h2>DD.xyz grant fit</h2>
      <p>
        This pack maps directly to the DD.xyz Startup Accelerator integration points: threat risk
        for wallet, token, contract, and program addresses; URL risk for phishing and drainer
        links; and PR gates for approval, raw transaction, and typed-data signing changes. The MVP
        deliberately avoids invite-only holder analysis and does not run Webacy checks in browser
        code.
      </p>
      <p>
        Live Webacy evidence currently enriches extracted addresses and URLs. Approval changes,
        raw transactions, and EIP-712 changes are still reviewed as static CI findings unless a
        future PR adds parseable transaction payload scanning.
      </p>

      <h2>GitHub Action</h2>
      <p>
        Pass <InlineCode>WEBACY_API_KEY</InlineCode> through as a repository or organization secret.
        The Action reads <InlineCode>.quorate.yml</InlineCode> from the base branch, so a pull
        request cannot disable its own DD gate.
      </p>
      <CodeBlock language="yaml">{WORKFLOW}</CodeBlock>

      <h2>Privacy and scope</h2>
      <p>
        Quorate sends extracted indicators only: address, chain, or URL. It does not upload the full
        source file or full diff to Webacy. Local caching deduplicates repeated lookups under{" "}
        <InlineCode>.quorate/cache/webacy.json</InlineCode>.
      </p>

      <h2>Solana app example</h2>
      <p>
        A Solana frontend PR that adds a new mint address, claim URL, and raw transaction path can
        run with <InlineCode>pack: solana,web3-dd</InlineCode>. Static Solana checks review
        transaction confirmation and preflight behavior, while Web3 DD adds Webacy evidence for
        the introduced mint and URL.
      </p>
      <p>
        See <Link to="/docs/github-action">GitHub Action</Link> for common Action inputs and{" "}
        <Link to="/docs/solana">Solana / Anchor</Link> for the Solana release-gate checklist.
      </p>
    </article>
  );
}
