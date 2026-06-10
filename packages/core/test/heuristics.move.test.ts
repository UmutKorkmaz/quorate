import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "move");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

const ALL_MOVE_TITLES = [
  "Public entry function",
  "Global storage mutated without owner check",
  "Resource removed from storage",
  "Object shared publicly",
  "Struct has copy ability",
  "Integer downcast (truncation)",
  "Unguarded privileged function",
  "Unchecked vector index",
  "Key resource has drop ability",
  "Initializer/admin entrypoint"
] as const;

type MoveTitle = (typeof ALL_MOVE_TITLES)[number];

interface FixtureCase {
  fixture: string;
  title: MoveTitle;
  severity: "critical" | "high" | "medium" | "low" | "info";
  expectedFile: string;
}

const FIXTURE_CASES: FixtureCase[] = [
  {
    fixture: "public-entry.diff",
    title: "Public entry function",
    severity: "medium",
    expectedFile: "sources/vault.move"
  },
  {
    fixture: "borrow-global-mut.diff",
    title: "Global storage mutated without owner check",
    severity: "medium",
    expectedFile: "sources/registry.move"
  },
  {
    fixture: "move-from.diff",
    title: "Resource removed from storage",
    severity: "medium",
    expectedFile: "sources/staking.move"
  },
  {
    fixture: "shared-object.diff",
    title: "Object shared publicly",
    severity: "medium",
    expectedFile: "sources/pool.move"
  },
  {
    fixture: "copy-ability.diff",
    title: "Struct has copy ability",
    severity: "medium",
    expectedFile: "sources/authority.move"
  },
  {
    fixture: "downcast.diff",
    title: "Integer downcast (truncation)",
    severity: "low",
    expectedFile: "sources/fee_calc.move"
  },
  {
    fixture: "privileged-fun.diff",
    title: "Unguarded privileged function",
    severity: "medium",
    expectedFile: "sources/token.move"
  },
  {
    fixture: "vector-borrow.diff",
    title: "Unchecked vector index",
    severity: "low",
    expectedFile: "sources/leaderboard.move"
  },
  {
    fixture: "drop-key.diff",
    title: "Key resource has drop ability",
    severity: "medium",
    expectedFile: "sources/escrow.move"
  },
  {
    fixture: "init-entrypoint.diff",
    title: "Initializer/admin entrypoint",
    severity: "low",
    expectedFile: "sources/governance.move"
  }
];

describe("Move heuristics — vulnerable fixtures (per-class)", () => {
  it("public-entry.diff: flags public entry function as medium", () => {
    const diff = readFixture("public-entry.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Public entry function");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("sources/vault.move");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("borrow-global-mut.diff: flags global mut without owner check as medium", () => {
    const diff = readFixture("borrow-global-mut.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Global storage mutated without owner check"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("sources/registry.move");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("move-from.diff: flags resource removed from storage as medium", () => {
    const diff = readFixture("move-from.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Resource removed from storage");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("sources/staking.move");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("shared-object.diff: flags publicly shared object as medium", () => {
    const diff = readFixture("shared-object.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Object shared publicly");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("sources/pool.move");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("copy-ability.diff: flags struct with copy ability as medium", () => {
    const diff = readFixture("copy-ability.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Struct has copy ability");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("sources/authority.move");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("downcast.diff: flags integer narrowing cast as low", () => {
    const diff = readFixture("downcast.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Integer downcast (truncation)");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("low");
    expect(finding!.file).toBe("sources/fee_calc.move");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("privileged-fun.diff: flags unguarded mint/withdraw as medium", () => {
    const diff = readFixture("privileged-fun.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Unguarded privileged function");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("sources/token.move");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("vector-borrow.diff: flags unchecked vector index as low", () => {
    const diff = readFixture("vector-borrow.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Unchecked vector index");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("low");
    expect(finding!.file).toBe("sources/leaderboard.move");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("drop-key.diff: flags key resource with drop ability as medium", () => {
    const diff = readFixture("drop-key.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Key resource has drop ability");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("sources/escrow.move");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("init-entrypoint.diff: flags module initializer as low", () => {
    const diff = readFixture("init-entrypoint.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Initializer/admin entrypoint");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("low");
    expect(finding!.file).toBe("sources/governance.move");
    expect(finding!.line).toBeGreaterThan(0);
  });
});

describe("Move heuristics — fixture table (file and line set)", () => {
  for (const { fixture, title, severity, expectedFile } of FIXTURE_CASES) {
    it(`${fixture} produces a ${severity} finding titled "${title}"`, () => {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const finding = result.findings.find((f) => f.title === title);
      expect(finding, `Expected finding "${title}" in ${fixture}`).toBeDefined();
      expect(finding!.severity).toBe(severity);
      expect(finding!.file).toBe(expectedFile);
      expect(finding!.line).toBeDefined();
      expect(typeof finding!.line).toBe("number");
    });
  }
});

describe("Move heuristics — clean fixture", () => {
  it("clean-move.diff: yields none of the 10 Move heuristic findings", () => {
    const diff = readFixture("clean-move.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const moveFindings = result.findings.filter((f) =>
      (ALL_MOVE_TITLES as readonly string[]).includes(f.title)
    );
    expect(moveFindings).toHaveLength(0);
  });
});

describe("Move heuristics — non-Move diff does not fire Move checks", () => {
  it("a plain Solidity diff does not produce any Move heuristic findings", () => {
    const diff = [
      "diff --git a/contracts/Token.sol b/contracts/Token.sol",
      "--- a/contracts/Token.sol",
      "+++ b/contracts/Token.sol",
      "@@ -1,3 +1,6 @@",
      "+pragma solidity 0.8.24;",
      "+contract Token {",
      "+  uint256 public totalSupply;",
      "+}"
    ].join("\n");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const moveFindings = result.findings.filter((f) =>
      (ALL_MOVE_TITLES as readonly string[]).includes(f.title)
    );
    expect(moveFindings).toHaveLength(0);
  });
});

describe("Move heuristics — KPI: >= 10 distinct vulnerability classes", () => {
  it("all 10 vulnerable fixtures together produce >= 10 distinct Move titles", () => {
    const vulnerableFixtures = [
      "public-entry.diff",
      "borrow-global-mut.diff",
      "move-from.diff",
      "shared-object.diff",
      "copy-ability.diff",
      "downcast.diff",
      "privileged-fun.diff",
      "vector-borrow.diff",
      "drop-key.diff",
      "init-entrypoint.diff"
    ];

    const distinctTitles = new Set<string>();

    for (const fixture of vulnerableFixtures) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      for (const finding of result.findings) {
        if ((ALL_MOVE_TITLES as readonly string[]).includes(finding.title)) {
          distinctTitles.add(finding.title);
        }
      }
    }

    expect(distinctTitles.size).toBeGreaterThanOrEqual(10);
  });

  it("each of the 10 Move vulnerability classes is covered by its dedicated fixture", () => {
    for (const { fixture, title } of FIXTURE_CASES) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const found = result.findings.some((f) => f.title === title);
      expect(found, `Fixture ${fixture} must trigger "${title}"`).toBe(true);
    }
  });
});
