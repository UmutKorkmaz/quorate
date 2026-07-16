import { CopyButton } from "./CopyButton";

const REVIEWERS = [
  { id: "heuristic", role: "security", state: "2 findings", tone: "pass" },
  { id: "claude", role: "architect", state: "1 finding", tone: "pass" },
  { id: "codex", role: "qa", state: "merged", tone: "dim" }
] as const;

const TONE: Record<string, string> = {
  pass: "text-quorate-pass",
  dim: "text-quorate-dim"
};

export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pb-20 pt-14 md:pb-28 md:pt-20">
      {/* One restrained chamber glow + the concentric-arc motif. */}
      <div
        aria-hidden
        className="hero-orb"
        style={{
          width: "820px",
          height: "560px",
          top: "-160px",
          left: "50%",
          transform: "translateX(-50%)",
          background:
            "radial-gradient(ellipse 70% 55% at 50% 8%, rgba(110,151,255,0.16), transparent 70%)"
        }}
      />
      <div className="chamber-bg pointer-events-none absolute inset-0 opacity-70" aria-hidden />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.08fr_0.92fr]">
        {/* ── Left: the stance ───────────────────────────────────── */}
        <div className="reveal is-visible text-center lg:text-left">
          <p className="hero-badge mx-auto lg:mx-0">
            Multi-agent review · deterministic gates
          </p>

          <h1 className="display-hero mt-6 text-[clamp(2.5rem,11vw,4.2rem)] leading-[1.02] md:text-6xl lg:text-[4.2rem]">
            Review with a council.
            <span className="mt-1 block bg-gradient-to-r from-quorate-accent via-[#a8c4ff] to-quorate-accent bg-clip-text text-transparent">
              Ship with evidence.
            </span>
          </h1>

          <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-quorate-muted lg:mx-0">
            Quorate runs the AI reviewers you already use, adds deterministic policy
            checks, and turns every result into one accountable{" "}
            <span className="text-quorate-pass">PASS</span>,{" "}
            <span className="text-quorate-warn">WARN</span>, or{" "}
            <span className="text-quorate-fail">FAIL</span>. Every finding carries file,
            line, severity, and reviewer agreement so teams can decide what ships.
          </p>

          <div className="mt-9 flex w-full flex-col items-stretch justify-center gap-4 sm:w-auto sm:flex-row sm:items-center lg:justify-start">
            <CopyButton text="npm install -g quorate" variant="hero" />
            <a
              href="#review-gate-example"
              className="group inline-flex items-center justify-center gap-2 rounded-xl border border-quorate-border bg-quorate-surface/60 px-5 py-3 text-sm font-medium text-quorate-muted transition hover:border-quorate-accent/50 hover:text-quorate-accent"
            >
              See the review flow
              <span className="transition group-hover:translate-x-0.5">→</span>
            </a>
          </div>

          <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-quorate-dim lg:justify-start">
            <li>Local-first</li>
            <li>GitHub Action</li>
            <li>SARIF · JUnit · JSON · HTML</li>
            <li>Honest degraded mode</li>
          </ul>
        </div>

        {/* ── Right: the council reaching a verdict (the payoff) ──── */}
        <div className="reveal is-visible">
          <div className="council-card relative mx-auto max-w-md">
            <div className="rounded-2xl border border-quorate-border bg-quorate-surface/80 shadow-terminal backdrop-blur">
              <div className="flex items-center gap-2 border-b border-quorate-border/70 px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-quorate-fail/80" />
                <span className="h-3 w-3 rounded-full bg-quorate-amber/80" />
                <span className="h-3 w-3 rounded-full bg-quorate-pass/80" />
                <span className="ml-2 font-mono text-xs text-quorate-dim">
                  quorate — review · session rotation PR
                </span>
              </div>

              <div className="space-y-2.5 px-5 py-5 font-mono text-sm">
                {REVIEWERS.map((r) => (
                  <div key={r.id} className="flex items-center justify-between">
                    <span>
                      <span className="text-quorate-muted">{r.id}</span>
                      <span className="text-quorate-dim">:{r.role}</span>
                    </span>
                    <span className={TONE[r.tone]}>
                      {r.tone === "pass" ? "✔ " : "· "}
                      {r.state}
                    </span>
                  </div>
                ))}

                <div className="!mt-4 h-px bg-quorate-border/60" />

                <div className="!mt-4 flex items-center gap-3">
                  <span className="verdict-chip verdict-chip--fail">FAIL</span>
                  <span className="text-quorate-dim">
                    3 findings · agreement <span className="text-quorate-muted">67%</span>
                  </span>
                </div>

                <div className="!mt-3 h-1.5 overflow-hidden rounded-full bg-quorate-elevated">
                  <div
                    className="h-full rounded-full bg-quorate-amber/80"
                    style={{ width: "67%" }}
                  />
                </div>

                <div className="!mt-4 leading-relaxed">
                  <span className="font-bold text-quorate-fail">FAIL HIGH</span>{" "}
                  <span className="font-bold text-gray-200">src/auth/session.ts:84</span>
                  <p className="mt-1 text-quorate-muted">
                    A rotated refresh token can be reused because the previous token
                    remains valid after the session update commits.
                  </p>
                  <p className="mt-1.5 text-xs text-quorate-dim">
                    agreed by 3 reviewers · confidence 0.86
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
