import { NavLink } from "react-router-dom";

export const DOC_PATHS = [
  "/docs",
  "/docs/install",
  "/docs/quickstart",
  "/docs/commands",
  "/docs/providers",
  "/docs/config",
  "/docs/github-action",
  "/docs/faq",
  // Blockchain & Web3
  "/docs/solana",
  "/docs/evm",
  "/docs/move",
  "/docs/web3-dd",
  // Apps & APIs
  "/docs/web",
  "/docs/graphql",
  "/docs/accessibility",
  // AI & Data
  "/docs/llm",
  "/docs/mlops",
  "/docs/data-sql",
  // Infra & Delivery
  "/docs/iac",
  "/docs/k8s",
  "/docs/ci",
  "/docs/performance",
  // Compliance & Privacy
  "/docs/fintech",
  "/docs/healthcare",
  "/docs/privacy",
  // Mobile & Embedded
  "/docs/mobile",
  "/docs/embedded",
  // Quality
  "/docs/manual-testing"
] as const;

export type DocPath = (typeof DOC_PATHS)[number];

export const DOC_LABELS: Record<DocPath, string> = {
  "/docs": "Introduction",
  "/docs/install": "Install",
  "/docs/quickstart": "Quick start",
  "/docs/commands": "Slash commands",
  "/docs/providers": "Providers",
  "/docs/config": "Configuration",
  "/docs/github-action": "GitHub Action",
  "/docs/faq": "FAQ",
  "/docs/solana": "Solana / Anchor",
  "/docs/evm": "EVM / Solidity",
  "/docs/move": "Move (Sui / Aptos)",
  "/docs/web3-dd": "Web3 DD / Webacy",
  "/docs/web": "Web & API (OWASP)",
  "/docs/graphql": "GraphQL API",
  "/docs/accessibility": "Accessibility (WCAG)",
  "/docs/llm": "AI / LLM apps",
  "/docs/mlops": "ML / MLOps",
  "/docs/data-sql": "Data & SQL",
  "/docs/iac": "Infrastructure / IaC",
  "/docs/k8s": "Kubernetes",
  "/docs/ci": "CI/CD & Supply Chain",
  "/docs/performance": "Performance & SRE",
  "/docs/fintech": "Fintech / PCI",
  "/docs/healthcare": "Healthcare / HIPAA",
  "/docs/privacy": "Privacy (GDPR)",
  "/docs/mobile": "Mobile (iOS / Android)",
  "/docs/embedded": "Embedded (MISRA)",
  "/docs/manual-testing": "Manual testing"
};

const SECTIONS = [
  {
    label: "Overview",
    links: [{ to: "/docs", label: "Introduction", end: true }]
  },
  {
    label: "Getting started",
    links: [
      { to: "/docs/install", label: "Install" },
      { to: "/docs/quickstart", label: "Quick start" },
      { to: "/docs/commands", label: "Slash commands" }
    ]
  },
  {
    label: "Reference",
    links: [
      { to: "/docs/providers", label: "Providers" },
      { to: "/docs/config", label: "Configuration" },
      { to: "/docs/github-action", label: "GitHub Action" },
      { to: "/docs/faq", label: "FAQ" }
    ]
  },
  {
    label: "Packs · Blockchain & Web3",
    links: [
      { to: "/docs/solana", label: "Solana / Anchor" },
      { to: "/docs/evm", label: "EVM / Solidity" },
      { to: "/docs/move", label: "Move (Sui / Aptos)" },
      { to: "/docs/web3-dd", label: "Web3 DD / Webacy" }
    ]
  },
  {
    label: "Packs · Apps & APIs",
    links: [
      { to: "/docs/web", label: "Web & API (OWASP)" },
      { to: "/docs/graphql", label: "GraphQL API" },
      { to: "/docs/accessibility", label: "Accessibility (WCAG)" }
    ]
  },
  {
    label: "Packs · AI & Data",
    links: [
      { to: "/docs/llm", label: "AI / LLM apps" },
      { to: "/docs/mlops", label: "ML / MLOps" },
      { to: "/docs/data-sql", label: "Data & SQL" }
    ]
  },
  {
    label: "Packs · Infra & Delivery",
    links: [
      { to: "/docs/iac", label: "Infrastructure / IaC" },
      { to: "/docs/k8s", label: "Kubernetes" },
      { to: "/docs/ci", label: "CI/CD & Supply Chain" },
      { to: "/docs/performance", label: "Performance & SRE" }
    ]
  },
  {
    label: "Packs · Compliance & Privacy",
    links: [
      { to: "/docs/fintech", label: "Fintech / PCI" },
      { to: "/docs/healthcare", label: "Healthcare / HIPAA" },
      { to: "/docs/privacy", label: "Privacy (GDPR)" }
    ]
  },
  {
    label: "Packs · Mobile & Embedded",
    links: [
      { to: "/docs/mobile", label: "Mobile (iOS / Android)" },
      { to: "/docs/embedded", label: "Embedded (MISRA)" }
    ]
  },
  {
    label: "Quality",
    links: [{ to: "/docs/manual-testing", label: "Manual testing" }]
  }
] as const;

export function DocNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="doc-nav" aria-label="Documentation">
      {SECTIONS.map((section) => (
        <div key={section.label} className="doc-nav-section">
          <p className="doc-nav-heading">{section.label}</p>
          <ul className="doc-nav-list">
            {section.links.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={"end" in link ? link.end : false}
                  className={({ isActive }) =>
                    isActive ? "doc-nav-link doc-nav-link-active" : "doc-nav-link"
                  }
                  onClick={onNavigate}
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
