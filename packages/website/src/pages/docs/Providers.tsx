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
        Quorate detects agent CLIs on your machine and runs the ones you enable in headless mode —
        no API keys required.
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