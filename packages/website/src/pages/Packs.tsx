import { useState } from "react";
import { Link } from "react-router";
import { Seo } from "../components/Seo";
import { CodeBlock } from "../components/CodeBlock";
import { PACKS_DATA, type PackInfo } from "../lib/packs-data";

// ── Standard badge colours (reuse design token names) ─────────────
const STANDARD_STYLE: Record<string, string> = {
  "sealevel-attacks": "border-quorate-accent/40 text-quorate-accent bg-quorate-accent/8",
  "Solana transaction confirmation": "border-quorate-accent/40 text-quorate-accent bg-quorate-accent/8",
  "Anchor token constraints": "border-quorate-accent/40 text-quorate-accent bg-quorate-accent/8",
  "Token-2022 extensions": "border-quorate-accent/40 text-quorate-accent bg-quorate-accent/8",
  SWC: "border-quorate-amber/40 text-quorate-amber bg-quorate-amber/8",
  Move: "border-quorate-architect/40 text-quorate-architect bg-quorate-architect/8",
  CIS: "border-quorate-maintainer/40 text-quorate-maintainer bg-quorate-maintainer/8",
  "OWASP-LLM": "border-quorate-security/40 text-quorate-security bg-quorate-security/8",
  OpenSSF: "border-quorate-qa/40 text-quorate-qa bg-quorate-qa/8",
  "PCI-DSS": "border-quorate-amber/40 text-quorate-amber bg-quorate-amber/8",
  OWASP: "border-quorate-security/40 text-quorate-security bg-quorate-security/8",
  HIPAA: "border-quorate-accent/40 text-quorate-accent bg-quorate-accent/8",
  MASVS: "border-quorate-performance/40 text-quorate-performance bg-quorate-performance/8",
  "WCAG 2.2": "border-quorate-architect/40 text-quorate-architect bg-quorate-architect/8",
  "Data Engineering": "border-quorate-qa/40 text-quorate-qa bg-quorate-qa/8",
  "CIS Kubernetes": "border-quorate-maintainer/40 text-quorate-maintainer bg-quorate-maintainer/8",
  GDPR: "border-quorate-accent/40 text-quorate-accent bg-quorate-accent/8",
  "ML Supply Chain": "border-quorate-security/40 text-quorate-security bg-quorate-security/8",
  "MISRA C 2012": "border-quorate-amber/40 text-quorate-amber bg-quorate-amber/8",
  "MISRA C++ 2008": "border-quorate-amber/40 text-quorate-amber bg-quorate-amber/8",
  "Performance & SRE": "border-quorate-performance/40 text-quorate-performance bg-quorate-performance/8",
  "GraphQL Security": "border-quorate-architect/40 text-quorate-architect bg-quorate-architect/8",
  "DD.xyz / Webacy": "border-quorate-accent/40 text-quorate-accent bg-quorate-accent/8",
  "Web3 Review": "border-quorate-amber/40 text-quorate-amber bg-quorate-amber/8"
};

function standardStyle(standard: string): string {
  return (
    STANDARD_STYLE[standard] ??
    "border-quorate-border text-quorate-muted bg-quorate-elevated/40"
  );
}

// ── Pack icons (simple emoji fallback) ───────────────────────────
const PACK_ICON: Record<string, string> = {
  solana: "◎",
  evm: "⬡",
  move: "▲",
  "web3-dd": "◇",
  iac: "☁",
  llm: "✦",
  ci: "⚙",
  fintech: "◈",
  web: "◉",
  healthcare: "✚",
  mobile: "▣",
  accessibility: "♿",
  "data-sql": "⌗",
  k8s: "⎈",
  privacy: "⚖",
  mlops: "◴",
  embedded: "⬓",
  performance: "⚡",
  graphql: "◐"
};

// ── Bento sizing for the pack grid ───────────────────────────────
// First two packs get wider treatment; rest form a tighter row.
const PACK_SPAN: Record<string, string> = {
  solana: "sm:col-span-2 lg:col-span-3",
  evm: "sm:col-span-2 lg:col-span-3",
  move: "lg:col-span-2",
  "web3-dd": "lg:col-span-2",
  iac: "lg:col-span-2",
  llm: "lg:col-span-2",
  ci: "lg:col-span-2",
  fintech: "lg:col-span-2",
  web: "lg:col-span-2",
  healthcare: "lg:col-span-2",
  mobile: "lg:col-span-2",
  accessibility: "lg:col-span-2",
  "data-sql": "lg:col-span-2",
  k8s: "lg:col-span-2",
  privacy: "lg:col-span-2",
  mlops: "lg:col-span-2",
  embedded: "lg:col-span-2",
  performance: "lg:col-span-2",
  graphql: "lg:col-span-2"
};

// ── Stat banner ───────────────────────────────────────────────────
const STATS = [
  { value: "19", label: "domain packs" },
  { value: "198", label: "review classes" },
  { value: "24", label: "recognised standards" },
  { value: "0", label: "false positives on clean code" }
];

function PackCard({ pack }: { pack: PackInfo }) {
  return (
    <Link
      to={`/docs/${pack.id}`}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-quorate-border bg-quorate-surface/80 p-6 shadow-terminal backdrop-blur transition-all duration-300 hover:border-quorate-accent/35 hover:shadow-glow ${PACK_SPAN[pack.id] ?? ""}`}
      aria-label={`${pack.label} pack — ${pack.tagline}`}
    >
      {/* Top-left accent line on hover */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: "linear-gradient(90deg, rgba(110,151,255,0.7), rgba(110,151,255,0.1))" }}
        aria-hidden
      />

      <div className="flex items-start justify-between gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-quorate-border text-lg transition-all duration-300 group-hover:border-quorate-accent/40"
          style={{
            background: "linear-gradient(135deg, rgba(26,34,52,0.9) 0%, rgba(18,24,38,0.7) 100%)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.3)"
          }}
          aria-hidden
        >
          {PACK_ICON[pack.id] ?? "◆"}
        </span>
        <span className="font-mono text-[10px] tracking-[0.2em] text-quorate-dim uppercase">
          {pack.classes.length} classes
        </span>
      </div>

      <h3 className="mt-4 font-sans text-base font-semibold text-white transition-colors group-hover:text-quorate-accent">
        {pack.label}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-quorate-muted">{pack.tagline}</p>

      <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Councils">
        {pack.councils.map((c) => (
          <span
            key={c}
            className="rounded-full border border-quorate-border bg-quorate-elevated/60 px-2 py-0.5 font-mono text-[11px] text-quorate-dim"
          >
            {c}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-1.5 text-xs text-quorate-dim transition-colors group-hover:text-quorate-accent">
        <span>View docs</span>
        <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
      </div>
    </Link>
  );
}

// ── Coverage matrix ───────────────────────────────────────────────
function CoverageMatrix({ pack }: { pack: PackInfo }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" aria-label={`${pack.label} vulnerability classes`}>
        <thead>
          <tr>
            <th className="border-b border-quorate-border px-3 py-2 text-left text-xs font-semibold tracking-wider text-quorate-dim uppercase">
              Vulnerability class
            </th>
            <th className="border-b border-quorate-border px-3 py-2 text-left text-xs font-semibold tracking-wider text-quorate-dim uppercase">
              Standard
            </th>
            <th className="border-b border-quorate-border px-3 py-2 text-left text-xs font-semibold tracking-wider text-quorate-dim uppercase">
              Reference
            </th>
          </tr>
        </thead>
        <tbody>
          {pack.classes.map((cls, i) => (
            <tr
              key={i}
              className="group/row transition-colors hover:bg-quorate-elevated/40"
            >
              <td className="border-b border-quorate-border/60 px-3 py-2.5 align-top font-medium text-gray-200">
                {cls.title}
              </td>
              <td className="border-b border-quorate-border/60 px-3 py-2.5 align-top">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium ${standardStyle(cls.standard)}`}
                >
                  {cls.standard}
                </span>
              </td>
              <td className="border-b border-quorate-border/60 px-3 py-2.5 align-top font-mono text-[12px] text-quorate-muted">
                {cls.reference}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export function Packs() {
  const [selectedPackId, setSelectedPackId] = useState<string>(PACKS_DATA[0].id);
  const selectedPack = PACKS_DATA.find((p) => p.id === selectedPackId) ?? PACKS_DATA[0];

  return (
    <>
      <Seo
        title="Review Packs"
        description="Quorate ships 19 domain-aware review packs — Solana, EVM, Move, Web3 DD, IaC, Kubernetes, CI/CD, LLM, MLOps, Web, GraphQL, Accessibility, Data & SQL, Fintech, Healthcare, Privacy, Mobile, Embedded, and Performance — each grounding review classes in recognised standards or external evidence."
        path="/packs"
      />

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pb-16 pt-14 md:pb-20 md:pt-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-96"
          style={{
            background:
              "radial-gradient(ellipse 70% 55% at 50% 0%, rgba(110,151,255,0.13), transparent 70%)"
          }}
        />
        <div className="chamber-bg pointer-events-none absolute inset-0 opacity-50" aria-hidden />

        <div className="relative mx-auto max-w-6xl">
          <div className="mb-4 flex items-center gap-3">
            <span
              className="h-px w-6 rounded-full"
              style={{ background: "linear-gradient(90deg, rgba(110,151,255,0.7), rgba(110,151,255,0.2))" }}
              aria-hidden
            />
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-quorate-accent">
              Review Packs
            </p>
          </div>

          <h1 className="display-hero text-[2.6rem] leading-[1.04] text-white md:text-5xl lg:text-[3.8rem]">
            Nineteen review councils.
            <span
              className="mt-1 block bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(90deg, #6e97ff, #a8c4ff, #6e97ff)" }}
            >
              One CLI.
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-quorate-muted">
            Each pack is a domain-aware review council paired with deterministic heuristics or
            opt-in external evidence. Install one, get a council that already knows what to look
            for before a model is ever called.
          </p>

          {/* Stat row */}
          <div className="mt-10 flex flex-wrap gap-4" role="list" aria-label="Pack statistics">
            {STATS.map((s) => (
              <div
                key={s.label}
                role="listitem"
                className="flex items-baseline gap-2 rounded-xl border border-quorate-border px-5 py-3"
                style={{
                  background: "linear-gradient(135deg, rgba(26,34,52,0.7) 0%, rgba(18,24,38,0.5) 100%)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)"
                }}
              >
                <span
                  className="font-mono text-2xl font-bold"
                  style={{
                    background: "linear-gradient(135deg, #a8c4ff 0%, #6e97ff 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text"
                  }}
                >
                  {s.value}
                </span>
                <span className="text-sm text-quorate-dim">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pack overview: bento ──────────────────────────────── */}
      <section
        id="all-packs"
        className="relative px-6 pb-16 md:pb-24"
        aria-labelledby="packs-heading"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-center gap-3">
            <span
              className="h-px w-6 rounded-full"
              style={{ background: "linear-gradient(90deg, rgba(251,191,36,0.7), rgba(251,191,36,0.2))" }}
              aria-hidden
            />
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-quorate-amber">
              All packs
            </p>
          </div>
          <h2
            id="packs-heading"
            className="display-section mb-2 text-2xl text-white md:text-4xl"
          >
            Nineteen domains, each with its own council
          </h2>
          <p className="mb-10 max-w-xl text-quorate-muted">
            Select a pack to auto-configure councils, role guidance, heuristics, and optional
            evidence integrations for that domain. Multi-pack configs are supported — councils
            are deduplicated automatically.
          </p>

          {/* Bento grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {PACKS_DATA.map((pack) => (
              <PackCard key={pack.id} pack={pack} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Coverage matrix ───────────────────────────────────── */}
      <section
        id="coverage"
        className="relative px-6 pb-20 md:pb-28"
        aria-labelledby="coverage-heading"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-center gap-3">
            <span
              className="h-px w-6 rounded-full"
              style={{ background: "linear-gradient(90deg, rgba(110,151,255,0.7), rgba(110,151,255,0.2))" }}
              aria-hidden
            />
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-quorate-accent">
              Standards coverage
            </p>
          </div>

          <h2
            id="coverage-heading"
            className="display-section mb-2 text-2xl text-white md:text-4xl"
          >
            Grounded in recognised standards
          </h2>
          <p className="mb-8 max-w-xl text-quorate-muted">
            Every static heuristic maps to a specific entry in a published security standard, and
            evidence-backed packs show the external source that produced the signal.
          </p>

          {/* Pack selector */}
          <div
            className="mb-6 flex flex-wrap gap-2"
            role="tablist"
            aria-label="Select pack to view coverage"
          >
            {PACKS_DATA.map((pack) => (
              <button
                key={pack.id}
                id={`tab-${pack.id}`}
                type="button"
                role="tab"
                aria-selected={pack.id === selectedPackId}
                aria-controls="coverage-panel"
                tabIndex={pack.id === selectedPackId ? 0 : -1}
                onClick={() => setSelectedPackId(pack.id)}
                className={`rounded-full border px-3.5 py-1.5 font-mono text-[12px] transition-all duration-150 ${
                  pack.id === selectedPackId
                    ? "border-quorate-accent/60 bg-quorate-accent/12 text-quorate-accent"
                    : "border-quorate-border bg-quorate-elevated/50 text-quorate-dim hover:border-quorate-accent/30 hover:text-quorate-muted"
                }`}
              >
                {PACK_ICON[pack.id]} {pack.id}
              </button>
            ))}
          </div>

          {/* Coverage table */}
          <div
            id="coverage-panel"
            role="tabpanel"
            aria-labelledby={`tab-${selectedPackId}`}
            className="overflow-hidden rounded-2xl border border-quorate-border"
            style={{
              background: "linear-gradient(135deg, rgba(18,24,38,0.95) 0%, rgba(26,34,52,0.6) 100%)"
            }}
          >
            {/* Panel header */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-quorate-border px-5 py-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-quorate-dim">
                  Pack
                </p>
                <p className="mt-0.5 font-semibold text-white">{selectedPack.label}</p>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Councils in this pack">
                {selectedPack.councils.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-quorate-border bg-quorate-elevated/60 px-2.5 py-0.5 font-mono text-[11px] text-quorate-dim"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>

            <CoverageMatrix pack={selectedPack} />
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────── */}
      <section
        className="relative px-6 pb-24 pt-4"
        aria-labelledby="cta-heading"
      >
        <div className="mx-auto max-w-6xl">
          <div
            className="relative overflow-hidden rounded-2xl border border-quorate-border p-8 md:p-12"
            style={{
              background:
                "linear-gradient(135deg, rgba(26,34,52,0.8) 0%, rgba(18,24,38,0.95) 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)"
            }}
          >
            {/* Ambient glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute right-0 top-0 h-64 w-64 -translate-y-1/4 translate-x-1/4 rounded-full blur-3xl"
              style={{ background: "radial-gradient(circle, rgba(110,151,255,0.12), transparent 70%)" }}
            />

            <div className="relative max-w-xl">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-quorate-accent">
                Get started
              </p>
              <h2
                id="cta-heading"
                className="display-section mt-3 text-2xl text-white md:text-3xl"
              >
                Auto-detect your packs, configure in seconds.
              </h2>
              <p className="mt-4 leading-relaxed text-quorate-muted">
                Run <code className="rounded bg-quorate-elevated px-1.5 py-0.5 font-mono text-sm text-quorate-accent">quorate init --auto</code> in
                any repo. Quorate inspects your files and dependencies, selects the right packs,
                and writes a <code className="rounded bg-quorate-elevated px-1.5 py-0.5 font-mono text-sm text-quorate-accent">.quorate.yml</code> pre-configured
                with the matching councils.
              </p>

              <div className="mt-6">
                <CodeBlock language="bash">{`quorate init --auto`}</CodeBlock>
              </div>

              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  to="/docs"
                  className="inline-flex items-center gap-2 rounded-xl border border-quorate-border bg-quorate-elevated/60 px-5 py-2.5 text-sm font-medium text-quorate-muted transition hover:border-quorate-accent/50 hover:text-quorate-accent"
                >
                  Read the docs
                  <span aria-hidden>→</span>
                </Link>
                <a
                  href="https://github.com/UmutKorkmaz/quorate"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-quorate-border bg-quorate-elevated/60 px-5 py-2.5 text-sm font-medium text-quorate-muted transition hover:border-quorate-amber/50 hover:text-quorate-amber"
                >
                  GitHub Action
                  <span aria-hidden>↗</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
