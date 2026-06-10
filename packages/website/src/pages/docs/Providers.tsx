import { Link } from "react-router-dom";
import { CodeBlock } from "../../components/CodeBlock";

import { InlineCode } from "../../components/InlineCode";

const PROVIDERS = [
  "claude",
  "codex",
  "agy",
  "hermes",
  "kimi",
  "qwen",
  "minimax",
  "opencode",
  "kilo",
  "droid",
  "crush",
  "cline",
  "goose",
  "copilot",
  "grok",
  "agent",
  "ollama"
] as const;

export default function Providers() {
  return (
    <article className="docs-content">
      <h1>Providers</h1>
      <p className="lead">
        Quorate detects local agent CLIs, runs only the providers you enable, and keeps the built-in
        heuristic reviewer available when no external agent is configured.
      </p>

      <h2>Detected CLIs</h2>
      <p className="provider-strip">
        {PROVIDERS.map((name) => (
          <InlineCode key={name}>{name}</InlineCode>
        ))}
      </p>

      <h2>Heuristic (default)</h2>
      <p>
        The default provider is <InlineCode>heuristic</InlineCode> — four fast static checks (focused
        tests, hard-coded secrets, stray <InlineCode>console.log</InlineCode>, TODO/FIXME). It needs no
        setup and never calls an external tool.
      </p>
      <p>
        A heuristic-only review is always reported as <strong>degraded</strong>, never a confident green
        — in the shell, Markdown report, and PR comment alike.
      </p>

      <h2>API &amp; local models</h2>
      <p>
        Beyond local CLIs, a <InlineCode>type: api</InlineCode> provider calls any OpenAI-compatible
        endpoint — a local server (Ollama, llama.cpp, LM Studio, vLLM) or a hosted gateway. Set{" "}
        <InlineCode>model</InlineCode> (required); <InlineCode>baseUrl</InlineCode> is optional and
        defaults to <InlineCode>http://localhost:11434/v1</InlineCode>, and an optional{" "}
        <InlineCode>apiKeyEnv</InlineCode> names the env var holding the key. See{" "}
        <Link to="/docs/config">configuration</Link>.
      </p>
      <p>
        Assign a provider to council voices with <InlineCode>roles:</InlineCode>. The same agent can
        hold several roles; for different models per role, define separate providers (for example two{" "}
        <InlineCode>type: api</InlineCode> entries with different <InlineCode>model:</InlineCode>) and
        give each the roles you want — see{" "}
        <Link to="/docs/config">routing roles to agents</Link>. In the shell,{" "}
        <InlineCode>/route</InlineCode> remixes this routing for one session.
      </p>

      <h2>Add a provider from the CLI</h2>
      <p>
        <InlineCode>quorate provider add</InlineCode> writes the entry to{" "}
        <InlineCode>.quorate.yml</InlineCode> for you — with presets for the common endpoints
        (<InlineCode>quorate provider presets</InlineCode> lists them):
      </p>
      <CodeBlock language="bash">{`quorate provider add local --preset ollama   # picks the model from the LIVE list
quorate provider add reviewer --type api \\
  --base-url http://localhost:8000/v1 --model Qwen/Qwen2.5-Coder-32B-Instruct \\
  --api-key-env VLLM_API_KEY --roles security,architect
quorate provider remove reviewer`}</CodeBlock>
      <p>
        15 presets: <InlineCode>ollama</InlineCode>, <InlineCode>lmstudio</InlineCode>,{" "}
        <InlineCode>vllm</InlineCode>, <InlineCode>llamacpp</InlineCode>, <InlineCode>tgi</InlineCode>,{" "}
        <InlineCode>litellm</InlineCode>, <InlineCode>hf-router</InlineCode>,{" "}
        <InlineCode>openrouter</InlineCode>, <InlineCode>openai</InlineCode>,{" "}
        <InlineCode>together</InlineCode>, <InlineCode>groq</InlineCode>,{" "}
        <InlineCode>fireworks</InlineCode>, <InlineCode>deepseek</InlineCode>,{" "}
        <InlineCode>mistral</InlineCode>, <InlineCode>gemini</InlineCode>. After a run,{" "}
        <InlineCode>/logs &lt;provider:role&gt;</InlineCode> shows each agent&apos;s full output.
      </p>

      <h2>Pick models from the live list</h2>
      <p>
        Every preset speaks the OpenAI-compatible <InlineCode>GET {"{baseUrl}"}/models</InlineCode>,
        so Quorate lists what&apos;s actually available — your local Ollama models, OpenRouter&apos;s
        public catalog, or a gateway&apos;s models once its key env is set — instead of making you
        type model names:
      </p>
      <CodeBlock language="bash">{`quorate provider models ollama       # list a preset's or provider's live models
quorate provider models groq --json  # machine-readable
quorate provider set-model local     # switch a provider's model — numbered picker`}</CodeBlock>
      <p>
        In the shell, <InlineCode>/models &lt;provider&gt;</InlineCode> lists and{" "}
        <InlineCode>/models &lt;provider&gt; &lt;model&gt;</InlineCode> switches the model for the
        session.
      </p>

      <h2>Enable for a session</h2>
      <CodeBlock language="text">{`/providers
/use available`}</CodeBlock>

      <h2>Terminal &amp; theming</h2>
      <ul>
        <li>
          <InlineCode>NO_COLOR</InlineCode> — disable all color (per{" "}
          <a href="https://no-color.org" target="_blank" rel="noreferrer">
            no-color.org
          </a>
          ).
        </li>
        <li>
          <InlineCode>FORCE_COLOR</InlineCode> — force color even when piped; <InlineCode>FORCE_COLOR=0</InlineCode>{" "}
          forces it off.
        </li>
        <li>
          <InlineCode>QUORATE_ASCII=1</InlineCode> — use plain-ASCII glyphs instead of the Unicode council set.
        </li>
      </ul>

      <h2>Enable in config</h2>
      <p>
        See <Link to="/docs/config">configuration</Link> for persisting providers in{" "}
        <InlineCode>.quorate.yml</InlineCode>.
      </p>
    </article>
  );
}
