import { Link } from "react-router-dom";

import { CodeBlock } from "./CodeBlock";
import { InlineCode } from "./InlineCode";

const COMMANDS = `quorate init --pack solana
quorate review --fail-on high \\
  --write-sarif out/quorate.sarif \\
  --write-html out/quorate.html \\
  --write-md out/quorate.md`;

const WORKFLOW = `name: Quorate - Solana app review
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: UmutKorkmaz/quorate@v1.0.0
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
          fail-on: high`;

export function SolanaAppExample() {
  return (
    <section id="solana-app-example" className="relative px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center gap-3">
          <span
            className="h-px w-6 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, rgba(251,191,36,0.7), rgba(251,191,36,0.2))"
            }}
            aria-hidden
          />
          <p className="font-mono text-xs tracking-[0.2em] text-quorate-amber uppercase">
            Solana app example
          </p>
        </div>

        <div className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div>
            <h2 className="display-section text-3xl text-white md:text-5xl">
              Review an AI-built Solana escrow before it merges
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-quorate-muted">
              Quorate is a generic AI code review tool. The website leads with a
              Solana app because agent-built Solana code needs both deterministic
              checks and semantic review: account constraints, PDA safety,
              transaction simulation, token validation, and maintainer risk.
            </p>
            <p className="mt-4 leading-relaxed text-quorate-muted">
              Start with <InlineCode>quorate init --pack solana</InlineCode> for
              Anchor-specific councils, then use the same CLI, reports, Action,
              and provider setup for any other stack.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to="/docs/solana"
                className="inline-flex items-center gap-2 rounded-xl border border-quorate-border bg-quorate-elevated/60 px-5 py-2.5 text-sm font-medium text-quorate-muted transition hover:border-quorate-accent/50 hover:text-quorate-accent"
              >
                Solana docs
                <span aria-hidden>→</span>
              </Link>
              <Link
                to="/packs"
                className="inline-flex items-center gap-2 rounded-xl border border-quorate-border bg-quorate-elevated/60 px-5 py-2.5 text-sm font-medium text-quorate-muted transition hover:border-quorate-amber/50 hover:text-quorate-amber"
              >
                All packs
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>

          <div className="space-y-5">
            <div className="overflow-hidden rounded-2xl border border-quorate-border bg-quorate-surface/70 shadow-terminal backdrop-blur">
              <div className="border-b border-quorate-border bg-quorate-elevated/50 px-4 py-3">
                <p className="font-mono text-xs text-quorate-dim">
                  local review command
                </p>
              </div>
              <div className="p-4">
                <CodeBlock language="bash">{COMMANDS}</CodeBlock>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="rounded-2xl border border-quorate-border bg-quorate-surface/70 p-5 shadow-terminal backdrop-blur">
                <p className="font-mono text-[10px] tracking-[0.2em] text-quorate-dim uppercase">
                  Example finding
                </p>
                <p className="mt-4 font-mono text-[13px] leading-relaxed">
                  <span className="font-bold text-quorate-fail">FAIL</span>{" "}
                  <span className="text-quorate-high">HIGH</span>{" "}
                  <span className="text-gray-200">programs/escrow/src/lib.rs:88</span>
                </p>
                <p className="mt-3 text-sm leading-relaxed text-quorate-muted">
                  Anchor account constraint removed. The escrow close path no
                  longer proves the vault belongs to the escrow authority.
                </p>
                <p className="mt-3 font-mono text-xs text-quorate-dim">
                  agreed by 3 reviewers
                </p>
              </div>

              <div className="rounded-2xl border border-quorate-border bg-quorate-surface/70 p-5 shadow-terminal backdrop-blur">
                <p className="font-mono text-[10px] tracking-[0.2em] text-quorate-dim uppercase">
                  GitHub Action
                </p>
                <div className="mt-4">
                  <CodeBlock language="yaml">{WORKFLOW}</CodeBlock>
                </div>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-quorate-dim">
              Solana is the concrete demo; the engine stays stack-agnostic. Swap
              <InlineCode>solana</InlineCode> for <InlineCode>web</InlineCode>,{" "}
              <InlineCode>llm</InlineCode>, <InlineCode>k8s</InlineCode>,{" "}
              <InlineCode>ci</InlineCode>, or any other pack when the repo changes.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
