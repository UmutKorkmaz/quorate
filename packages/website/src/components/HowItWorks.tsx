const STEPS = [
  {
    glyph: "⌖",
    glyphColor: "text-quorate-accent",
    title: "Detect agents",
    description:
      "Scan the machine for installed agent CLIs — 17+ supported, from claude and codex to goose and ollama."
  },
  {
    glyph: "⎇",
    glyphColor: "text-quorate-architect",
    title: "Route roles",
    description:
      "Assign architect, security, qa, performance, and maintainer to the available reviewers."
  },
  {
    glyph: "⇶",
    glyphColor: "text-quorate-qa",
    title: "Review in parallel",
    description:
      "Spawn each reviewer headlessly and isolated, capped on time and bytes, all at once."
  },
  {
    glyph: "⚖",
    glyphColor: "text-quorate-amber",
    title: "Dedupe & rank",
    description:
      "Merge overlapping findings, rank by severity, and attach file:line evidence with agreement."
  }
] as const;

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="reveal is-visible relative px-6 py-20 md:py-28"
    >
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
            Pipeline
          </p>
        </div>
        <h2 className="display-section text-3xl text-white md:text-4xl">
          How the council reaches a verdict
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-quorate-muted">
          Five stages turn a raw diff into one accountable call — every reviewer
          run, every finding ranked, every step traceable.
        </p>

        <ol className="mt-12 flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-0">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex flex-col gap-4 lg:flex-1 lg:flex-row lg:items-center"
            >
              <article className="flex-1 rounded-2xl border border-quorate-border bg-quorate-surface/80 p-5 shadow-terminal backdrop-blur">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-xl border border-quorate-border bg-quorate-elevated text-lg ${step.glyphColor}`}
                    aria-hidden
                  >
                    {step.glyph}
                  </span>
                  <span className="font-mono text-xs tracking-wider text-quorate-dim">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-4 font-semibold leading-snug text-white">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-quorate-muted">
                  {step.description}
                </p>
              </article>

              {/* Connector to the next stage. */}
              <span
                className="flex shrink-0 items-center justify-center self-center text-quorate-border lg:px-2"
                aria-hidden
              >
                <span className="lg:hidden">↓</span>
                <span className="hidden lg:inline">→</span>
              </span>
            </li>
          ))}

          {/* Final stage — the one verdict. */}
          <li className="lg:flex-1">
            <article className="h-full rounded-2xl border border-quorate-fail/40 bg-quorate-surface/80 p-5 shadow-terminal backdrop-blur">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs tracking-wider text-quorate-dim">
                  05
                </span>
                <span className="font-mono text-xs tracking-wider text-quorate-fail/70 uppercase">
                  Verdict
                </span>
              </div>
              <h3 className="mt-4 font-semibold leading-snug text-white">
                One verdict
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-quorate-muted">
                A single accountable call — or an honest{" "}
                <span className="text-quorate-degraded">degraded</span> result
                when only heuristics ran.
              </p>
              <div className="mt-4">
                <span className="verdict-chip verdict-chip--fail">FAIL</span>
              </div>
            </article>
          </li>
        </ol>
      </div>
    </section>
  );
}
