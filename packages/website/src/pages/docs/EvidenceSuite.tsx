import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

export default function EvidenceSuite() {
  return (
    <article className="doc-page">
      <h1>Evidence workflows</h1>
      <p className="lead">Verify release artifacts, inspect checks, and connect requirements to their evidence with explicit, repository-owned manifests.</p>
      <h2>Choose a workflow</h2>
      <table>
        <thead><tr><th>Workflow</th><th>What it establishes</th></tr></thead>
        <tbody>
          <tr><td>Release verification</td><td>Exact npm and GitHub artifacts match the selected identity and installation checks.</td></tr>
          <tr><td>Evidence inspection</td><td>Required checks have usable evidence for the expected revision and trust policy.</td></tr>
          <tr><td>Acceptance checks</td><td>Named requirements are demonstrated, contradicted, missing, or need human review.</td></tr>
          <tr><td>Executable docs</td><td>Explicit examples work against the selected source or published package.</td></tr>
          <tr><td>Architecture and impact</td><td>Imported dependencies reveal new violations and mapped consumer checks.</td></tr>
          <tr><td>Rules audit</td><td>Selected Claude and Cursor configurations have visible scope, conflicts, and support limits.</td></tr>
          <tr><td>Finding adjudication</td><td>Evidence belongs to the exact report and finding being assessed.</td></tr>
        </tbody>
      </table>
      <h2>Inspect evidence</h2>
      <p>Export only selected artifacts, then inspect the bundle with an explicit policy that pins the revision, required checks, and accepted content digests.</p>
      <CodeBlock language="bash">{`quorate evidence export --manifest evidence-inputs.json --output .quorate/evidence/demo --json
quorate evidence inspect --bundle .quorate/evidence/demo --policy evidence-policy.json --json`}</CodeBlock>
      <p>In VS Code, run <strong>Quorate: Inspect Evidence</strong>, select the bundle folder and policy file, and read the JSON result. Inspection does not execute imported commands.</p>
      <h2>Check requirements</h2>
      <CodeBlock language="bash">{`quorate acceptance check --spec acceptance.md --mapping acceptance-mapping.json --evidence .quorate/evidence/demo --policy evidence-policy.json --json`}</CodeBlock>
      <p>For pull requests, add <InlineCode>--base</InlineCode> with the trusted base commit. Requirements and mappings from that revision remain authoritative; a proposed change cannot remove its own obligations.</p>
      <h2>Verify distribution and documented examples</h2>
      <CodeBlock language="bash">{`quorate release verify --manifest release-manifest.json --json
quorate release status --report .quorate/releases/latest.json --json
quorate docs check --manifest docs-journey.json --json`}</CodeBlock>
      <p>Release verification preserves per-destination observations and a bounded recovery deadline. It creates no tags or published packages. Docs checks execute only the declared argv in disposable repositories and homes.</p>
      <h2>Audit architecture and agent rules</h2>
      <CodeBlock language="bash">{`quorate arch check --input dependencies.json --subject FULL_COMMIT_SHA --policy architecture-policy.json --json
quorate impact --input dependencies.json --subject FULL_COMMIT_SHA --policy architecture-policy.json --changed src/api.ts --json
quorate rules doctor --manifest rules-manifest.json --json`}</CodeBlock>
      <p>Architecture inspection uses an explicit dependency-cruiser envelope. Missing relationships remain unknown and may require the full suite. Recommended checks never disable existing CI. Rules audit reads selected files; it does not apply configuration or assert native enforcement from rule text.</p>
      <h2>Keep trust claims separate</h2>
      <p>Content integrity, producer identity, revision freshness, check outcomes, and requirement coverage are separate. An accepted digest establishes the selected bytes; it does not attest that a hosted runner executed them. Missing or inconclusive evidence remains visible.</p>
    </article>
  );
}
