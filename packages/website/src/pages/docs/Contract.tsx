import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

export default function Contract() {
  return (
    <article className="doc-page">
      <h1>Contract checks</h1>
      <p className="lead">
        Deterministic OpenAPI 3 contract breaking-change detection. Block releases on removed
        operations, newly required fields, incompatible type changes, or removed enum values.
        Privacy-preserving metrics track verdicts and agreement without sending data anywhere.
      </p>

      <h2>ContractCourt MVP</h2>
      <p>
        The <InlineCode>contract check</InlineCode> command parses OpenAPI 3 (JSON or YAML) and
        classifies every change by safety: breaking changes produce <strong>BLOCK</strong> verdicts;
        additive compatible changes pass; ambiguous changes warn. No AI models, no variance —
        deterministic output every time.
      </p>

      <h3>Git mode</h3>
      <p>Compare spec versions from git refs:</p>
      <CodeBlock language="bash">{`quorate contract check \\
  --spec openapi.yml \\
  --base origin/main \\
  --head HEAD`}</CodeBlock>

      <h3>File mode</h3>
      <p>Compare two local spec files directly:</p>
      <CodeBlock language="bash">{`quorate contract check \\
  --spec openapi.yml \\
  --before snapshot/v1.0.0.yml \\
  --after snapshot/v1.1.0.yml`}</CodeBlock>

      <h2>What it checks</h2>
      <p>
        ContractCourt classifies every OpenAPI change into three categories: <strong>BLOCK</strong>
        (breaking), <strong>pass</strong> (compatible), or <strong>warn</strong> (ambiguous). The
        table below lists every class with a one-line example of when it fires:
      </p>

      <table>
        <thead>
          <tr>
            <th>Verdict</th>
            <th>Class</th>
            <th>Example</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>BLOCK</strong>
            </td>
            <td>Removed operation</td>
            <td>
              <InlineCode>DELETE /users/:id</InlineCode> existed in base, gone in head.
            </td>
          </tr>
          <tr>
            <td>
              <strong>BLOCK</strong>
            </td>
            <td>Newly required path/query parameter</td>
            <td>
              <InlineCode>?api_version</InlineCode> was optional, now required.
            </td>
          </tr>
          <tr>
            <td>
              <strong>BLOCK</strong>
            </td>
            <td>Newly required request-body field</td>
            <td>
              <InlineCode>{"{ email }"}</InlineCode> was optional, now required.
            </td>
          </tr>
          <tr>
            <td>
              <strong>BLOCK</strong>
            </td>
            <td>Incompatible type change</td>
            <td>
              <InlineCode>amount</InlineCode> was <InlineCode>string</InlineCode>, now{" "}
              <InlineCode>number</InlineCode>.
            </td>
          </tr>
          <tr>
            <td>
              <strong>BLOCK</strong>
            </td>
            <td>Removed enum value</td>
            <td>
              <InlineCode>status</InlineCode> allowed <InlineCode>"pending"</InlineCode>, now only{" "}
              <InlineCode>"active"</InlineCode> or <InlineCode>"completed"</InlineCode>.
            </td>
          </tr>
          <tr>
            <td>
              <strong>BLOCK</strong>
            </td>
            <td>Removed 2xx response</td>
            <td>
              <InlineCode>200 OK</InlineCode> existed in base, no longer documented in head.
            </td>
          </tr>
          <tr>
            <td>
              <strong>pass</strong>
            </td>
            <td>Additive changes</td>
            <td>
              New operation, new optional field, new enum value, new 2xx response, expanded type
              union.
            </td>
          </tr>
          <tr>
            <td>
              <strong>warn</strong>
            </td>
            <td>Ambiguous changes</td>
            <td>
              Description/summary changes, new/removed examples, response schema changes that
              aren&apos;t obviously breaking.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Release gate with --gate</h2>
      <p>
        Add <InlineCode>--gate</InlineCode> to exit non-zero when the verdict is <strong>BLOCK</strong>:
      </p>
      <CodeBlock language="bash">{`quorate contract check \\
  --spec openapi.yml \\
  --before snapshot/v1.0.0.yml \\
  --after snapshot/v1.1.0.yml \\
  --gate`}</CodeBlock>
      <p>
        Exit codes: <InlineCode>0</InlineCode> for pass or warn, <InlineCode>1</InlineCode> for BLOCK
        (or missing spec/base/head), <InlineCode>2</InlineCode> for ambiguous parser errors. Use
        this in CI to block merges on breaking changes.
      </p>

      <h2>JSON mode</h2>
      <p>
        Add <InlineCode>--json</InlineCode> to get machine-readable output:
      </p>
      <CodeBlock language="bash">{`quorate contract check \\
  --spec openapi.yml \\
  --base origin/main \\
  --head HEAD \\
  --json`}</CodeBlock>
      <p>
        The JSON report includes the verdict, all detected changes with line anchors, and the
        artifact hash. Parse it in CI or dashboards.
      </p>

      <h2>Artifacts</h2>
      <p>
        Every contract check writes two artifacts to <InlineCode>.quorate/contract/</InlineCode>:
      </p>
      <ul>
        <li>
          <InlineCode>latest.json</InlineCode> — the full report with change details, line numbers,
          and verdict.
        </li>
        <li>
          <InlineCode>latest.md</InlineCode> — the human-readable Markdown summary.
        </li>
      </ul>
      <p>
        Each artifact includes a <strong>deterministic hash</strong> of its content — the same diff
        produces the same hash every time, so you can detect duplicate runs or verify integrity.
      </p>

      <h2>Metrics</h2>
      <p>
        The <InlineCode>metrics</InlineCode> command aggregates local run evidence:{" "}
        <strong>verdict distribution, median duration, finding counts, council agreement, approval
        counts, proof pass rate, and contract verdicts</strong>. Data never leaves your machine —
        it&apos;s purely local aggregation from signed run artifacts (the trust ledger) and
        contract reports.
      </p>
      <CodeBlock language="bash">{`quorate metrics
quorate metrics --json`}</CodeBlock>
      <p>
        The default output is a human-readable summary. Add <InlineCode>--json</InlineCode> for
        machine-readable metrics you can pipe to dashboards or time-series storage. All counts are
        derived from local evidence in <InlineCode>.quorate/</InlineCode>; nothing is transmitted.
      </p>

      <h3>Privacy note</h3>
      <p>
        Quorate metrics are <strong>privacy-preserving by design</strong>: they count, they
        aggregate, they report statistics — but they <strong>never transmit data</strong>. No diffs,
        no finding text, no model outputs, no contract schemas. The metrics command operates entirely
        on local run artifacts. Use it freely in regulated environments where telemetry is forbidden.
      </p>

      <h2>GitHub Action integration</h2>
      <p>
        Wire contract checks into the same <InlineCode>quorate</InlineCode> Action workflow that
        gates council reviews. The Action already tracks contracts in{" "}
        <InlineCode>.quorate/contract/</InlineCode>, and metrics pull from that same local store:
      </p>
      <CodeBlock language="yaml">{`# .github/workflows/quorate.yml
name: Quorate — contract gate
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review-and-contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          quorate contract check \\
            --spec openapi.yml \\
            --base origin/main \\
            --head HEAD \\
            --gate
      - uses: UmutKorkmaz/quorate@1e7796b0f86cdbacadf149637c87b9812b246303
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}`}</CodeBlock>
      <p>
        If the contract check produces a <strong>BLOCK</strong> verdict, the run fails before the
        council review even starts — no wasted credits on a release that&apos;s already blocked.
      </p>
    </article>
  );
}
