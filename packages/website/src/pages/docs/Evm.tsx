import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

const HEURISTICS = [
  {
    title: "tx.origin authorization",
    severity: "high",
    flags: "tx.origin used in require() or if() for authorization in .sol — phishable via malicious intermediary contracts"
  },
  {
    title: "Delegatecall to untrusted target",
    severity: "high",
    flags: "delegatecall to a variable or externally-supplied address in .sol — caller storage can be overwritten by attacker-controlled logic"
  },
  {
    title: "Selfdestruct present",
    severity: "high",
    flags: "selfdestruct() call in .sol — permanently destroys the contract and forwards all Ether; deprecated post-Cancun and a frequent upgrade footgun"
  },
  {
    title: "Inline assembly",
    severity: "medium",
    flags: "assembly { … } block in .sol — bypasses Solidity type safety and gas checks; requires manual correctness audit"
  },
  {
    title: "Block timestamp / number dependence",
    severity: "medium",
    flags: "block.timestamp or block.number used as randomness or expiry source in .sol — validator-manipulable within a ~12 s window"
  },
  {
    title: "Unbounded loop over dynamic array",
    severity: "medium",
    flags: "for loop iterating over a storage array with no fixed upper bound in .sol — grows unbounded and risks block gas limit DoS"
  },
  {
    title: "Floating pragma",
    severity: "low",
    flags: "pragma solidity ^x.y.z or >=x.y.z without an upper cap in .sol — contract may be compiled with a future compiler that changes semantics"
  },
  {
    title: "Ether send via low-level call",
    severity: "medium",
    flags: ".call{value: …}('') used to transfer Ether in .sol without a reentrancy guard — open to single-function and cross-function reentrancy"
  },
  {
    title: "Unchecked low-level call return",
    severity: "medium",
    flags: "return value of .call(), .delegatecall(), or .staticcall() not checked in .sol — silent failure masks reverts in sub-calls"
  },
  {
    title: "Unchecked ERC20 transfer return",
    severity: "medium",
    flags: "transfer() or transferFrom() return value not checked in .sol — non-standard tokens that return false instead of reverting will silently fail"
  }
] as const;

export default function Evm() {
  return (
    <article className="doc-page">
      <h1>EVM / Solidity</h1>
      <p className="lead">
        The EVM pack brings a Solidity-aware review council and deterministic on-chain
        heuristics to Quorate. Zero-setup static checks catch the most common smart-contract
        vulnerability classes before a single model is called, and a dedicated council —
        covering security, access control, reentrancy, external calls, upgrade safety, and
        maintainability — layers semantic review on top.
      </p>

      <h2>Set up</h2>
      <p>
        Run <InlineCode>quorate init</InlineCode> with the EVM pack to scaffold the config
        and role guidance in your repo:
      </p>
      <CodeBlock language="bash">{`quorate init --pack evm`}</CodeBlock>
      <p>
        This writes a <InlineCode>.quorate.yml</InlineCode> that includes six councils
        pre-configured for EVM / Solidity work:
      </p>
      <ul>
        <li>
          <strong>evm-security</strong> — authorization patterns, tx.origin, selfdestruct, and
          assembly usage
        </li>
        <li>
          <strong>access-control</strong> — role management, ownership transfers, and privileged
          function guards
        </li>
        <li>
          <strong>reentrancy</strong> — CEI pattern enforcement, reentrancy guards, and
          cross-function call ordering
        </li>
        <li>
          <strong>external-calls</strong> — low-level call return values, delegatecall targets,
          and ERC20 transfer safety
        </li>
        <li>
          <strong>upgrade-safety</strong> — storage layout stability, initializer guards, and
          implementation slot hygiene
        </li>
        <li>
          <strong>maintainer</strong> — pragma pinning, natspec coverage, gas footprint, and
          test coverage hygiene
        </li>
      </ul>
      <p>
        Each council role ships with reviewer guidance tuned to EVM / Solidity idioms. Run{" "}
        <InlineCode>quorate packs</InlineCode> to see available packs and their bundled councils.
      </p>

      <h2>What it catches</h2>
      <p>
        The heuristic reviewer runs with zero setup — no model, no API key, no CLI install.
        It scans every added line in the diff against ten vulnerability classes drawn from the
        EVM / Solidity security canon. A real council (claude, codex, or any{" "}
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
        <InlineCode>quorate init --pack evm</InlineCode> to your base branch, add the workflow
        below, and set <InlineCode>OPENROUTER_API_KEY</InlineCode> in your repository secrets.
        The workflow uses <InlineCode>runner-mode: api</InlineCode> so it runs on a standard
        GitHub-hosted runner — no self-hosted machine needed.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml (base branch — generated by quorate init --pack evm)
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
    roles: [evm-security, access-control, reentrancy, external-calls, upgrade-safety, maintainer]`}</CodeBlock>
      <CodeBlock language="yaml">{`name: Quorate — EVM review
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
