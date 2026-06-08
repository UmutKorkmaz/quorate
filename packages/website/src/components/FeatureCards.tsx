import { Section } from "./Section";

const FEATURES = [
  {
    title: "Independent reviewers, one call",
    description:
      "Ask several AI reviewers to inspect the same change, then receive one deduplicated PASS / WARN / FAIL.",
    icon: "◆",
    iconColor: "text-quorate-accent",
    cardVariant: "feature-card--accent"
  },
  {
    title: "Bring your own local agents",
    description:
      "No new API layer to wire up. Quorate detects installed agent CLIs and runs them in headless mode.",
    icon: "⌘",
    iconColor: "text-quorate-maintainer",
    cardVariant: "feature-card--maintainer"
  },
  {
    title: "Shows uncertainty clearly",
    description:
      "Heuristic-only reviews are marked degraded, so limited coverage never looks like a confident green.",
    icon: "▲",
    iconColor: "text-quorate-amber",
    cardVariant: "feature-card--amber"
  },
  {
    title: "Process limits built in",
    description:
      "Real providers are opt-in, spawned without a shell, and guarded by byte caps, time caps, and denied flags.",
    icon: "⬡",
    iconColor: "text-quorate-security",
    cardVariant: "feature-card--security"
  },
  {
    title: "Interactive when you need it",
    description:
      "Use the shell for live review sessions with transcript, slash palette, provider progress, and severity cards.",
    icon: "✦",
    iconColor: "text-quorate-amber",
    cardVariant: "feature-card--amber"
  },
  {
    title: "CI-ready PR reporting",
    description:
      "Publish one PR report, add optional inline findings, and fail checks only at the severity you choose.",
    icon: "⎇",
    iconColor: "text-quorate-qa",
    cardVariant: "feature-card--qa"
  }
] as const;

export function FeatureCards() {
  return (
    <Section
      id="features"
      eyebrow="Features"
      title="Built for reviews that have to hold up"
      description="Use it for a quick local second opinion, a deeper pre-merge pass, or automated council checks on every pull request."
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <article
            key={feature.title}
            className={`group feature-card ${feature.cardVariant}`}
          >
            <span className={`feature-card-icon ${feature.iconColor}`}>
              {feature.icon}
            </span>
            <h3 className="mt-5 font-semibold text-white leading-snug">{feature.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-quorate-muted">{feature.description}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}
