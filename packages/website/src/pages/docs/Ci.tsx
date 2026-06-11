import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

const HEURISTICS = [
  {
    title: "pull_request_target trigger",
    severity: "high",
    flags: "Workflow triggered by pull_request_target in .github/workflows — this event runs in the context of the base branch with write permissions and access to secrets; untrusted PR code can reach privileged steps if checkout or run steps are not carefully scoped."
  },
  {
    title: "Untrusted input in workflow expression",
    severity: "high",
    flags: "GitHub Actions expression referencing github.event.pull_request.* or github.event.issue.* interpolated directly into a run: step in .github/workflows — injecting untrusted event data into a shell command is a script-injection vector; use an intermediate env variable instead."
  },
  {
    title: "Action not pinned to a commit SHA",
    severity: "medium",
    flags: "Third-party action referenced by a mutable tag (e.g. @v2, @main) rather than a full commit SHA in .github/workflows — a tag can be moved or force-pushed; pinning to a SHA makes the build reproducible and immune to supply-chain tag rewrites."
  },
  {
    title: "Over-broad workflow permissions",
    severity: "medium",
    flags: "Workflow or job-level permissions block granting write access beyond what the job requires in .github/workflows — follow least-privilege; declare only the permissions the job actually needs."
  },
  {
    title: "Self-hosted runner",
    severity: "medium",
    flags: "Job assigned to a self-hosted runner in .github/workflows — self-hosted runners persist state between runs and may be accessible to untrusted forks; prefer GitHub-hosted runners for public repos or harden self-hosted environments accordingly."
  },
  {
    title: "Checks out untrusted PR head",
    severity: "high",
    flags: "Workflow checks out the PR head ref (refs/pull/*/head or github.event.pull_request.head.sha) and then runs build or test scripts from that checkout in .github/workflows — an attacker can modify build scripts in the PR to run arbitrary code in the runner."
  },
  {
    title: "Install script added",
    severity: "medium",
    flags: "New install.sh, setup.sh, or similar script added — install scripts that are downloaded and executed without integrity verification are a common supply-chain attack vector; pin, sign, or hash any installer consumed downstream."
  },
  {
    title: "Hardcoded registry or auth token",
    severity: "high",
    flags: "Registry URL or authentication token hardcoded in a workflow file, Dockerfile, or package manager config — credentials embedded in source are exposed in the repository history; use GitHub Secrets and reference them via env variables."
  },
  {
    title: "Pipe-to-shell of a remote script",
    severity: "high",
    flags: "curl | bash, wget | sh, or equivalent pattern in .github/workflows, Makefile, or shell scripts — executing a remote script without verification blindly trusts a remote server; verify the download's checksum or signature before execution."
  },
  {
    title: "Unpinned base image or remote ADD",
    severity: "medium",
    flags: "Dockerfile FROM instruction using a mutable tag (e.g. :latest, :22.04) rather than a digest, or ADD/COPY fetching from a remote URL — mutable tags can pull different content on each build; pin base images to a digest and avoid remote ADD in production images."
  }
] as const;

export default function Ci() {
  return (
    <article className="doc-page">
      <h1>CI/CD &amp; Supply Chain</h1>
      <p className="lead">
        The CI pack brings a workflow-security and supply-chain-aware council and deterministic
        heuristics to Quorate. Zero-setup static checks catch the most common misconfiguration,
        injection, and dependency-integrity patterns before any model is called, and a dedicated
        council — covering workflow security, dependency integrity, secrets exposure, build
        provenance, and maintainability — layers semantic review on top.
      </p>

      <h2>Set up</h2>
      <p>
        Run <InlineCode>quorate init</InlineCode> with the CI pack to scaffold the config
        and role guidance in your repo:
      </p>
      <CodeBlock language="bash">{`quorate init --pack ci`}</CodeBlock>
      <p>
        This writes a <InlineCode>.quorate.yml</InlineCode> that includes five councils
        pre-configured for CI/CD and supply-chain work:
      </p>
      <ul>
        <li>
          <strong>workflow-security</strong> — pull_request_target misuse, script-injection via
          untrusted event expressions, over-broad permissions, and unsafe checkouts of PR heads
        </li>
        <li>
          <strong>dependency-integrity</strong> — unpinned third-party actions, mutable base
          images, remote ADD in Dockerfiles, and package-manager configs that lack lockfile
          verification
        </li>
        <li>
          <strong>secrets-exposure</strong> — hardcoded registry credentials, API tokens committed
          to source, pipe-to-shell patterns that bypass integrity checks, and install scripts that
          are fetched and executed without verification
        </li>
        <li>
          <strong>build-provenance</strong> — reproducibility of builds, self-hosted runner risks,
          artifact signing, and SLSA-alignment of the delivery pipeline
        </li>
        <li>
          <strong>maintainer</strong> — workflow structure, job naming, step documentation,
          caching hygiene, and long-term runner compatibility
        </li>
      </ul>
      <p>
        Each council role ships with reviewer guidance tuned to GitHub Actions idioms and
        supply-chain threat models. Run <InlineCode>quorate packs</InlineCode> to see available
        packs and their bundled councils.
      </p>

      <h2>What it catches</h2>
      <p>
        The heuristic reviewer runs with zero setup — no model, no API key, no CLI install.
        It scans every added line in the diff against ten vulnerability classes drawn from
        common CI/CD and supply-chain audit findings. A real council (claude, codex, or any{" "}
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
        <InlineCode>quorate init --pack ci</InlineCode> to your base branch, add the workflow
        below, and set <InlineCode>OPENROUTER_API_KEY</InlineCode> in your repository secrets.
        The workflow uses <InlineCode>runner-mode: api</InlineCode> so it runs on a standard
        GitHub-hosted runner — no self-hosted machine needed.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml (base branch — generated by quorate init --pack ci)
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
    roles: [workflow-security, dependency-integrity, secrets-exposure, build-provenance, maintainer]`}</CodeBlock>
      <CodeBlock language="yaml">{`name: Quorate — CI/CD & supply-chain review
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
