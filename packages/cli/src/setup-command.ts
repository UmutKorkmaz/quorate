import type { QuorateConfig } from "@quorate/core";

/**
 * Onboarding generators: write safe starter files and surface a repo risk
 * report. Pure functions (string in, string/object out) so they're unit-testable;
 * the command layer handles filesystem writes and console output.
 */

const ACTION_REF = "UmutKorkmaz/quorate@v1.0.0";
const VSCODE_EXTENSION_ID = "umutkorkmaz.quorate-vscode";

/** A starter `.github/workflows/quorate.yml`. Heuristic runs with zero setup; a
 *  `type: api` provider in `.quorate.yml` (+ its key secret) enables real review. */
export function generateGithubActionWorkflow(): string {
  return `name: Quorate
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ${ACTION_REF}
        # Add a type: api provider to .quorate.yml and pass its key here to get
        # real model review (e.g. OPENROUTER_API_KEY). The heuristic always runs.
        # env:
        #   OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
`;
}

/**
 * Merge the Quorate VS Code extension into a `.vscode/extensions.json`
 * recommendations list, preserving any existing entries. Idempotent.
 *
 * Returns `null` when an existing file can't be parsed (e.g. it uses JSONC
 * comments) — the caller MUST then leave the file untouched rather than clobber
 * the user's hand-edited recommendations.
 */
export function mergeVscodeRecommendations(existing: string | undefined): string | null {
  let recommendations: string[] = [];
  if (existing && existing.trim().length > 0) {
    let parsed: { recommendations?: unknown };
    try {
      parsed = JSON.parse(existing) as { recommendations?: unknown };
    } catch {
      return null;
    }
    if (Array.isArray(parsed.recommendations)) {
      recommendations = parsed.recommendations.filter((r): r is string => typeof r === "string");
    }
  }
  if (!recommendations.includes(VSCODE_EXTENSION_ID)) {
    recommendations.push(VSCODE_EXTENSION_ID);
  }
  return `${JSON.stringify({ recommendations }, null, 2)}\n`;
}

export type RiskLevel = "ok" | "warn" | "risk";

export interface RiskItem {
  level: RiskLevel;
  label: string;
  detail: string;
}

export interface RiskReport {
  items: RiskItem[];
}

export interface RiskInput {
  config: QuorateConfig;
  /** Packs detected from the repo's stack (see `detectPacks`). */
  detectedPacks: string[];
  /** Whether a `.github/workflows/*.yml` references Quorate. */
  hasCiWorkflow: boolean;
  /** apiKeyEnv names referenced by enabled api providers but absent from the env. */
  missingProviderKeys: string[];
}

/**
 * Summarize a repo's review posture into actionable risk items: real-provider
 * coverage (heuristic-only is a degraded gate), missing provider keys, CI
 * coverage, the gate threshold, and the detected stack.
 */
export function buildRiskReport(input: RiskInput): RiskReport {
  const items: RiskItem[] = [];
  const enabled = input.config.providers.filter((p) => p.enabled !== false);
  const realProviders = enabled.filter((p) => p.type === "cli" || p.type === "api");

  items.push(
    realProviders.length > 0
      ? {
          level: "ok",
          label: "Real providers",
          detail: `${realProviders.length} non-heuristic provider(s) enabled: ${realProviders.map((p) => p.id).join(", ")}.`
        }
      : {
          level: "risk",
          label: "Real providers",
          detail: "No cli/api provider enabled — every review is heuristic-only and reported as degraded. Add one with `quorate provider add`."
        }
  );

  if (input.missingProviderKeys.length > 0) {
    items.push({
      level: "warn",
      label: "Provider keys",
      detail: `Enabled api provider(s) reference unset env var(s): ${input.missingProviderKeys.join(", ")}. They will fail until the key is exported.`
    });
  } else if (realProviders.some((p) => p.type === "api")) {
    items.push({ level: "ok", label: "Provider keys", detail: "All enabled api provider keys are present." });
  }

  items.push(
    input.hasCiWorkflow
      ? { level: "ok", label: "CI coverage", detail: "A workflow references Quorate — pull requests are reviewed automatically." }
      : {
          level: "warn",
          label: "CI coverage",
          detail: "No .github/workflows file references Quorate. Run `quorate setup github-action` to add a PR gate."
        }
  );

  items.push({
    level: "ok",
    label: "Merge gate",
    detail: `fail-on threshold is "${input.config.github.failOn}"${input.config.github.failOnDegraded ? ", and degraded runs fail" : ""}.`
  });

  if (input.detectedPacks.length > 0) {
    items.push({
      level: "ok",
      label: "Detected stack",
      detail: `Packs matching this repo: ${input.detectedPacks.join(", ")}. Enable with \`quorate init --auto\`.`
    });
  }

  return { items };
}
