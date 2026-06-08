import { Section } from "./Section";

const PROVIDERS = [
  "claude",
  "codex",
  "grok",
  "kimi",
  "qwen",
  "minimax",
  "hermes",
  "agy",
  "opencode",
  "crush",
  "goose",
  "cline",
  "copilot",
  "ollama",
  "heuristic"
] as const;

export function ProviderStrip() {
  return (
    <Section
      id="providers"
      eyebrow="Providers"
      title="Drive the agents on your machine"
      description="Quorate detects these CLIs by default. Enable only the ones you trust — heuristic runs with zero setup."
      className="py-16 md:py-20"
    >
      <div className="relative overflow-hidden rounded-xl border border-quorate-border bg-quorate-surface/50 py-8">
        <div className="flex animate-scroll gap-4 px-4 whitespace-nowrap">
          {[...PROVIDERS, ...PROVIDERS].map((provider, i) => (
            <span
              key={`${provider}-${i}`}
              className={`inline-flex shrink-0 items-center rounded-lg border px-4 py-2 font-mono text-sm ${
                provider === "heuristic"
                  ? "border-quorate-amber/40 bg-quorate-amber/10 text-quorate-amber"
                  : "border-quorate-border bg-quorate-elevated text-quorate-muted"
              }`}
            >
              {provider === "heuristic" ? "◆ " : "⌘ "}
              {provider}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-linear-to-r from-quorate-surface to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-linear-to-l from-quorate-surface to-transparent" />
      </div>
      <p className="mt-6 text-center text-sm text-quorate-dim">
        Spawned without a shell · headless args only · byte + time caps
      </p>
    </Section>
  );
}