const FLOW_STEPS = [
  {
    label: "Input",
    title: "Load the change",
    detail: "Review a diff or evaluate a plan with explicit repository context."
  },
  {
    label: "Council",
    title: "Run reviewers",
    detail: "Fan out to available providers, then deduplicate and rank their findings."
  },
  {
    label: "Verdict",
    title: "Return evidence",
    detail: "Produce one decision with severity, file and line, agreement, and artifacts."
  }
] as const;

const ROLES = [
  ["architect", "text-quorate-architect"],
  ["security", "text-quorate-security"],
  ["qa", "text-quorate-qa"],
  ["performance", "text-quorate-performance"],
  ["maintainer", "text-quorate-maintainer"]
] as const;

export function WhatIsQuorate() {
  return (
    <section id="what-is-quorate" className="relative px-6 py-20 md:py-28">
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
              What is Quorate
            </p>
          </div>
          <h2 className="display-section text-3xl text-white md:text-4xl">
            A review council, not another autopilot
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-quorate-muted">
            Quorate does not write your code. It coordinates the AI CLIs already on your machine,
            runs them headlessly in parallel, and turns their feedback into one verdict your team
            can review.
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="min-w-0 space-y-6">
            <div className="rounded-2xl border border-quorate-border bg-quorate-surface/60 p-6 backdrop-blur">
              <h3 className="font-semibold text-white">Runs your tools</h3>
              <p className="mt-3 leading-relaxed text-quorate-muted">
                Each provider is a local CLI on your machine. Quorate detects what is installed,
                launches headless processes with explicit arguments, and keeps interactive sessions
                opt-in.
              </p>
            </div>
            <div className="rounded-2xl border border-quorate-border bg-quorate-surface/60 p-6 backdrop-blur">
              <h3 className="font-semibold text-white">Same verdict everywhere</h3>
              <p className="mt-3 leading-relaxed text-quorate-muted">
                <code className="rounded bg-quorate-elevated px-1.5 py-0.5 font-mono text-sm text-quorate-accent">
                  @quorate/core
                </code>{" "}
                powers the CLI, interactive shell, and GitHub Action, so the review logic is the
                same in your terminal and on every pull request.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {ROLES.map(([role, colorClass]) => (
                <span
                  key={role}
                  className={`rounded-full border border-quorate-border bg-quorate-elevated px-3 py-1 font-mono text-xs ${colorClass}`}
                >
                  {role}
                </span>
              ))}
            </div>
          </div>
          <div className="min-w-0 rounded-2xl border border-quorate-border bg-quorate-surface/60 p-6 shadow-terminal backdrop-blur">
            <p className="mb-4 font-mono text-xs tracking-wider text-quorate-dim uppercase">
              How it works
            </p>
            <ol className="grid gap-3 sm:grid-cols-3">
              {FLOW_STEPS.map((step, index) => (
                <li
                  key={step.label}
                  className="min-w-0 rounded-xl border border-quorate-border bg-quorate-bg/70 p-4"
                >
                  <p className="font-mono text-[10px] tracking-wider text-quorate-accent uppercase">
                    {String(index + 1).padStart(2, "0")} · {step.label}
                  </p>
                  <h3 className="mt-3 text-sm font-semibold text-white">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-quorate-muted">
                    {step.detail}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
