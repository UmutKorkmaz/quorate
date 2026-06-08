import { Section } from "./Section";

const FLOW_LINES = [
  " diff / plan ─▶ council orchestrator ─▶ local providers, in parallel",
  "                       │                         │ headless, isolated, capped",
  "                       ▼                         ▼",
  "                 dedupe + rank ◀──── findings (severity, file:line, evidence)",
  "                       │",
  "                       ▼",
  "            one verdict  (pass · warn · fail, with degraded mode when limited)"
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
    <Section
      id="what-is-quorate"
      eyebrow="What is Quorate"
      title="A review council, not another autopilot"
      description="Quorate does not write your code. It coordinates the AI CLIs already on your machine, runs them headlessly in parallel, and turns their feedback into one verdict your team can review."
    >
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="space-y-6">
          <div className="rounded-xl border border-quorate-border bg-quorate-surface p-6">
            <h3 className="font-semibold text-white">Runs your tools</h3>
            <p className="mt-3 leading-relaxed text-quorate-muted">
              Each provider is a local CLI on your machine. Quorate detects what is installed,
              launches headless processes with explicit arguments, and keeps interactive sessions
              opt-in.
            </p>
          </div>
          <div className="rounded-xl border border-quorate-border bg-quorate-surface p-6">
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
        <div className="rounded-xl border border-quorate-border bg-quorate-elevated/40 p-6 shadow-(--shadow-glow)">
          <p className="mb-4 font-mono text-xs tracking-wider text-quorate-dim uppercase">
            How it works
          </p>
          <pre className="overflow-x-auto font-mono text-[12px] leading-relaxed text-quorate-muted md:text-[13px]">
            {FLOW_LINES.map((line, i) => (
              <span key={i} className="block">
                {line.includes("one verdict") ? (
                  <span className="text-quorate-accent">{line}</span>
                ) : line.includes("dedupe") ? (
                  <span className="text-quorate-amber">{line}</span>
                ) : (
                  line
                )}
              </span>
            ))}
          </pre>
        </div>
      </div>
    </Section>
  );
}
