import { CodeBlock } from "../../components/CodeBlock";

import { InlineCode } from "../../components/InlineCode";

export default function Config() {
  return (
    <article className="doc-page">
      <h1>Configuration</h1>
      <p className="lead">
        Tune council roles, enable providers, and set safety limits in <InlineCode>.quorate.yml</InlineCode>.
      </p>

      <CodeBlock>{`quorate init        # writes a starter .quorate.yml (real providers disabled)`}</CodeBlock>

      <p>Then enable only the providers you trust, with explicit headless arguments:</p>

      <CodeBlock language="yaml">{`councils: [architect, security, qa, performance, maintainer]
providers:
  - id: heuristic
    type: mock
    enabled: true
  - id: codex
    type: cli
    enabled: true
    inputMode: stdin
    roles: [maintainer, qa]
    args: ["exec", "--sandbox", "read-only", "-"]`}</CodeBlock>

      <h2>Routing roles to agents (and models)</h2>
      <p>
        A provider's <InlineCode>roles:</InlineCode> array <strong>is</strong> the role→provider
        map. The council runs one lane per <InlineCode>(provider, role)</InlineCode> pair, so a single
        agent can cover several roles, and two agents can split the council between them.
      </p>
      <CodeBlock language="yaml">{`providers:
  - id: claude
    type: cli
    enabled: true
    roles: [architect, security]   # claude reviews as BOTH

  - id: codex
    type: cli
    enabled: true
    roles: [maintainer, qa]        # codex covers the other two

  - id: gpt4o
    type: api
    enabled: true
    model: gpt-4o                   # one model for performance
    roles: [performance]

  - id: gpt4o-mini
    type: api
    enabled: true
    model: gpt-4o-mini             # a cheaper model for a different role
    roles: [qa]`}</CodeBlock>
      <p>
        Per-role model differences come from <strong>distinct providers</strong>: CLI agents share a
        single local authentication, and each <InlineCode>type: api</InlineCode> provider sets its own{" "}
        <InlineCode>model:</InlineCode>. Define two providers and assign each the roles you want. In the
        shell, <InlineCode>/route &lt;role&gt; &lt;providers...&gt;</InlineCode> remixes this routing for
        one session (<InlineCode>/route reset</InlineCode> restores the config).
      </p>

      <h2>Provider types</h2>
      <p>
        Each provider has a <InlineCode>type</InlineCode>:
      </p>
      <ul>
        <li>
          <InlineCode>cli</InlineCode> — drive a local agent CLI in headless mode.
        </li>
        <li>
          <InlineCode>api</InlineCode> — call any OpenAI-compatible HTTP endpoint.
        </li>
        <li>
          <InlineCode>mock</InlineCode> — the built-in <InlineCode>heuristic</InlineCode> reviewer.
        </li>
      </ul>

      <h2>Local &amp; hosted API models</h2>
      <p>
        A <InlineCode>type: api</InlineCode> provider calls any OpenAI-compatible endpoint — a local
        server (Ollama, llama.cpp, LM Studio, vLLM) or a hosted gateway. No CLI required.
      </p>
      <CodeBlock language="yaml">{`providers:
  - id: local-llama
    type: api
    enabled: true
    baseUrl: http://localhost:11434/v1   # any OpenAI-compatible /v1 base
    model: llama3.1                       # required for api providers
    apiKeyEnv: OPENAI_API_KEY             # optional: key read from this env var
    roles: [qa, maintainer]`}</CodeBlock>
      <p>
        <InlineCode>model</InlineCode> is required. <InlineCode>baseUrl</InlineCode> is optional and
        defaults to <InlineCode>http://localhost:11434/v1</InlineCode>, and any key is read from the
        named environment variable — never stored in the file.
      </p>
      <p>
        Or let the CLI write the entry for you with{" "}
        <InlineCode>quorate provider add</InlineCode> (presets for the common endpoints —{" "}
        <InlineCode>quorate provider presets</InlineCode> lists them):
      </p>
      <CodeBlock language="bash">{`quorate provider add ollama --preset ollama --model qwen2.5-coder:7b
quorate provider add reviewer --type api \\
  --base-url http://localhost:8000/v1 --model Qwen/Qwen2.5-Coder-32B-Instruct \\
  --api-key-env VLLM_API_KEY --roles security,architect
quorate provider test reviewer --json`}</CodeBlock>
      <p>
        16 presets — local servers (<InlineCode>ollama</InlineCode>,{" "}
        <InlineCode>lmstudio</InlineCode>, <InlineCode>vllm</InlineCode>,{" "}
        <InlineCode>llamacpp</InlineCode>, <InlineCode>tgi</InlineCode>,{" "}
        <InlineCode>litellm</InlineCode>) and hosted gateways (<InlineCode>hf-router</InlineCode>,{" "}
        <InlineCode>openrouter</InlineCode>, <InlineCode>openai</InlineCode>,{" "}
        <InlineCode>together</InlineCode>, <InlineCode>groq</InlineCode>,{" "}
        <InlineCode>fireworks</InlineCode>, <InlineCode>deepseek</InlineCode>,{" "}
        <InlineCode>mistral</InlineCode>, <InlineCode>gemini</InlineCode>,{" "}
        <InlineCode>zai</InlineCode>).
      </p>

      <h2>Budget guardrails</h2>
      <p>
        Add a <InlineCode>budget</InlineCode> block to stop oversized reviews before any
        provider call. Reports include the resulting file, line, token, and priced-input summary.
      </p>
      <CodeBlock language="yaml">{`budget:
  maxFiles: 40
  maxChangedLines: 1200
  maxCostUsd: 0.50
  skipGenerated: true

providers:
  - id: reviewer
    type: api
    model: vendor/model
    baseUrl: https://api.example.test/v1
    apiKeyEnv: REVIEWER_KEY
    cost:
      inputUsdPer1M: 0.20`}</CodeBlock>

      <h2>Optional Webacy/DD.xyz evidence</h2>
      <p>
        <InlineCode>integrations.webacy</InlineCode> enables the Web3 DD pack to query
        DD.xyz/Webacy for extracted addresses and URLs. It is not a model provider and does not
        change your AI routing; the API key is read from an environment variable.
      </p>
      <CodeBlock language="yaml">{`integrations:
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
      ttlHours: 24`}</CodeBlock>
      <p>
        In GitHub Actions, pass <InlineCode>WEBACY_API_KEY</InlineCode> through
        <InlineCode>env</InlineCode>. Quorate sends extracted indicators only, not the full source
        file or full diff.
      </p>

      <h2>Custom packs</h2>
      <p>
        Workspace packs in <InlineCode>.quorate/packs/*.yml</InlineCode> can add council
        roles, role guidance, and regex heuristics. They load only when you opt in with{" "}
        <InlineCode>QUORATE_TRUST_WORKSPACE=1</InlineCode> (the same gate as custom slash commands
        in <InlineCode>.quorate/commands/</InlineCode>). In GitHub Actions they are loaded from the
        pull request base ref, never from the PR head.
      </p>
      <CodeBlock language="bash">{`quorate pack scaffold org-rules
git add -f .quorate/packs/org-rules.yml
quorate pack list --json`}</CodeBlock>

      <h2>Hosted gateways at a glance</h2>
      <p>
        Every hosted preset is the same three fields — a <InlineCode>baseUrl</InlineCode>, a{" "}
        <InlineCode>model</InlineCode>, and the env var holding the key. Pick a row, drop in your
        key, and you have real model review. The example models are starting points — run{" "}
        <InlineCode>quorate provider models &lt;preset&gt;</InlineCode> for the live catalog.
      </p>
      <table>
        <thead>
          <tr>
            <th>Preset</th>
            <th>
              <code>baseUrl</code>
            </th>
            <th>Example model</th>
            <th>
              <code>apiKeyEnv</code>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <InlineCode>openrouter</InlineCode>
            </td>
            <td>
              <InlineCode>https://openrouter.ai/api/v1</InlineCode>
            </td>
            <td>
              <InlineCode>anthropic/claude-sonnet-4.6</InlineCode>
            </td>
            <td>
              <InlineCode>OPENROUTER_API_KEY</InlineCode>
            </td>
          </tr>
          <tr>
            <td>
              <InlineCode>openai</InlineCode>
            </td>
            <td>
              <InlineCode>https://api.openai.com/v1</InlineCode>
            </td>
            <td>
              <InlineCode>gpt-4o</InlineCode>
            </td>
            <td>
              <InlineCode>OPENAI_API_KEY</InlineCode>
            </td>
          </tr>
          <tr>
            <td>
              <InlineCode>deepseek</InlineCode>
            </td>
            <td>
              <InlineCode>https://api.deepseek.com</InlineCode>
            </td>
            <td>
              <InlineCode>deepseek-chat</InlineCode>
            </td>
            <td>
              <InlineCode>DEEPSEEK_API_KEY</InlineCode>
            </td>
          </tr>
          <tr>
            <td>
              <InlineCode>groq</InlineCode>
            </td>
            <td>
              <InlineCode>https://api.groq.com/openai/v1</InlineCode>
            </td>
            <td>
              <InlineCode>llama-3.3-70b-versatile</InlineCode>
            </td>
            <td>
              <InlineCode>GROQ_API_KEY</InlineCode>
            </td>
          </tr>
          <tr>
            <td>
              <InlineCode>gemini</InlineCode>
            </td>
            <td>
              <InlineCode>…/v1beta/openai</InlineCode>
            </td>
            <td>
              <InlineCode>gemini-2.0-flash</InlineCode>
            </td>
            <td>
              <InlineCode>GEMINI_API_KEY</InlineCode>
            </td>
          </tr>
          <tr>
            <td>
              <InlineCode>zai</InlineCode> (GLM)
            </td>
            <td>
              <InlineCode>https://api.z.ai/api/coding/paas/v4</InlineCode>
            </td>
            <td>
              <InlineCode>glm-5.1</InlineCode>
            </td>
            <td>
              <InlineCode>ZAI_API_KEY</InlineCode>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Worked example — wire up Z.ai&apos;s GLM-5.1, then run the council on it. Swap the preset
        and model for any row above and the steps are identical:
      </p>
      <CodeBlock language="bash">{`export ZAI_API_KEY=…                    # your key, never written to the file
quorate provider add glm --preset zai   # writes the entry to .quorate.yml
quorate review                          # GLM-5.1 reviews as architect/security/performance`}</CodeBlock>

      <h2>Provider safety fields</h2>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>type</code>, <code>enabled</code>, <code>roles</code>
            </td>
            <td>
              Provider kind (<InlineCode>cli</InlineCode>/<InlineCode>api</InlineCode>/
              <InlineCode>mock</InlineCode>), whether it runs, and which council roles it covers.
            </td>
          </tr>
          <tr>
            <td>
              <code>command</code>
            </td>
            <td>
              The executable for <InlineCode>cli</InlineCode> providers (defaults to the provider{" "}
              <InlineCode>id</InlineCode>).
            </td>
          </tr>
          <tr>
            <td>
              <code>baseUrl</code>, <code>model</code>, <code>apiKeyEnv</code>
            </td>
            <td>
              <InlineCode>api</InlineCode> providers only: endpoint base, model id (required), and the
              env var holding the key.
            </td>
          </tr>
          <tr>
            <td>
              <code>args</code>
            </td>
            <td>Command arguments; empty args are refused (no interactive sessions).</td>
          </tr>
          <tr>
            <td>
              <code>inputMode</code>
            </td>
            <td>
              <InlineCode>stdin</InlineCode>, <InlineCode>prompt-file</InlineCode>, or <InlineCode>none</InlineCode>.
            </td>
          </tr>
          <tr>
            <td>
              <code>headlessAllowlist</code>
            </td>
            <td>Optional per-provider allowlist of permitted flags.</td>
          </tr>
          <tr>
            <td>
              <code>timeoutMs</code>, <code>killGraceMs</code>
            </td>
            <td>Runtime cap and forced-kill grace period.</td>
          </tr>
          <tr>
            <td>
              <code>maxInputBytes</code>, <code>maxOutputBytes</code>
            </td>
            <td>Prompt/output caps before a provider is refused or killed.</td>
          </tr>
          <tr>
            <td>
              <code>{"{promptFile}"}</code>, <code>{"{diffFile}"}</code>, <code>{"{role}"}</code>,{" "}
              <code>{"{subject}"}</code>
            </td>
            <td>Placeholders expanded in args.</td>
          </tr>
        </tbody>
      </table>

      <h2>Dangerous flags</h2>
      <p>
        Session/resume flags and <InlineCode>--yolo</InlineCode>/<InlineCode>--dangerously</InlineCode>-style
        tokens are rejected by boundary-prefix matching (catches{" "}
        <InlineCode>--dangerously-skip-permissions</InlineCode> and similar) unless a profile sets{" "}
        <InlineCode>allowDangerousArgs</InlineCode>. Alternatively, give a profile a{" "}
        <InlineCode>headlessAllowlist</InlineCode> and only those flags are permitted — that path replaces
        the boundary-prefix denylist entirely.
      </p>

      <h2>Config file locations</h2>
      <p>Quorate looks for config in this order:</p>
      <ul>
        <li>
          <InlineCode>.quorate.yml</InlineCode>
        </li>
        <li>
          <InlineCode>.quorate.yaml</InlineCode>
        </li>
        <li>
          <InlineCode>quorate.config.yml</InlineCode>
        </li>
      </ul>
      <p>
        In the shell, run <InlineCode>/settings</InlineCode> to view the active configuration.
      </p>
    </article>
  );
}
