import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildSupplyChainReport, renderMarkdownReport, resolvePolicy, serializeConfig, shouldFailForPolicy, type CouncilReport, type QuorateConfig } from "@quorate/core";

/**
 * Onboarding generators and repository risk reports, plus an explicitly invoked
 * offline demonstration that writes only into a new directory.
 */

const ACTION_REF = "UmutKorkmaz/quorate@1e7796b0f86cdbacadf149637c87b9812b246303";
const VSCODE_EXTENSION_ID = "umutkorkmaz.quorate-vscode";

/** A reproducible, offline first gate. Only a new directory is written. */
export function runSetupDemo(cwd: string, target?: string): { directory: string; before: CouncilReport; after: CouncilReport } {
  const directory = target ? resolve(cwd, target) : mkdtempSync(join(tmpdir(), "quorate-demo-"));
  if (target) mkdirSync(directory, { mode: 0o700 }); // EEXIST protects existing work, including symlinks.
  const config: QuorateConfig = {
    councils: ["maintainer"],
    providers: [{ id: "heuristic", type: "mock", enabled: true, roles: ["maintainer"] }],
    github: { commentMode: "update", failOn: "medium", runnerMode: "auto" }
  };
  const diffFor = (ref: string): string => [
    "diff --git a/.github/workflows/example.yml b/.github/workflows/example.yml",
    "new file mode 100644", "--- /dev/null", "+++ b/.github/workflows/example.yml", "@@ -0,0 +1,9 @@",
    "+name: Example", "+on: pull_request", "+permissions:", "+  contents: read", "+jobs:",
    "+  test:", "+    runs-on: ubuntu-latest", "+    steps:", `+      - uses: actions/checkout@${ref}`, ""
  ].join("\n");
  const beforeDiff = diffFor("v4");
  // Same immutable checkout reference as this project's CI; the demo checks pinning, not advisory status.
  const afterDiff = diffFor("11d5960a326750d5838078e36cf38b85af677262");
  const review = (diff: string): CouncilReport => buildSupplyChainReport({
    mode: "review", subject: "First gate: pin a workflow action", diff, repoPath: directory, repositoryFiles: []
  }, config);
  const before = review(beforeDiff);
  const after = review(afterDiff);
  const policy = resolvePolicy(config);
  if (!shouldFailForPolicy(before, policy) || shouldFailForPolicy(after, policy) || after.findings.length !== 0) {
    throw new Error(`The demo did not produce the expected blocked-to-passing gate. Inspect ${directory}.`);
  }
  const files: Record<string, string> = {
    ".quorate.yml": serializeConfig(config),
    "before.diff": beforeDiff,
    "after.diff": afterDiff,
    "blocked.json": `${JSON.stringify(before, null, 2)}\n`,
    "passed.json": `${JSON.stringify(after, null, 2)}\n`,
    "blocked.md": renderMarkdownReport(before),
    "passed.md": renderMarkdownReport(after)
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(directory, name), content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  return { directory, before, after };
}

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
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false
      - uses: ${ACTION_REF}
        # Pinned to a reviewed immutable Action bundle commit.
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
