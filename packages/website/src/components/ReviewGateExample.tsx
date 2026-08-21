import { Link } from "react-router";

import { CodeBlock } from "./CodeBlock";

const REVIEW_COMMAND = `quorate review --base main --head HEAD \\
  --fail-on high \\
  --write-sarif out/quorate.sarif \\
  --write-junit out/quorate.junit.xml \\
  --write-html out/quorate.html`;

const CAPABILITIES = [
  {
    label: "Council review",
    title: "Independent reviewers, one decision",
    body: "Route architecture, security, QA, performance, and maintainability to the agents available on your machine."
  },
  {
    label: "SupplyChainGate",
    title: "Deterministic checks for risky changes",
    body: "Inspect manifests, lockfiles, workflow permissions, publish credentials, and container image pins without model variance."
  },
  {
    label: "Portable evidence",
    title: "Reports that fit the tools you already use",
    body: "Export the same verdict to Markdown, JSON, SARIF, JUnit, HTML, and ReviewGraph artifacts."
  }
] as const;

export function ReviewGateExample() {
  return (
    <section id="review-gate-example" className="relative px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="grid min-w-0 gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div className="min-w-0">
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px w-6 rounded-full bg-quorate-accent/60" aria-hidden />
              <p className="font-mono text-xs tracking-[0.2em] text-quorate-accent uppercase">
                From diff to decision
              </p>
            </div>

            <h2 className="display-section text-3xl text-white md:text-5xl">
              One workflow from local review to merge gate
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-quorate-muted">
              Review a session-management change in the terminal, enforce the same
              policy in CI, and leave behind evidence another engineer can verify.
              The workflow stays the same across languages and repository shapes.
            </p>

            <div className="mt-7 overflow-hidden rounded-2xl border border-quorate-border bg-quorate-surface/70 shadow-terminal backdrop-blur">
              <div className="border-b border-quorate-border bg-quorate-elevated/50 px-4 py-3">
                <p className="font-mono text-xs text-quorate-dim">local review</p>
              </div>
              <div className="p-4">
                <CodeBlock language="bash">{REVIEW_COMMAND}</CodeBlock>
              </div>
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to="/docs/quickstart"
                className="inline-flex items-center gap-2 rounded-xl border border-quorate-accent/40 bg-quorate-accent/10 px-5 py-2.5 text-sm font-medium text-quorate-accent transition hover:border-quorate-accent/70 hover:bg-quorate-accent/15"
              >
                Start a review <span aria-hidden>→</span>
              </Link>
              <Link
                to="/docs/github-action"
                className="inline-flex items-center gap-2 rounded-xl border border-quorate-border bg-quorate-elevated/60 px-5 py-2.5 text-sm font-medium text-quorate-muted transition hover:border-quorate-accent/50 hover:text-white"
              >
                Add the merge gate <span aria-hidden>→</span>
              </Link>
            </div>
          </div>

          <div className="min-w-0 space-y-5">
            <div className="overflow-hidden rounded-2xl border border-quorate-border bg-quorate-surface/80 shadow-terminal backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-quorate-border/70 px-5 py-4">
                <div>
                  <p className="font-mono text-xs text-quorate-dim">pull request #184</p>
                  <p className="mt-1 font-medium text-white">Rotate refresh tokens on every use</p>
                </div>
                <span className="verdict-chip verdict-chip--fail">FAIL</span>
              </div>

              <div className="grid gap-px bg-quorate-border/70 sm:grid-cols-3">
                <div className="bg-quorate-surface px-5 py-4">
                  <p className="font-mono text-[10px] tracking-wider text-quorate-dim uppercase">Council</p>
                  <p className="mt-2 font-mono text-sm text-quorate-fail">3 findings</p>
                </div>
                <div className="bg-quorate-surface px-5 py-4">
                  <p className="font-mono text-[10px] tracking-wider text-quorate-dim uppercase">Supply chain</p>
                  <p className="mt-2 font-mono text-sm text-quorate-pass">PASS</p>
                </div>
                <div className="bg-quorate-surface px-5 py-4">
                  <p className="font-mono text-[10px] tracking-wider text-quorate-dim uppercase">Evidence</p>
                  <p className="mt-2 font-mono text-sm text-quorate-accent">4 artifacts</p>
                </div>
              </div>

              <div className="p-5 md:p-6">
                <div className="rounded-xl border border-quorate-fail/25 bg-quorate-fail/[0.04] p-4">
                  <p className="font-mono text-xs font-bold text-quorate-fail">FAIL · HIGH</p>
                  <p className="mt-2 break-words font-mono text-sm text-gray-200">
                    src/auth/session.ts:84
                  </p>
                  <p className="mt-3 leading-relaxed text-quorate-muted">
                    The previous refresh token remains valid after rotation, allowing
                    a captured token to create another active session.
                  </p>
                  <p className="mt-3 font-mono text-xs text-quorate-dim">
                    agreed by security, QA, and maintainer · confidence 0.89
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {CAPABILITIES.map((capability) => (
                <article
                  key={capability.label}
                  className="rounded-2xl border border-quorate-border bg-quorate-surface/60 p-5"
                >
                  <p className="font-mono text-[10px] tracking-wider text-quorate-accent uppercase">
                    {capability.label}
                  </p>
                  <h3 className="mt-3 text-sm font-semibold leading-snug text-white">
                    {capability.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-quorate-muted">
                    {capability.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
