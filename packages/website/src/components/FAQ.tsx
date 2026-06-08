import { useState, type ReactNode } from "react";
import { Section } from "./Section";

interface FAQItem {
  question: string;
  answer: ReactNode;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    question: "Do I need API keys?",
    answer:
      "No. Quorate drives the AI agent CLIs already installed on your machine — claude, codex, qwen, kimi, and more. It runs them in headless mode with explicit arguments, not through cloud APIs you configure separately."
  },
  {
    question: "What is the heuristic provider?",
    answer: (
      <>
        The default <code className="text-quorate-accent">heuristic</code> runs four fast static
        checks — focused tests, hard-coded secrets, stray console.log, and TODO/FIXME markers. It
        needs no setup and never calls an external tool. A heuristic-only review is always reported
        as <span className="text-quorate-amber">degraded</span>, never a confident green.
      </>
    )
  },
  {
    question: "How does Quorate differ from a coding agent?",
    answer:
      "Coding agents write and edit code. Quorate is an orchestrator: it convenes multiple reviewers over a diff or plan, collects their findings in parallel, deduplicates them, and returns one aggregated verdict with file-and-line evidence."
  },
  {
    question: "Is it safe to run untrusted code through Quorate?",
    answer:
      "Real providers are opt-in and spawned without a shell. Quorate enforces headless args, byte/time caps, and rejects dangerous flags unless a profile explicitly opts in. The GitHub Action loads config from the PR base branch, not the head."
  },
  {
    question: "Can I use it in CI without local CLIs?",
    answer:
      "Yes. On GitHub-hosted runners, the built-in heuristic runs with zero setup. For full multi-model reviews with claude or codex, use a self-hosted runner where those CLIs are authenticated."
  },
  {
    question: "What slash commands does the shell support?",
    answer: (
      <>
        Type <code className="text-quorate-accent">/</code> to open the palette:{" "}
        <code className="text-quorate-dim">/review</code>,{" "}
        <code className="text-quorate-dim">/diff</code>,{" "}
        <code className="text-quorate-dim">/git</code>,{" "}
        <code className="text-quorate-dim">/pr</code>,{" "}
        <code className="text-quorate-dim">/plan</code>,{" "}
        <code className="text-quorate-dim">/providers</code>,{" "}
        <code className="text-quorate-dim">/use available</code>, and more. Bare text follows
        the current mode.
      </>
    )
  },
  {
    question: "How do I configure councils and providers?",
    answer: (
      <>
        Run <code className="text-quorate-accent">quorate init</code> to write a starter{" "}
        <code className="text-quorate-accent">.quorate.yml</code>. Enable providers individually,
        assign council roles, set headless args, and configure fail-on severity for GitHub
        Actions.
      </>
    )
  },
  {
    question: "What verdicts can Quorate return?",
    answer:
      "PASS, WARN, or FAIL — plus an honest degraded flag when the council ran heuristic-only or had low cross-model agreement. The same report format appears in the shell, Markdown export, and PR comments."
  }
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <Section
      id="faq"
      eyebrow="FAQ"
      title="Common questions"
      description="Everything you need to know before convening your first council."
    >
      <div className="mx-auto max-w-3xl divide-y divide-quorate-border rounded-xl border border-quorate-border bg-quorate-surface/60">
        {FAQ_ITEMS.map((item, index) => {
          const isOpen = openIndex === index;
          return (
            <div key={item.question}>
              <button
                type="button"
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition hover:bg-quorate-elevated/40"
                aria-expanded={isOpen}
              >
                <span className="font-medium text-white">{item.question}</span>
                <span
                  className={`shrink-0 font-mono text-quorate-accent transition-transform ${isOpen ? "rotate-45" : ""}`}
                >
                  +
                </span>
              </button>
              {isOpen ? (
                <div className="px-6 pb-5 text-sm leading-relaxed text-quorate-muted">
                  {item.answer}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Section>
  );
}