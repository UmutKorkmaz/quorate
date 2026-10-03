import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";

const cases = JSON.parse(readFileSync(new URL("./fixtures/execution-review.json", import.meta.url), "utf8")) as Array<{ name: string; source: string; title: string; flagged: boolean }>;
it.each(cases)("$name", ({ source, title, flagged }) => {
  const diff = `diff --git a/src/runner.ts b/src/runner.ts\n--- a/src/runner.ts\n+++ b/src/runner.ts\n@@ -0,0 +1 @@\n+${source}\n`;
  const findings = runHeuristicReview({ mode: "review", subject: "execution review", diff }).findings;
  expect(findings.some(f => f.title === title)).toBe(flagged);
});
it("keeps explicit custom polling rules active", () => {
  const sample = cases.find(c => c.name === "bounded sleep polling")!;
  const diff = `diff --git a/src/runner.ts b/src/runner.ts\n--- a/src/runner.ts\n+++ b/src/runner.ts\n@@ -0,0 +1 @@\n+${sample.source}\n`;
  const result = runHeuristicReview({ mode: "review", subject: "custom polling", diff,
    customHeuristics: [{ title: sample.title, severity: "high", body: "Custom polling requirement", fileRe: null, textRe: /await/ }] });
  expect(result.findings.some(f => f.body === "Custom polling requirement")).toBe(true);
});
