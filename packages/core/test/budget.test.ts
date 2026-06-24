import { describe, expect, it } from "vitest";

import { analyzeReviewBudget } from "../src/budget.js";
import type { QuorateConfig } from "../src/types.js";

const diff = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1 +1,2 @@",
  "-old",
  "+new",
  "+console.log('x')",
  "diff --git a/package-lock.json b/package-lock.json",
  "--- a/package-lock.json",
  "+++ b/package-lock.json",
  "@@ -1 +1 @@",
  "-{}",
  "+{}"
].join("\n");

function config(overrides: Partial<QuorateConfig> = {}): QuorateConfig {
  return {
    councils: ["maintainer"],
    providers: [
      {
        id: "glm",
        type: "api",
        model: "glm-5.1",
        roles: ["maintainer"],
        enabled: true,
        cost: { inputUsdPer1M: 1 }
      }
    ],
    github: { commentMode: "update", failOn: "high", runnerMode: "api" },
    ...overrides
  };
}

describe("analyzeReviewBudget", () => {
  it("counts changed files/lines and estimates priced input cost", () => {
    const result = analyzeReviewBudget({
      diff,
      config: config(),
      request: { mode: "review", subject: "PR #1", repoPath: "/repo" }
    });
    expect(result.summary.changedFiles).toBe(2);
    expect(result.summary.changedLines).toBe(5);
    expect(result.summary.estimatedInputTokens).toBeGreaterThan(0);
    expect(result.summary.estimatedInputCostUsd).toBeGreaterThan(0);
  });

  it("skips generated files and reports exceeded caps", () => {
    const result = analyzeReviewBudget({
      diff,
      config: config({ budget: { skipGenerated: true, maxChangedLines: 1 } }),
      request: { mode: "review", subject: "PR #1", repoPath: "/repo" }
    });
    expect(result.summary.skippedGeneratedFiles).toEqual(["package-lock.json"]);
    expect(result.summary.changedFiles).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.summary.exceeded.join(" ")).toMatch(/changed lines/);
    expect(result.diff).not.toContain("package-lock.json");
  });
});
