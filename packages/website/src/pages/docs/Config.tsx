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
  --api-key-env VLLM_API_KEY --roles security,architect`}</CodeBlock>
      <p>
        Presets: <InlineCode>ollama</InlineCode>, <InlineCode>lmstudio</InlineCode>,{" "}
        <InlineCode>vllm</InlineCode>, <InlineCode>llamacpp</InlineCode>,{" "}
        <InlineCode>hf-router</InlineCode>, <InlineCode>openrouter</InlineCode>.
      </p>

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
        tokens (a fixed denylist) are rejected unless a profile sets{" "}
        <InlineCode>allowDangerousArgs</InlineCode>. Alternatively, give a profile a{" "}
        <InlineCode>headlessAllowlist</InlineCode> and only those flags are permitted — that path replaces
        the denylist entirely.
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