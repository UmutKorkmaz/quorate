import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";

import { InlineCode } from "../../components/InlineCode";

export default function GithubAction() {
  return (
    <article className="doc-page">
      <h1>GitHub Action</h1>
      <p className="lead">Run the council on every pull request and post a single report comment.</p>

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
      - uses: UmutKorkmaz/quorate@v0.9.0
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}`}</CodeBlock>

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
            <td>Config file, read from the base branch.</td>
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
              <code>fail-on</code>
            </td>
            <td>
              <InlineCode>high</InlineCode>
            </td>
            <td>
              Minimum severity that fails the check (<InlineCode>critical</InlineCode>…
              <InlineCode>info</InlineCode>, or <InlineCode>never</InlineCode>).
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
              Gate only on findings absent from a committed baseline (read from the base branch).
            </td>
          </tr>
          <tr>
            <td>
              <code>baseline-path</code>
            </td>
            <td>
              <InlineCode>.quorate.baseline.json</InlineCode>
            </td>
            <td>Path to the committed baseline file, read from the base branch.</td>
          </tr>
          <tr>
            <td>
              <code>policy-path</code>
            </td>
            <td>
              <InlineCode>.quorate/policy.yml</InlineCode>
            </td>
            <td>
              VerdictGate merge policy, read from the base branch. Defines the gate when present;
              otherwise it&apos;s derived from the github config.
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
              <code>mode</code>
            </td>
            <td>
              <InlineCode>review</InlineCode>
            </td>
            <td>Council mode — only review is implemented for the Action.</td>
          </tr>
        </tbody>
      </table>

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
    uses: UmutKorkmaz/quorate@v0.9.0
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
        Then set <InlineCode>baseline: true</InlineCode> on the Action (or pass{" "}
        <InlineCode>--baseline</InlineCode> to the CLI). Quorate reads the baseline from the{" "}
        <strong>base branch</strong>, never the PR head, so a pull request can&apos;t baseline away its
        own new findings. A baselined critical that resurfaces is suppressed and the verdict is
        recomputed on what remains; refresh anytime with{" "}
        <InlineCode>quorate baseline --update</InlineCode>.
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
- uses: UmutKorkmaz/quorate@v0.9.0
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
- uses: UmutKorkmaz/quorate@v0.9.0
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
