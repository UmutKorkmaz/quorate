import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "solana");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

const SOLANA_TITLES = [
  "Unchecked account type",
  "Raw CPI invocation",
  "Preflight checks disabled"
] as const;

describe("Solana heuristics — vulnerable fixtures", () => {
  it("unchecked-account.diff: flags UncheckedAccount<'info> as high severity", () => {
    const diff = readFixture("unchecked-account.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Unchecked account type");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("programs/foo/src/lib.rs");
    expect(finding!.line).toBe(13);
  });

  it("raw-cpi.diff: flags invoke_signed as medium severity", () => {
    const diff = readFixture("raw-cpi.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Raw CPI invocation");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("programs/foo/src/processor.rs");
    expect(finding!.line).toBe(22);
  });

  it("skip-preflight.diff: flags skipPreflight:true as medium severity", () => {
    const diff = readFixture("skip-preflight.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Preflight checks disabled");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("app/src/tx.ts");
    expect(finding!.line).toBe(9);
  });
});

describe("Solana heuristics — clean fixture", () => {
  it("clean-anchor.diff: yields no Solana heuristic findings", () => {
    const diff = readFixture("clean-anchor.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const solanaFindings = result.findings.filter((f) =>
      (SOLANA_TITLES as readonly string[]).includes(f.title)
    );
    expect(solanaFindings).toHaveLength(0);
  });
});

describe("Solana heuristics — non-Solana diff", () => {
  it("a plain JS diff does not produce any Solana heuristic findings", () => {
    const diff = [
      "diff --git a/src/index.ts b/src/index.ts",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,3 +1,4 @@",
      "+export const version = '1.0.0';"
    ].join("\n");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const solanaFindings = result.findings.filter((f) =>
      (SOLANA_TITLES as readonly string[]).includes(f.title)
    );
    expect(solanaFindings).toHaveLength(0);
  });
});
