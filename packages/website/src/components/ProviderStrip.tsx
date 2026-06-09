const LOCAL_AGENTS = [
  "claude",
  "codex",
  "grok",
  "kimi",
  "qwen",
  "minimax",
  "hermes",
  "agy",
  "opencode",
  "crush",
  "goose",
  "cline",
  "copilot",
  "ollama"
] as const;

export function ProviderStrip() {
  return (
    <section id="providers" className="relative px-6 py-16 md:py-20">
      <div className="mx-auto max-w-6xl">
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
          Drives the agents you already have
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-quorate-muted">
          Quorate auto-detects the agent CLIs on your machine and seats them on
          the council. Enable only the ones you trust — and the built-in
          heuristic reviewer always shows up.
        </p>

        <div className="reveal is-visible mt-12 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          {/* Local agents — the detected CLIs. */}
          <div className="rounded-2xl border border-quorate-border bg-quorate-surface/80 p-6 shadow-terminal backdrop-blur md:p-7">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-mono text-sm tracking-wide text-quorate-muted">
                Local agents
              </h3>
              <span className="font-mono text-xs text-quorate-dim">
                detected on your PATH
              </span>
            </div>
            <ul className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {LOCAL_AGENTS.map((agent) => (
                <li
                  key={agent}
                  className="flex items-center gap-2 rounded-lg border border-quorate-border bg-quorate-surface/60 px-3 py-2 font-mono text-sm text-quorate-muted"
                >
                  <span className="text-quorate-accent/70" aria-hidden>
                    ⌘
                  </span>
                  {agent}
                </li>
              ))}
            </ul>
          </div>

          {/* Always-on built-in heuristic. */}
          <div className="flex flex-col rounded-2xl border border-quorate-amber/40 bg-quorate-amber/[0.06] p-6 shadow-terminal backdrop-blur md:p-7">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-mono text-sm tracking-wide text-quorate-amber">
                Always on
              </h3>
              <span className="font-mono text-xs text-quorate-amber/70">
                zero setup
              </span>
            </div>
            <div className="mt-5 flex items-center gap-2 self-start rounded-lg border border-quorate-amber/40 bg-quorate-amber/10 px-3 py-2 font-mono text-sm text-quorate-amber">
              <span aria-hidden>◆</span>
              heuristic
            </div>
            <p className="mt-4 text-sm leading-relaxed text-quorate-dim">
              A built-in reviewer that runs with no API key and no agent
              installed — so the council is always quorate, even in honest{" "}
              <span className="text-quorate-degraded">degraded</span> mode.
            </p>
          </div>
        </div>

        <p className="mt-6 font-mono text-sm text-quorate-dim">
          Spawned without a shell · headless args only · byte + time caps
        </p>
      </div>
    </section>
  );
}
