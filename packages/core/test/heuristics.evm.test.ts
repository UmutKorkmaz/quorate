import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "evm");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

const ALL_EVM_TITLES = [
  "tx.origin used for authorization",
  "delegatecall to untrusted target",
  "selfdestruct present",
  "Inline assembly",
  "block.timestamp/number dependence",
  "Unbounded loop over dynamic array",
  "Floating pragma",
  "Ether send via low-level call",
  "Unchecked low-level call return",
  "Unchecked ERC20 transfer return"
] as const;

type EvmTitle = typeof ALL_EVM_TITLES[number];

interface FixtureCase {
  fixture: string;
  title: EvmTitle;
  severity: "high" | "medium" | "low" | "info";
  expectedFile: string;
}

const FIXTURE_CASES: FixtureCase[] = [
  {
    fixture: "tx-origin.diff",
    title: "tx.origin used for authorization",
    severity: "high",
    expectedFile: "contracts/Auth.sol"
  },
  {
    fixture: "delegatecall.diff",
    title: "delegatecall to untrusted target",
    severity: "high",
    expectedFile: "contracts/Proxy.sol"
  },
  {
    fixture: "selfdestruct.diff",
    title: "selfdestruct present",
    severity: "high",
    expectedFile: "contracts/Killable.sol"
  },
  {
    fixture: "assembly.diff",
    title: "Inline assembly",
    severity: "medium",
    expectedFile: "contracts/MemUtils.sol"
  },
  {
    fixture: "block-timestamp.diff",
    title: "block.timestamp/number dependence",
    severity: "medium",
    expectedFile: "contracts/Lottery.sol"
  },
  {
    fixture: "unbounded-loop.diff",
    title: "Unbounded loop over dynamic array",
    severity: "medium",
    expectedFile: "contracts/Distributor.sol"
  },
  {
    fixture: "floating-pragma.diff",
    title: "Floating pragma",
    severity: "low",
    expectedFile: "contracts/Token.sol"
  },
  {
    fixture: "ether-call.diff",
    title: "Ether send via low-level call",
    severity: "medium",
    expectedFile: "contracts/Vault.sol"
  },
  {
    fixture: "unchecked-call.diff",
    title: "Unchecked low-level call return",
    severity: "medium",
    expectedFile: "contracts/Forwarder.sol"
  },
  {
    fixture: "unchecked-erc20.diff",
    title: "Unchecked ERC20 transfer return",
    severity: "medium",
    expectedFile: "contracts/Swap.sol"
  }
];

describe("EVM heuristics — vulnerable fixtures (per-class)", () => {
  it("tx-origin.diff: flags tx.origin as high severity", () => {
    const diff = readFixture("tx-origin.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "tx.origin used for authorization"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("contracts/Auth.sol");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("delegatecall.diff: flags delegatecall as high severity", () => {
    const diff = readFixture("delegatecall.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "delegatecall to untrusted target"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("contracts/Proxy.sol");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("selfdestruct.diff: flags selfdestruct as high severity", () => {
    const diff = readFixture("selfdestruct.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "selfdestruct present");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("contracts/Killable.sol");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("assembly.diff: flags inline assembly as medium severity", () => {
    const diff = readFixture("assembly.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Inline assembly");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("contracts/MemUtils.sol");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("block-timestamp.diff: flags block.timestamp dependence as medium severity", () => {
    const diff = readFixture("block-timestamp.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "block.timestamp/number dependence"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("contracts/Lottery.sol");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("unbounded-loop.diff: flags unbounded array loop as medium severity", () => {
    const diff = readFixture("unbounded-loop.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Unbounded loop over dynamic array"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("contracts/Distributor.sol");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("floating-pragma.diff: flags ^-pragma as low severity", () => {
    const diff = readFixture("floating-pragma.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Floating pragma");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("low");
    expect(finding!.file).toBe("contracts/Token.sol");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("ether-call.diff: flags .call{value:} as medium severity", () => {
    const diff = readFixture("ether-call.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Ether send via low-level call"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("contracts/Vault.sol");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("unchecked-call.diff: flags unassigned .call() return as medium severity", () => {
    const diff = readFixture("unchecked-call.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Unchecked low-level call return"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("contracts/Forwarder.sol");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("unchecked-erc20.diff: flags unchecked transferFrom return as medium severity", () => {
    const diff = readFixture("unchecked-erc20.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Unchecked ERC20 transfer return"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("contracts/Swap.sol");
    expect(finding!.line).toBeGreaterThan(0);
  });
});

describe("EVM heuristics — fixture table (file and line set)", () => {
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

describe("EVM heuristics — clean fixture", () => {
  it("clean-solidity.diff: yields none of the 10 EVM heuristic findings", () => {
    const diff = readFixture("clean-solidity.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const evmFindings = result.findings.filter((f) =>
      (ALL_EVM_TITLES as readonly string[]).includes(f.title)
    );
    expect(evmFindings).toHaveLength(0);
  });
});

describe("EVM heuristics — non-EVM diff does not fire EVM checks", () => {
  it("a plain Rust diff does not produce any EVM heuristic findings", () => {
    const diff = [
      "diff --git a/src/lib.rs b/src/lib.rs",
      "--- a/src/lib.rs",
      "+++ b/src/lib.rs",
      "@@ -1,3 +1,4 @@",
      "+pub fn hello() { println!(\"hello\"); }"
    ].join("\n");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const evmFindings = result.findings.filter((f) =>
      (ALL_EVM_TITLES as readonly string[]).includes(f.title)
    );
    expect(evmFindings).toHaveLength(0);
  });
});

describe("EVM heuristics — KPI: >= 10 distinct vulnerability classes", () => {
  it("all 10 vulnerable fixtures together produce >= 10 distinct EVM titles", () => {
    const vulnerableFixtures = [
      "tx-origin.diff",
      "delegatecall.diff",
      "selfdestruct.diff",
      "assembly.diff",
      "block-timestamp.diff",
      "unbounded-loop.diff",
      "floating-pragma.diff",
      "ether-call.diff",
      "unchecked-call.diff",
      "unchecked-erc20.diff"
    ];

    const distinctTitles = new Set<string>();

    for (const fixture of vulnerableFixtures) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      for (const finding of result.findings) {
        if ((ALL_EVM_TITLES as readonly string[]).includes(finding.title)) {
          distinctTitles.add(finding.title);
        }
      }
    }

    expect(distinctTitles.size).toBeGreaterThanOrEqual(10);
  });

  it("each of the 10 EVM vulnerability classes is covered by its dedicated fixture", () => {
    for (const { fixture, title } of FIXTURE_CASES) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const found = result.findings.some((f) => f.title === title);
      expect(found, `Fixture ${fixture} must trigger "${title}"`).toBe(true);
    }
  });
});
