const STEPS = [
  {
    step: "01",
    title: "Install Quorate",
    command: "npm install -g quorate",
    detail: "Requires Node 22.22.0 or newer. One package includes the CLI, shell, and council engine."
  },
  {
    step: "02",
    title: "See a working gate",
    command: "quorate setup demo",
    detail: "An offline example goes from blocked to corrected to passing. Inspect the diffs and evidence in a new temporary directory."
  },
  {
    step: "03",
    title: "Choose your reviewer",
    command: "quorate doctor",
    detail: "Check configured agents in your repository, then follow the explicit provider-selection command to review your own changes."
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
            See your first gate in three commands
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-quorate-muted">
            See why a change is blocked, inspect the correction, and take the same workflow to your repository.
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
