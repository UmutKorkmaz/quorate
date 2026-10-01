import { describe, expect, it } from "vitest";

import { applyCustomPackDefinitions, customPackScaffold, parseCustomPackYaml, runCouncil } from "../src/index.js";
import { runHeuristicReview } from "../src/heuristics.js";
import type { CustomHeuristicRule, QuorateConfig } from "../src/types.js";

const source = `
version: 1
id: org-rules
description: Organization rules
councils:
  - org-reviewer
role_guidance:
  org-reviewer: Watch organization-specific risks.
heuristics:
  - title: Debug endpoint exposed
    severity: high
    file_pattern: "\\\\.ts$"
    pattern: "debugEndpoint"
    body: Debug endpoints must not ship.
`;

describe("custom packs", () => {
  it("parses a v1 custom pack and rejects built-in id collisions", () => {
    const parsed = parseCustomPackYaml(source);
    expect(parsed.pack.id).toBe("org-rules");
    expect(parsed.heuristics).toHaveLength(1);
    expect(() => parseCustomPackYaml(source.replace("org-rules", "solana"))).toThrow(/collides/);
  });

  it("scaffolds valid custom pack YAML", () => {
    const parsed = parseCustomPackYaml(customPackScaffold("my-pack"));
    expect(parsed.pack.id).toBe("my-pack");
    expect(parsed.heuristics).toHaveLength(1);
  });

  it("adds councils/guidance and runs custom heuristics", async () => {
    const base: QuorateConfig = {
      councils: ["maintainer"],
      providers: [{ id: "heuristic", type: "mock", enabled: true, roles: ["org-reviewer"] }],
      github: { commentMode: "update", failOn: "high", runnerMode: "auto" }
    };
    const config = applyCustomPackDefinitions(base, [parseCustomPackYaml(source)]);
    expect(config.councils).toContain("org-reviewer");
    expect(config.roleGuidance?.["org-reviewer"]).toMatch(/organization/i);

    const report = await runCouncil(
      {
        mode: "review",
        subject: "custom pack",
        diff: "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n+const debugEndpoint = true;",
        repoPath: "/repo"
      },
      config
    );
    expect(report.findings.some((finding) => finding.title === "Debug endpoint exposed")).toBe(true);
  });
});

// A classic catastrophic-backtracking pattern: both the pattern and the diff
// line are repo-controlled, so without the per-line length cap this rule hangs
// the synchronous heuristic pass (ReDoS). Vitest's default per-test timeout is
// the hang guard.
const redosRule: CustomHeuristicRule = {
  packId: "redos-pack",
  title: "Nested quantifier rule",
  severity: "high",
  body: "Only fires on short lines.",
  fileRe: null,
  textRe: /(a+)+$/
};

function diffWithLine(line: string): string {
  return [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1 +1 @@",
    `+${line}`
  ].join("\n");
}

describe("pack-supplied regex ReDoS guard", () => {
  it("still runs pack heuristics against normal-length lines", () => {
    const result = runHeuristicReview(
      { mode: "review", subject: "t", diff: diffWithLine("aaa"), customHeuristics: [redosRule] }
    );
    expect(result.findings.some((finding) => finding.title === "Nested quantifier rule")).toBe(true);
  });

  it("skips pack regexes on very long lines instead of hanging", () => {
    // /(a+)+$/ against 20k 'a's is exponential backtracking without the cap.
    const result = runHeuristicReview(
      { mode: "review", subject: "t", diff: diffWithLine("a".repeat(20000)), customHeuristics: [redosRule] }
    );
    expect(result.findings.some((finding) => finding.title === "Nested quantifier rule")).toBe(false);
  });

  it("keeps built-in heuristics working on very long lines", () => {
    const result = runHeuristicReview(
      {
        mode: "review",
        subject: "t",
        diff: diffWithLine(`// TODO: flatten ${"a".repeat(20000)}`),
        customHeuristics: [redosRule]
      }
    );
    expect(result.findings.some((finding) => finding.title === "Follow-up marker added")).toBe(true);
    expect(result.findings.some((finding) => finding.title === "Nested quantifier rule")).toBe(false);
  });
});
