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
  "/docs/manual-testing",
  "/docs/solana",
  "/docs/evm",
  "/docs/iac",
  "/docs/llm",
  "/docs/move",
  "/docs/ci",
  "/docs/fintech"
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
  "/docs/manual-testing": "Manual testing",
  "/docs/solana": "Solana / Anchor",
  "/docs/evm": "EVM / Solidity",
  "/docs/iac": "Infrastructure / IaC",
  "/docs/llm": "AI / LLM apps",
  "/docs/move": "Move (Sui / Aptos)",
  "/docs/ci": "CI/CD & Supply Chain",
  "/docs/fintech": "Fintech / PCI"
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
      { to: "/docs/faq", label: "FAQ" },
      { to: "/docs/solana", label: "Solana / Anchor" },
      { to: "/docs/evm", label: "EVM / Solidity" },
      { to: "/docs/iac", label: "Infrastructure / IaC" },
      { to: "/docs/llm", label: "AI / LLM apps" },
      { to: "/docs/move", label: "Move (Sui / Aptos)" },
      { to: "/docs/ci", label: "CI/CD & Supply Chain" },
      { to: "/docs/fintech", label: "Fintech / PCI" }
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