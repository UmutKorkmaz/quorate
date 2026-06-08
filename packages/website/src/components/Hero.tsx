import { Link } from "react-router-dom";

import { CopyButton } from "./CopyButton";

const HERO_STATS = [
  { value: "17+", label: "agent CLIs detected" },
  { value: "5", label: "review roles" },
  { value: "1", label: "merged verdict" }
] as const;

export function Hero() {
  return (
    <div className="relative overflow-hidden px-6 pb-16 pt-12 md:pb-24 md:pt-20">
      {/* Atmospheric orbs */}
      <div
        aria-hidden
        className="hero-orb hero-orb--indigo"
        style={{
          width: "680px",
          height: "480px",
          top: "-120px",
          left: "calc(50% - 480px)",
          background: "radial-gradient(ellipse, rgba(110, 151, 255, 0.13) 0%, rgba(110, 151, 255, 0.04) 50%, transparent 70%)"
        }}
      />
      <div
        aria-hidden
        className="hero-orb hero-orb--amber"
        style={{
          width: "500px",
          height: "380px",
          top: "-60px",
          right: "calc(50% - 520px)",
          background: "radial-gradient(ellipse, rgba(251, 191, 36, 0.09) 0%, rgba(251, 191, 36, 0.03) 50%, transparent 70%)"
        }}
      />
      <div
        aria-hidden
        className="hero-orb"
        style={{
          width: "300px",
          height: "300px",
          bottom: "-80px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "radial-gradient(ellipse, rgba(110, 151, 255, 0.07) 0%, transparent 70%)"
        }}
      />

      <div className="pointer-events-none absolute inset-0 grid-bg opacity-50" aria-hidden />

      <div className="relative mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <div className="flex justify-center">
            <p className="hero-badge">
              <span className="text-quorate-amber">✦</span>
              AI review council for your terminal
            </p>
          </div>

          <h1 className="text-5xl font-bold leading-[1.08] tracking-tight md:text-[4.25rem]">
            Run a full review council
            <span className="mt-2 block bg-gradient-to-r from-quorate-accent via-[#a8c4ff] to-quorate-accent bg-clip-text text-transparent">
              from one CLI
            </span>
          </h1>

          <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-quorate-muted">
            Send a diff or plan to multiple local AI reviewers. Quorate removes duplicate
            findings, ranks the real risks, and returns a single PASS, WARN, or FAIL.
          </p>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-quorate-dim">
            Interactive shell for local reviews · headless{" "}
            <code className="rounded bg-quorate-elevated px-1.5 py-0.5 text-quorate-accent">review</code>{" "}
            for CI · GitHub Action for PRs · clear degraded mode when only heuristics run
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <CopyButton text="npm install -g quorate" variant="hero" />
            <div className="flex items-center gap-5">
              <a
                href="#see-it-in-action"
                className="text-sm text-quorate-dim underline-offset-4 transition hover:text-quorate-accent hover:underline"
              >
                Watch terminal demo →
              </a>
              <Link
                to="/docs/manual-testing"
                className="text-sm text-quorate-dim underline-offset-4 transition hover:text-quorate-accent hover:underline"
              >
                Open testing guide →
              </Link>
            </div>
          </div>

          <dl className="mx-auto mt-12 grid max-w-sm grid-cols-3 gap-3 pt-2">
            {HERO_STATS.map((stat) => (
              <div key={stat.label} className="hero-stat-card">
                <dt className="hero-stat-value">{stat.value}</dt>
                <dd className="hero-stat-label">{stat.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
