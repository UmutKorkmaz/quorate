const STEPS = [
  {
    step: "01",
    title: "Install Quorate",
    command: "npm install -g quorate",
    detail: "Requires Node 22.22.0 or newer. One package includes the CLI, shell, and council engine."
  },
  {
    step: "02",
    title: "Audit your setup",
    command: "quorate doctor",
    detail: "See which AI CLIs are installed, runnable, or waiting on a headless profile."
  },
  {
    step: "03",
    title: "Get a verdict",
    command: "quorate review --base main",
    detail: "Run a one-shot review, or open the shell with quorate and type / to explore commands."
  }
] as const;

export function QuickStart() {
  return (
    <section id="quick-start" className="relative px-6 py-20 md:py-28">
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
              Quick start
            </p>
          </div>
          <h2 className="display-section text-3xl text-white md:text-4xl">
            From install to verdict in three commands
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-quorate-muted">
            Check your local agents, run a review, and get a result your team can act on.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((item, index) => (
            <div
              key={item.step}
              className="relative rounded-2xl border border-quorate-border bg-quorate-surface/60 p-6 backdrop-blur"
            >
              {index < STEPS.length - 1 ? (
                <div
                  className="absolute top-1/2 -right-3 hidden h-px w-6 bg-quorate-border md:block"
                  aria-hidden
                />
              ) : null}
              <span className="font-mono text-3xl font-bold text-quorate-accent/40">{item.step}</span>
              <h3 className="mt-3 font-semibold text-white">{item.title}</h3>
              <code className="mt-4 block rounded-lg border border-quorate-border bg-quorate-bg px-3 py-2.5 font-mono text-sm text-quorate-accent">
                $ {item.command}
              </code>
              <p className="mt-3 text-sm leading-relaxed text-quorate-muted">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
