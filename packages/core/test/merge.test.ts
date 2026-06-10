import { describe, expect, it } from "vitest";
import { clusterFindings } from "../src/council.js";
import { buildMergePrompt, parseMergeResult } from "../src/merge.js";
import type { Finding } from "../src/types.js";

const f = (over: Partial<Finding>): Finding => ({
  severity: "low",
  title: "t",
  body: "b",
  ...over
});

/** The real-world case: five reviewers phrase ONE stray console.log five ways. */
const PARAPHRASED: Finding[] = [
  f({ providerId: "heuristic", title: "Console logging added", body: "console.log left in the diff", file: "src/diff.ts", line: 28 }),
  f({ providerId: "ollama", title: "Debug statement remains in source", body: "a console.log debug statement remains", file: "src/diff.ts", line: 28 }),
  f({ providerId: "gemma4", title: "Debug statement with FIXME comment remains in codebase", body: "console.log with a FIXME marker left in code", file: "src/diff.ts", line: 28 }),
  f({ providerId: "claude", title: "Leftover debug logging committed to source", body: "leftover console.log debug logging committed", file: "src/diff.ts", line: 28 }),
  f({ providerId: "codex", title: "Remove stray debug logging", body: "stray console.log should be removed", file: "src/diff.ts", line: 28 })
];

describe("tight-location clustering", () => {
  it("merges five paraphrases of the same console.log at the same line", () => {
    const clustered = clusterFindings(PARAPHRASED);
    expect(clustered.length).toBeLessThanOrEqual(2);
    const biggest = clustered.sort((a, b) => (b.agreement ?? 0) - (a.agreement ?? 0))[0];
    expect(biggest.agreement).toBeGreaterThanOrEqual(4);
  });

  it("keeps genuinely different issues on the same line separate", () => {
    const clustered = clusterFindings([
      f({ providerId: "claude", title: "Hardcoded API secret committed", body: "an aws secret key literal is embedded in this assignment", file: "a.ts", line: 5, severity: "critical" }),
      f({ providerId: "codex", title: "Console logging added", body: "console.log debug output left behind", file: "a.ts", line: 5 })
    ]);
    expect(clustered).toHaveLength(2);
  });
});

describe("master merge parsing", () => {
  it("builds merged findings from a valid partition (severity never lowered)", () => {
    const text = `Here you go:\n\`\`\`json\n[{"sources":[0,1,2,3,4],"title":"Stray console.log debug statement","body":"One console.log left at src/diff.ts:28.","severity":"info"}]\n\`\`\``;
    const merged = parseMergeResult(text, PARAPHRASED)!;
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("Stray console.log debug statement");
    expect(merged[0].severity).toBe("low"); // master tried to lower low -> info; refused
    expect(merged[0].agreedBy).toEqual(["claude", "codex", "gemma4", "heuristic", "ollama"]);
    expect(merged[0].agreement).toBe(5);
  });

  it("passes untouched indexes through and rejects double-used ones", () => {
    const partial = parseMergeResult(`[{"sources":[0,1],"title":"x","body":"y"}]`, PARAPHRASED)!;
    expect(partial).toHaveLength(4); // 1 merged + 3 passthrough singletons
    expect(parseMergeResult(`[{"sources":[0,1]},{"sources":[1,2]}]`, PARAPHRASED)).toBeUndefined();
  });

  it("returns undefined on junk output", () => {
    expect(parseMergeResult("I could not merge anything, sorry!", PARAPHRASED)).toBeUndefined();
  });

  it("the prompt carries every finding with its index", () => {
    const prompt = buildMergePrompt(PARAPHRASED);
    expect(prompt).toContain('"index": 4');
    expect(prompt).toContain("Remove stray debug logging");
    expect(prompt).toContain("exactly one item");
  });
});
