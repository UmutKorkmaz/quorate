import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";
import { InlineCode } from "../../components/InlineCode";

const HEURISTICS = [
  {
    title: "Untrusted input interpolated into prompt",
    severity: "medium",
    flags: "User-controlled string concatenated directly into a prompt template in .py/.ts/.js — unsanitised user input in a prompt is the primary vector for prompt-injection attacks"
  },
  {
    title: "Model output passed to code execution",
    severity: "critical",
    flags: "LLM response string passed to eval(), exec(), Function(), or subprocess in .py/.ts/.js — executing model output as code enables remote code execution if the model is manipulated"
  },
  {
    title: "Model output rendered as unsanitized HTML",
    severity: "high",
    flags: "LLM response assigned to innerHTML, dangerouslySetInnerHTML, or document.write in .ts/.tsx/.js — unsanitised HTML from a model can carry attacker-injected scripts into the browser"
  },
  {
    title: "Unvalidated tool-call arguments",
    severity: "medium",
    flags: "Tool or function-call handler that uses model-supplied arguments without schema validation in .py/.ts/.js — a manipulated model can supply malformed or adversarial arguments to tool handlers"
  },
  {
    title: "Hardcoded LLM API key",
    severity: "high",
    flags: "API key or token literal for an LLM provider (OpenAI, Anthropic, Cohere, etc.) assigned inline in .py/.ts/.js — keys in source control are trivially exfiltrated; use environment variables or a secrets manager"
  },
  {
    title: "LLM prompt/response logged",
    severity: "low",
    flags: "Full prompt or completion string passed to a logging call in .py/.ts/.js — prompts often carry user PII or confidential context that should not appear in log storage"
  },
  {
    title: "Model safety/moderation disabled",
    severity: "medium",
    flags: "Safety system prompt suppressed, moderation endpoint bypassed, or safe_mode / content_filter set to false/disabled in .py/.ts/.js — disabling guardrails exposes users to harmful outputs and may violate provider terms"
  },
  {
    title: "Secret or PII included in prompt",
    severity: "high",
    flags: "Environment variable value, password, or identifier pattern (email, SSN, credit card) concatenated into a prompt in .py/.ts/.js — sensitive data sent to a third-party model may be retained or logged by the provider"
  },
  {
    title: "Authorization decision based on model output",
    severity: "medium",
    flags: "Access control or permission check whose result depends directly on an LLM response string in .py/.ts/.js — a manipulated model can grant or deny access arbitrarily; authorisation must be enforced outside the model"
  },
  {
    title: "Untrusted external content fed into prompt",
    severity: "medium",
    flags: "Content fetched from a URL, file, or third-party API injected into a prompt without sanitisation in .py/.ts/.js — external content is an indirect prompt-injection surface that can hijack agent behaviour"
  }
] as const;

export default function LlmApp() {
  return (
    <article className="doc-page">
      <h1>AI / LLM apps</h1>
      <p className="lead">
        The LLM app pack brings an AI-application-aware security council and deterministic
        heuristics to Quorate. Zero-setup static checks catch the most common prompt-injection,
        data-leakage, and unsafe output patterns before a single model is called, and a dedicated
        council — covering prompt injection, data privacy, tool safety, output safety, model
        governance, and maintainability — layers semantic review on top. The pack maps to the
        risk categories addressed by the EU AI Act and OWASP LLM Top 10.
      </p>

      <h2>Set up</h2>
      <p>
        Run <InlineCode>quorate init</InlineCode> with the LLM app pack to scaffold the config
        and role guidance in your repo:
      </p>
      <CodeBlock language="bash">{`quorate init --pack llm`}</CodeBlock>
      <p>
        This writes a <InlineCode>.quorate.yml</InlineCode> that includes six councils
        pre-configured for AI and LLM application work:
      </p>
      <ul>
        <li>
          <strong>prompt-injection</strong> — direct and indirect injection vectors, user-controlled
          input in prompt templates, and external content ingestion paths
        </li>
        <li>
          <strong>data-privacy</strong> — PII and secrets in prompts, prompt/response logging,
          third-party model data retention, and GDPR/EU AI Act data minimisation obligations
        </li>
        <li>
          <strong>tool-safety</strong> — unvalidated tool-call arguments, capability scope creep,
          least-privilege agent design, and tool result trust boundaries
        </li>
        <li>
          <strong>output-safety</strong> — model output passed to code execution or rendered as
          unsanitised HTML, safety and moderation configuration, and hallucination risk in
          high-stakes output paths
        </li>
        <li>
          <strong>model-governance</strong> — hardcoded API keys, model version pinning,
          authorisation decisions that depend on model output, and observability of model
          calls in production
        </li>
        <li>
          <strong>maintainer</strong> — prompt template organisation, dependency hygiene,
          SDK version currency, and documentation of model assumptions
        </li>
      </ul>
      <p>
        Each council role ships with reviewer guidance tuned to LLM application idioms. Run{" "}
        <InlineCode>quorate packs</InlineCode> to see available packs and their bundled councils.
      </p>

      <h2>What it catches</h2>
      <p>
        The heuristic reviewer runs with zero setup — no model, no API key, no CLI install.
        It scans every added line in the diff against ten vulnerability classes drawn from the
        OWASP LLM Top 10 and EU AI Act risk taxonomy. A real council (claude, codex, or any{" "}
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
        <InlineCode>quorate init --pack llm</InlineCode> to your base branch, add the workflow
        below, and set <InlineCode>OPENROUTER_API_KEY</InlineCode> in your repository secrets.
        The workflow uses <InlineCode>runner-mode: api</InlineCode> so it runs on a standard
        GitHub-hosted runner — no self-hosted machine needed.
      </p>
      <CodeBlock language="yaml">{`# .quorate.yml (base branch — generated by quorate init --pack llm)
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
    roles: [prompt-injection, data-privacy, tool-safety, output-safety, model-governance, maintainer]`}</CodeBlock>
      <CodeBlock language="yaml">{`name: Quorate — LLM app review
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
