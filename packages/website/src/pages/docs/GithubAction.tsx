import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";

import { InlineCode } from "../../components/InlineCode";

export default function GithubAction() {
  return (
    <article className="doc-page">
      <h1>GitHub Action</h1>
      <p className="lead">
        Run the council on every pull request, post one verified report comment, and fail release
        gates when policy says a finding should block.
      </p>

      <CodeBlock language="yaml">{`name: Quorate
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
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}`}</CodeBlock>
      <p>
        The Action is pinned to the reviewed v1.2.1 bundle commit. Keep the full 40-character SHA
        in production workflows so upstream changes cannot alter a run.
      </p>

      <h2>Inputs</h2>
      <table>
        <thead>
          <tr>
            <th>Input</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>github-token</code>
            </td>
            <td>—</td>
            <td>Token to read PR files and write comments.</td>
          </tr>
          <tr>
            <td>
              <code>config-path</code>
            </td>
            <td>
              <InlineCode>.quorate.yml</InlineCode>
            </td>
            <td>Canonical base-branch config path; alternate PR-controlled paths are rejected.</td>
          </tr>
          <tr>
            <td>
              <code>providers</code>
            </td>
            <td>—</td>
            <td>Comma-separated provider ids to enable.</td>
          </tr>
          <tr>
            <td>
              <code>pack</code>
            </td>
            <td>—</td>
            <td>
              Domain pack(s) to layer onto the review, such as <InlineCode>solana</InlineCode> or{" "}
              <InlineCode>auto</InlineCode> to detect from changed files.
            </td>
          </tr>
          <tr>
            <td>
              <code>fail-on</code>
            </td>
            <td>
              <InlineCode>high</InlineCode>
            </td>
            <td>
              May tighten the committed base policy; <InlineCode>never</InlineCode> or a weaker
              threshold cannot relax it.
            </td>
          </tr>
          <tr>
            <td>
              <code>post-comment</code>
            </td>
            <td>
              <InlineCode>true</InlineCode>
            </td>
            <td>Post or update the Quorate summary comment.</td>
          </tr>
          <tr>
            <td>
              <code>inline-comments</code>
            </td>
            <td>
              <InlineCode>false</InlineCode>
            </td>
            <td>Post findings as inline review comments on changed lines.</td>
          </tr>
          <tr>
            <td>
              <code>inline-comment-limit</code>
            </td>
            <td>
              <InlineCode>10</InlineCode>
            </td>
            <td>Maximum inline comments per run.</td>
          </tr>
          <tr>
            <td>
              <code>runner-mode</code>
            </td>
            <td>
              <InlineCode>auto</InlineCode>
            </td>
            <td>
              Restrict providers by type: <InlineCode>auto</InlineCode> (all),{" "}
              <InlineCode>cli</InlineCode> (local agents only), <InlineCode>api</InlineCode> (HTTP
              endpoints only). The heuristic always runs.
            </td>
          </tr>
          <tr>
            <td>
              <code>baseline</code>
            </td>
            <td>
              <InlineCode>false</InlineCode>
            </td>
            <td>
              Deprecated compatibility input; the canonical valid, unexpired base baseline is
              automatic.
            </td>
          </tr>
          <tr>
            <td>
              <code>baseline-path</code>
            </td>
            <td>
              <InlineCode>.quorate.baseline.json</InlineCode>
            </td>
            <td>Canonical trusted baseline path; alternate paths are rejected.</td>
          </tr>
          <tr>
            <td>
              <code>suppress-path</code>
            </td>
            <td>
              <InlineCode>.quorate/suppressions.json</InlineCode>
            </td>
            <td>
              Canonical trusted suppression path; alternate paths are rejected. Suppressed
              findings stay visible but are not gated.
            </td>
          </tr>
          <tr>
            <td>
              <code>policy-path</code>
            </td>
            <td>
              <InlineCode>.quorate/policy.yml</InlineCode>
            </td>
            <td>
              Canonical trusted VerdictGate policy path; alternate paths are rejected. The base
              policy defines the merge gate when present.
            </td>
          </tr>
          <tr>
            <td>
              <code>sarif-file</code>
            </td>
            <td>—</td>
            <td>
              Path to write a SARIF 2.1.0 report; the path is exposed as the <code>sarif-path</code>{" "}
              output for a downstream <InlineCode>upload-sarif</InlineCode> step.
            </td>
          </tr>
          <tr>
            <td>
              <code>include-pr-context</code>
            </td>
            <td>
              <InlineCode>false</InlineCode>
            </td>
            <td>Include redacted PR title/body/commits as untrusted read-only prompt context.</td>
          </tr>
          <tr>
            <td>
              <code>reviewgraph</code>
            </td>
            <td>
              <InlineCode>false</InlineCode>
            </td>
            <td>Include ReviewGraph agreement evidence in the PR comment and job summary.</td>
          </tr>
          <tr>
            <td>
              <code>reviewgraph-file</code>
            </td>
            <td>—</td>
            <td>
              Path to write ReviewGraph JSON; the path is exposed as the{" "}
              <code>reviewgraph-path</code> output.
            </td>
          </tr>
          <tr>
            <td>
              <code>mode</code>
            </td>
            <td>
              <InlineCode>review</InlineCode>
            </td>
            <td>Council mode — only review is implemented for the Action.</td>
          </tr>
        </tbody>
      </table>

      <h2>Solana release gate</h2>
      <p>
        For Solana and Anchor repositories, run Quorate before preview deployment. The review job
        can block high-severity Anchor account, transaction-safety, CPI, or Token-2022 findings, and
        downstream build/deploy jobs can depend on the verdict output.
      </p>
      <CodeBlock language="yaml">{`name: Quorate — Solana release gate
on: pull_request
permissions:
  contents: read
  pull-requests: write
  security-events: write
jobs:
  review:
    runs-on: ubuntu-latest
    outputs:
      verdict: \${{ steps.quorate.outputs.verdict }}
      findings: \${{ steps.quorate.outputs.findings }}
    steps:
      - uses: actions/checkout@v4
      - id: quorate
        uses: UmutKorkmaz/quorate@1e7796b0f86cdbacadf149637c87b9812b246303
        env:
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
          runner-mode: api
          pack: solana
          fail-on: high
          inline-comments: true
          sarif-file: quorate.sarif
          reviewgraph: true
          reviewgraph-file: quorate.reviewgraph.json
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: \${{ steps.quorate.outputs.sarif-path }}

  build-and-preview:
    needs: review
    if: needs.review.outputs.verdict != 'fail'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test && npm run build
      - run: npm run deploy:preview`}</CodeBlock>
      <p>
        The Quorate PR comment is the verified review-gate record: verdict, diff summary, degraded
        status, and active and suppressed findings. A deploy job should add its own preview URL
        after deployment succeeds; keeping it behind the review job makes that build/deploy comment
        evidence that the Solana gate passed first.
      </p>
      <p>
        The Solana council guidance asks reviewers to inspect Anchor constraint diffs, transaction
        preflight and confirmation handling, raw CPI and <InlineCode>remaining_accounts</InlineCode>
        validation, Token-2022 extension behavior, and the test plan/invariants needed to prove the
        change is safe. See <Link to="/docs/solana">Solana / Anchor</Link> for the checklist.
      </p>

      <h2>Web3 DD with DD.xyz/Webacy</h2>
      <p>
        Add <InlineCode>web3-dd</InlineCode> when a dApp PR can introduce wallet-facing
        addresses, token contracts, program ids, claim URLs, approvals, raw transactions, or
        typed-data signing changes. The Webacy integration is opt-in and uses a normal secret
        passed through <InlineCode>env</InlineCode>.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml, committed on the base branch
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

# workflow step
- uses: UmutKorkmaz/quorate@1e7796b0f86cdbacadf149637c87b9812b246303
  env:
    WEBACY_API_KEY: \${{ secrets.WEBACY_API_KEY }}
    OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
  with:
    github-token: \${{ secrets.GITHUB_TOKEN }}
    runner-mode: api
    pack: solana,web3-dd
    fail-on: high`}</CodeBlock>
      <p>
        Quorate sends extracted indicators only — address, chain, or URL — not the full source file
        or full diff. See <Link to="/docs/web3-dd">Web3 DD / Webacy</Link> for the full config.
      </p>

      <h2>SARIF → GitHub Code Scanning</h2>
      <p>
        Write a SARIF report and hand it to GitHub&apos;s <InlineCode>upload-sarif</InlineCode> action
        to surface findings in the repository <strong>Security</strong> tab, with inline annotations
        that persist beyond the PR. A composite action can&apos;t upload SARIF itself, so Quorate
        writes the file and exposes its path:
      </p>
      <CodeBlock language="yaml">{`permissions:
  contents: read
  pull-requests: write
  security-events: write          # required to upload SARIF
steps:
  - uses: actions/checkout@v4
  - id: quorate
    uses: UmutKorkmaz/quorate@1e7796b0f86cdbacadf149637c87b9812b246303
    with:
      github-token: \${{ secrets.GITHUB_TOKEN }}
      sarif-file: quorate.sarif
  - uses: github/codeql-action/upload-sarif@v3
    if: always()
    with:
      sarif_file: \${{ steps.quorate.outputs.sarif-path }}`}</CodeBlock>
      <p>
        The SARIF rule id is stable per finding class (Code Scanning groups recurrences instead of
        re-opening them), and each result carries a <InlineCode>quorateFingerprint</InlineCode>. The
        CLI writes the same formats locally — <InlineCode>review --write-sarif</InlineCode>,{" "}
        <InlineCode>--write-junit</InlineCode> (CI test dashboards, incl. GitLab/Azure),{" "}
        <InlineCode>--write-html</InlineCode>, and <InlineCode>--write-md</InlineCode>.
      </p>

      <h2>Adopt on an existing repo: baseline mode</h2>
      <p>
        A mature codebase will surface findings the team hasn&apos;t triaged yet. Rather than turn the
        gate off, record them as an accepted <strong>baseline</strong> and let the gate fail only on{" "}
        <em>new</em> findings:
      </p>
      <CodeBlock language="bash">{`quorate review --base origin/main --head HEAD   # produce a report
quorate baseline                                # write .quorate.baseline.json
git add .quorate.baseline.json && git commit -m "chore: quorate baseline"`}</CodeBlock>
      <p>
        The Action applies the canonical baseline automatically; pass <InlineCode>--baseline</InlineCode>{" "}
        only for CLI reviews. Quorate reads the baseline from the <strong>base branch</strong>, never
        the PR head, so a pull request can&apos;t baseline away its own new findings. Stale baselines are
        rejected and all findings remain gated. A current baselined critical that resurfaces is
        suppressed and the verdict is recomputed on what remains; refresh anytime with{" "}
        <InlineCode>quorate baseline --update</InlineCode>.
      </p>

      <h2>Accept a finding: suppressions</h2>
      <p>
        When a finding is a deliberate, accepted risk, suppress it by fingerprint with a{" "}
        <strong>required reason</strong> (and optional expiry). Suppressed findings are{" "}
        <strong>tagged, not dropped</strong>: they stay visible in the report —{" "}
        <em>1 active, 2 suppressed</em> — but never count toward the verdict or merge gate, so an
        accepted critical can never pass <em>silently</em>.
      </p>
      <CodeBlock language="bash">{`quorate review --base origin/main        # produce a report
quorate fix --list                        # find the finding number (1-based)
quorate suppress add 1 --reason "third-party fixture, not a real secret" [--expires 2026-09-01]
git add -f .quorate/suppressions.json && git commit -m "chore: suppress fixture secret"`}</CodeBlock>
      <p>
        Then the committed <InlineCode>.quorate/suppressions.json</InlineCode> applies
        automatically on every run. Like the baseline, the Action reads it from the{" "}
        <strong>base branch</strong>, so a PR can&apos;t suppress its own new findings. Manage it with{" "}
        <InlineCode>quorate suppress list</InlineCode>, <InlineCode>remove</InlineCode>, and{" "}
        <InlineCode>audit</InlineCode> (which exits non-zero when any suppression has expired).
      </p>

      <h2>Outputs</h2>
      <ul>
        <li>
          <InlineCode>verdict</InlineCode> — the final verdict, lowercase{" "}
          <InlineCode>pass</InlineCode> / <InlineCode>warn</InlineCode> / <InlineCode>fail</InlineCode>.
        </li>
        <li>
          <InlineCode>findings</InlineCode> — the number of findings in the report.
        </li>
        <li>
          <InlineCode>sarif-path</InlineCode> — the absolute path of the written SARIF file when{" "}
          <InlineCode>sarif-file</InlineCode> is set.
        </li>
        <li>
          <InlineCode>reviewgraph-path</InlineCode> — the absolute path of ReviewGraph JSON when{" "}
          <InlineCode>reviewgraph-file</InlineCode> is set.
        </li>
      </ul>

      <h2>Runner choice</h2>
      <p>
        The Action posts a single report comment and can fail the check based on <InlineCode>fail-on</InlineCode>{" "}
        severity. <InlineCode>cli</InlineCode> providers (<InlineCode>claude</InlineCode>,{" "}
        <InlineCode>codex</InlineCode>, …) need a <strong>self-hosted runner</strong> where those CLIs are
        installed and authenticated. The default heuristic and any <InlineCode>type: api</InlineCode> provider
        run on standard <strong>GitHub-hosted runners</strong>.
      </p>
      <p>
        The default <InlineCode>runner-mode: auto</InlineCode> is <strong>runner-aware</strong>: on
        GitHub-hosted runners it keeps only <InlineCode>api</InlineCode> providers (+ the heuristic), so a
        council that also lists local CLI agents never produces doomed &quot;command not found&quot; lanes
        in CI. Set <InlineCode>runner-mode: cli</InlineCode> explicitly if your workflow preinstalls and
        authenticates agent CLIs.
      </p>

      <h2>Real AI review on GitHub-hosted runners</h2>
      <p>
        The practical way to get real model review in CI without self-hosting: commit a{" "}
        <InlineCode>.quorate.yml</InlineCode> to your base branch with a <InlineCode>type: api</InlineCode>{" "}
        provider pointing at a hosted gateway, and pass the key through as an env var from secrets.
        Set <InlineCode>runner-mode: api</InlineCode> to run only HTTP-endpoint providers.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml (base branch)
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
    roles: [security, architect]`}</CodeBlock>
      <CodeBlock language="yaml">{`# workflow step
- uses: UmutKorkmaz/quorate@1e7796b0f86cdbacadf149637c87b9812b246303
  env:
    OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
  with:
    github-token: \${{ secrets.GITHUB_TOKEN }}
    runner-mode: api`}</CodeBlock>
      <p>
        Generate provider entries with <InlineCode>quorate provider add &lt;id&gt; --preset openrouter</InlineCode>;
        the <InlineCode>roles:</InlineCode> field assigns each model to council roles. Any hosted
        gateway works the same way — swap the <InlineCode>baseUrl</InlineCode>,{" "}
        <InlineCode>model</InlineCode>, and key env var. See the{" "}
        <Link to="/docs/config">gateway reference table</Link> for the common ones.
      </p>
      <p>
        Optional example from this repository: its CI currently selects{" "}
        <strong>Z.ai&apos;s GLM-5.1</strong> as a hosted <InlineCode>api</InlineCode> provider, with the
        heuristic as the always-on baseline. Replace the id, endpoint, model, roles, and secret with
        your own provider if you prefer.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml (base branch)
providers:
  - id: glm
    type: api
    enabled: true
    baseUrl: https://api.z.ai/api/coding/paas/v4
    model: glm-5.1
    apiKeyEnv: GLM_API_KEY
    roles: [architect, security, performance]`}</CodeBlock>
      <CodeBlock language="yaml">{`# workflow step
- uses: UmutKorkmaz/quorate@1e7796b0f86cdbacadf149637c87b9812b246303
  env:
    GLM_API_KEY: \${{ secrets.GLM_API_KEY }}
  with:
    github-token: \${{ secrets.GITHUB_TOKEN }}`}</CodeBlock>
      <p>
        The <InlineCode>apiKeyEnv</InlineCode> name is your choice — it just has to match the env var
        the workflow exposes from <InlineCode>secrets</InlineCode>. With the default{" "}
        <InlineCode>runner-mode: auto</InlineCode>, GitHub-hosted runs keep the configured{" "}
        <InlineCode>api</InlineCode> providers (+ heuristic), so your selected hosted provider is the
        real reviewer with no extra flags. GLM is only this repo&apos;s example. See{" "}
        <Link to="/docs/providers">Providers</Link> and{" "}
        <Link to="/docs/config">Configuration</Link>.
      </p>

      <h2>Security</h2>
      <blockquote>
        The Action loads <InlineCode>.quorate.yml</InlineCode> from the pull request&apos;s <strong>base branch</strong>
        , never from the PR head — a pull request cannot supply the config that governs its own review.
      </blockquote>

      <h2>GitHub config options</h2>
      <p>
        Configure GitHub-specific behavior under the <InlineCode>github</InlineCode> key in{" "}
        <InlineCode>.quorate.yml</InlineCode>:
      </p>
      <ul>
        <li>
          <InlineCode>commentMode</InlineCode> — <InlineCode>update</InlineCode>, <InlineCode>new</InlineCode>, or{" "}
          <InlineCode>off</InlineCode>
        </li>
        <li>
          <InlineCode>failOn</InlineCode> — minimum severity that fails the check, or <InlineCode>never</InlineCode>
        </li>
        <li>
          <InlineCode>failOnDegraded</InlineCode> — fail when the review is heuristic-only
        </li>
        <li>
          <InlineCode>inlineComments</InlineCode> — opt-in inline PR comments anchored to file and line
        </li>
        <li>
          <InlineCode>inlineCommentLimit</InlineCode> — maximum inline comments posted per run
        </li>
        <li>
          <InlineCode>gate</InlineCode> — agreement gate{" "}
          <InlineCode>{"{ severity, minAgreement }"}</InlineCode>: require at least{" "}
          <InlineCode>minAgreement</InlineCode> providers to flag a finding at or above{" "}
          <InlineCode>severity</InlineCode> before it blocks.
        </li>
        <li>
          <InlineCode>runnerMode</InlineCode> — restrict providers by type:{" "}
          <InlineCode>auto</InlineCode>, <InlineCode>cli</InlineCode>, or <InlineCode>api</InlineCode>{" "}
          (the heuristic always runs)
        </li>
      </ul>
    </article>
  );
}
