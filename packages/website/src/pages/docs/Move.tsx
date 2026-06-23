import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

const HEURISTICS = [
  {
    title: "Public entry function",
    severity: "medium",
    flags: "Public entry function in .move — entry functions are callable by any account on-chain; ensure all inputs are validated and that the function is intentionally exposed."
  },
  {
    title: "Global storage mutated without owner check",
    severity: "medium",
    flags: "Global storage write (move_to / borrow_global_mut) without a signer ownership assertion in .move — mutating another account's resource without an owner check is a privilege-escalation path."
  },
  {
    title: "Resource removed from storage",
    severity: "medium",
    flags: "move_from call in .move — removing a resource from global storage is irreversible; confirm the resource is destroyed or transferred correctly to prevent loss."
  },
  {
    title: "Object shared publicly",
    severity: "medium",
    flags: "transfer::share_object call in .move (Sui) — sharing an object makes it accessible to any transaction; verify that shared-object access is intentional and that concurrent mutations are safe."
  },
  {
    title: "Struct has copy ability",
    severity: "medium",
    flags: "Struct with copy ability in .move — a copyable resource can be duplicated silently, undermining uniqueness invariants. Reserve copy for pure value types; avoid it on assets or capability structs."
  },
  {
    title: "Integer downcast (truncation)",
    severity: "low",
    flags: "Explicit cast to a narrower integer type (as u8 / as u64 etc.) in .move — narrowing casts silently truncate the high bits; verify the value fits the target type or assert the range explicitly."
  },
  {
    title: "Unguarded privileged function",
    severity: "medium",
    flags: "Function that uses a Capability or AdminCap without asserting the caller owns it in .move — capability-gated operations must check object ownership before proceeding."
  },
  {
    title: "Unchecked vector index",
    severity: "low",
    flags: "vector::borrow or vector index access without a prior length guard in .move — out-of-bounds access aborts the transaction; validate the index against vector::length before dereferencing."
  },
  {
    title: "Key resource has drop ability",
    severity: "medium",
    flags: "Struct marked key and drop in .move — a droppable key resource can be silently discarded, bypassing expected cleanup logic. Key resources representing assets should not have the drop ability."
  },
  {
    title: "Initializer/admin entrypoint",
    severity: "low",
    flags: "Function named init, initialize, setup, or set_admin in .move — one-time initializers must be callable only once; confirm they are guarded against re-invocation."
  }
] as const;

export default function Move() {
  return (
    <article className="doc-page">
      <h1>Move (Sui / Aptos)</h1>
      <p className="lead">
        The Move pack brings a Sui/Aptos-aware security council and deterministic heuristics to
        Quorate. Zero-setup static checks catch the most common resource-safety, capability, and
        access-control patterns before any model is called, and a dedicated council — covering
        move security, capability safety, resource safety, access control, and maintainability
        — layers semantic review on top.
      </p>

      <h2>Set up</h2>
      <p>
        Run <InlineCode>quorate init</InlineCode> with the Move pack to scaffold the config
        and role guidance in your repo:
      </p>
      <CodeBlock language="bash">{`quorate init --pack move`}</CodeBlock>
      <p>
        This writes a <InlineCode>.quorate.yml</InlineCode> that includes five councils
        pre-configured for Move smart-contract work:
      </p>
      <ul>
        <li>
          <strong>move-security</strong> — public entry points, global storage mutations, resource
          removal, and Sui shared-object patterns
        </li>
        <li>
          <strong>capability-safety</strong> — capability struct design, AdminCap / OwnerCap
          ownership checks, unguarded privileged functions, and capability leakage paths
        </li>
        <li>
          <strong>resource-safety</strong> — Move linear-type invariants, structs with copy or drop
          abilities on assets, key resources that can be silently discarded, and one-shot
          initializers that lack re-invocation guards
        </li>
        <li>
          <strong>access-control</strong> — signer-based authorization, object-ownership assertions
          before mutations, and patterns that allow an unprivileged caller to reach privileged paths
        </li>
        <li>
          <strong>maintainer</strong> — module structure, test coverage, error-code conventions,
          upgrade compatibility, and documentation of resource invariants
        </li>
      </ul>
      <p>
        Each council role ships with reviewer guidance tuned to Move language idioms. Run{" "}
        <InlineCode>quorate packs</InlineCode> to see available packs and their bundled councils.
      </p>

      <h2>What it catches</h2>
      <p>
        The heuristic reviewer runs with zero setup — no model, no API key, no CLI install.
        It scans every added line in the diff against ten vulnerability classes drawn from
        common Move / Sui / Aptos audit findings. A real council (claude, codex, or any{" "}
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
        <InlineCode>quorate init --pack move</InlineCode> to your base branch, add the workflow
        below, and set <InlineCode>OPENROUTER_API_KEY</InlineCode> in your repository secrets.
        The workflow uses <InlineCode>runner-mode: api</InlineCode> so it runs on a standard
        GitHub-hosted runner — no self-hosted machine needed.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml (base branch — generated by quorate init --pack move)
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
    roles: [move-security, capability-safety, resource-safety, access-control, maintainer]`}</CodeBlock>
      <CodeBlock language="yaml">{`name: Quorate — Move review
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
