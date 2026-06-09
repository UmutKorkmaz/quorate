// Auto-detected on PATH (type: cli) — the full built-in candidate list.
const LOCAL_CLIS = [
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

// Configured endpoints (type: api) — NOT auto-detected; added via provider add.
const LOCAL_SERVERS = ["Ollama", "LM Studio", "vLLM", "llama.cpp", "HF TGI"] as const;
const HOSTED = [
  "OpenAI",
  "HF Router",
  "OpenRouter",
  "LiteLLM",
  "Together",
  "Groq",
  "Fireworks",
  "DeepSeek",
  "Mistral",
  "Gemini"
] as const;

function Chip({ label, glyph, tone = "muted" }: { label: string; glyph: string; tone?: "muted" | "dim" }) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-quorate-border bg-quorate-surface/60 px-3 py-2 font-mono text-sm text-quorate-muted">
      <span className={tone === "dim" ? "text-quorate-dim" : "text-quorate-accent/70"} aria-hidden>
        {glyph}
      </span>
      {label}
    </li>
  );
}

export function ProviderStrip() {
  return (
    <section id="providers" className="relative px-6 py-16 md:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="reveal is-visible">
          <div className="mb-4 flex items-center gap-3">
            <span
              className="h-px w-6 rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, rgba(110,151,255,0.7), rgba(110,151,255,0.2))"
              }}
              aria-hidden
            />
            <p className="font-mono text-xs tracking-[0.2em] text-quorate-accent uppercase">
              Providers
            </p>
          </div>

          <h2 className="display-section text-3xl tracking-tight text-white md:text-4xl">
            The agents you have — and any model behind a URL
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-quorate-muted">
            Quorate auto-detects the agent CLIs on your machine, and seats <em>any</em>{" "}
            OpenAI-compatible endpoint beside them — a local model server or a hosted
            gateway. The built-in heuristic always shows up.
          </p>
        </div>

        {/* Local agent CLIs — auto-detected on PATH. */}
        <div className="reveal is-visible mt-12 rounded-2xl border border-quorate-border bg-quorate-surface/80 p-6 shadow-terminal backdrop-blur md:p-7">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-mono text-sm tracking-wide text-quorate-muted">Local agent CLIs</h3>
            <span className="font-mono text-xs text-quorate-dim">auto-detected on your PATH</span>
          </div>
          <ul className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            {LOCAL_CLIS.map((id) => (
              <Chip key={id} label={id} glyph="⌘" />
            ))}
          </ul>
          <p className="mt-4 text-sm leading-relaxed text-quorate-dim">
            Driven headless; some need a one-line profile in{" "}
            <code className="text-quorate-accent">.quorate.yml</code>.
          </p>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr_1fr]">
          {/* Local model servers — type: api, configured not detected. */}
          <div className="reveal is-visible rounded-2xl border border-quorate-border bg-quorate-surface/80 p-6 shadow-terminal backdrop-blur">
            <h3 className="font-mono text-sm tracking-wide text-quorate-muted">Local model servers</h3>
            <span className="font-mono text-xs text-quorate-dim">OpenAI-compatible /v1</span>
            <ul className="mt-5 grid grid-cols-2 gap-2.5">
              {LOCAL_SERVERS.map((id) => (
                <Chip key={id} label={id} glyph="⊹" tone="dim" />
              ))}
            </ul>
          </div>

          {/* Hosted gateways — type: api. */}
          <div className="reveal is-visible rounded-2xl border border-quorate-border bg-quorate-surface/80 p-6 shadow-terminal backdrop-blur">
            <h3 className="font-mono text-sm tracking-wide text-quorate-muted">Hosted gateways &amp; APIs</h3>
            <span className="font-mono text-xs text-quorate-dim">any OpenAI-compatible endpoint</span>
            <ul className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {HOSTED.map((id) => (
                <Chip key={id} label={id} glyph="⊹" tone="dim" />
              ))}
            </ul>
          </div>

          {/* Always-on built-in heuristic. */}
          <div className="reveal is-visible flex flex-col rounded-2xl border border-quorate-amber/40 bg-quorate-amber/[0.06] p-6 shadow-terminal backdrop-blur">
            <h3 className="font-mono text-sm tracking-wide text-quorate-amber">Always on</h3>
            <span className="font-mono text-xs text-quorate-amber/70">zero setup</span>
            <div className="mt-5 flex items-center gap-2 self-start rounded-lg border border-quorate-amber/40 bg-quorate-amber/10 px-3 py-2 font-mono text-sm text-quorate-amber">
              <span aria-hidden>◆</span>
              heuristic
            </div>
            <p className="mt-4 text-sm leading-relaxed text-quorate-dim">
              Built-in reviewer, no key or agent needed — so a review is always{" "}
              <span className="text-quorate-degraded">honest</span>, never falsely green.
            </p>
          </div>
        </div>

        <p className="mt-6 font-mono text-sm text-quorate-dim">
          CLIs: spawned without a shell, headless args only, byte + time caps · APIs:{" "}
          <code className="text-quorate-accent">quorate provider add --preset</code>, keys stay in env vars
        </p>
      </div>
    </section>
  );
}
