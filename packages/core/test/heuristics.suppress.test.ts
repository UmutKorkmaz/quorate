import { describe, expect, it } from "vitest";
import { applyInlineSuppressions, runHeuristicReview } from "../src/heuristics.js";
import type { Finding } from "../src/types.js";

/** A diff that adds a stray console.log (a base heuristic) on a TS file. */
function consoleDiff(line: string): string {
  return [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,1 +1,2 @@",
    " const x = 1;",
    `+${line}`
  ].join("\n");
}

describe("inline suppression", () => {
  it("flags a stray console.log normally", () => {
    const { findings } = runHeuristicReview({ mode: "review", subject: "t", diff: consoleDiff("console.log(x);") });
    expect(findings.some((f) => /console/i.test(f.title))).toBe(true);
  });

  it("mutes a finding with a trailing quorate-ignore on the same line", () => {
    const { findings } = runHeuristicReview({
      mode: "review",
      subject: "t",
      diff: consoleDiff("console.log(x); // quorate-ignore")
    });
    expect(findings).toHaveLength(0);
  });

  it("mutes a finding when the marker is on the line directly above", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,1 +1,3 @@",
      " const x = 1;",
      "+// quorate-ignore-next-line",
      "+console.log(x);"
    ].join("\n");
    const { findings } = runHeuristicReview({ mode: "review", subject: "t", diff });
    expect(findings).toHaveLength(0);
  });

  it("scopes by keyword: an unrelated keyword does NOT mute the finding", () => {
    const { findings } = runHeuristicReview({
      mode: "review",
      subject: "t",
      diff: consoleDiff("console.log(x); // quorate-ignore sql-injection")
    });
    expect(findings.some((f) => /console/i.test(f.title))).toBe(true);
  });

  it("scopes by keyword: a matching keyword mutes the finding", () => {
    const { findings } = runHeuristicReview({
      mode: "review",
      subject: "t",
      diff: consoleDiff("console.log(x); // quorate-ignore console")
    });
    expect(findings).toHaveLength(0);
  });

  it("applyInlineSuppressions is a no-op for findings without a marker on their line", () => {
    const findings: Finding[] = [{ severity: "low", title: "Foo", body: "b", file: "a.ts", line: 5 }];
    const kept = applyInlineSuppressions(findings, [{ file: "a.ts", line: 5, text: "const y = 2;" }]);
    expect(kept).toEqual(findings);
  });
});
