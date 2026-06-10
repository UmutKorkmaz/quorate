import type { DocPath } from "../components/DocNav";

export const DOC_DESCRIPTIONS: Record<DocPath, string> = {
  "/docs":
    "Quorate documentation — install, quick start, slash commands, providers, configuration, and GitHub Action.",
  "/docs/install":
    "Install Quorate globally with npm. Requires Node 22+. Verify setup with quorate doctor.",
  "/docs/quickstart":
    "Quick start guide: open the shell, load a diff, enable providers, and run your first council review.",
  "/docs/commands":
    "Every slash command in the Quorate interactive shell — /review, /diff, /git, /pr, /plan, and more.",
  "/docs/providers":
    "Detected AI CLIs (claude, codex, qwen, kimi) and the built-in heuristic reviewer.",
  "/docs/config":
    "Configure councils, providers, headless args, and safety limits in .quorate.yml.",
  "/docs/github-action":
    "Run the Quorate council on every pull request with the GitHub Action.",
  "/docs/faq":
    "Frequently asked questions about Quorate — install, providers, degraded reviews, and the GitHub Action.",
  "/docs/manual-testing":
    "Manual testing checklist for Quorate — website, CLI shell, keyboard shortcuts, sessions, headless commands, and edge cases.",
  "/docs/solana":
    "Quorate Solana pack — Anchor-aware review council and ten deterministic on-chain heuristics for sealevel security.",
  "/docs/evm":
    "Quorate EVM pack — Solidity-aware review council and ten deterministic on-chain heuristics for smart-contract security.",
  "/docs/iac":
    "Quorate IaC pack — Terraform and Kubernetes security council and ten deterministic heuristics for infrastructure misconfiguration review."
};