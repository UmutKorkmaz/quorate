import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "fintech");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

const ALL_FINTECH_TITLES = [
  "Monetary value stored as float",
  "Card data in logs",
  "Card number literal in source",
  "CVV stored/persisted",
  "Webhook signature verification disabled",
  "Floating-point arithmetic on money",
  "Financial PII in plaintext",
  "TLS certificate verification disabled",
  "Float rounding used for currency",
  "SQL built by string concatenation"
] as const;

type FintechTitle = (typeof ALL_FINTECH_TITLES)[number];

interface FixtureCase {
  fixture: string;
  title: FintechTitle;
  severity: "critical" | "high" | "medium" | "low" | "info";
  expectedFile: string;
}

const FIXTURE_CASES: FixtureCase[] = [
  {
    fixture: "float-money.diff",
    title: "Monetary value stored as float",
    severity: "high",
    expectedFile: "src/payment/cart.ts"
  },
  {
    fixture: "card-in-logs.diff",
    title: "Card data in logs",
    severity: "high",
    expectedFile: "src/payment/processor.ts"
  },
  {
    fixture: "card-literal.diff",
    title: "Card number literal in source",
    severity: "high",
    expectedFile: "src/payment/test-helpers.ts"
  },
  {
    fixture: "cvv-stored.diff",
    title: "CVV stored/persisted",
    severity: "high",
    expectedFile: "src/payment/card-vault.ts"
  },
  {
    fixture: "webhook-unverified.diff",
    title: "Webhook signature verification disabled",
    severity: "medium",
    expectedFile: "src/webhooks/stripe.ts"
  },
  {
    fixture: "float-math.diff",
    title: "Floating-point arithmetic on money",
    severity: "medium",
    expectedFile: "src/payment/invoice.ts"
  },
  {
    fixture: "pii-plaintext.diff",
    title: "Financial PII in plaintext",
    severity: "high",
    expectedFile: "src/kyc/customer.ts"
  },
  {
    fixture: "tls-disabled.diff",
    title: "TLS certificate verification disabled",
    severity: "high",
    expectedFile: "src/payment/gateway-client.ts"
  },
  {
    fixture: "currency-rounding.diff",
    title: "Float rounding used for currency",
    severity: "low",
    expectedFile: "src/payment/display.ts"
  },
  {
    fixture: "sql-concat.diff",
    title: "SQL built by string concatenation",
    severity: "high",
    expectedFile: "src/payment/ledger.ts"
  }
];

describe("Fintech heuristics — vulnerable fixtures (per-class)", () => {
  it("float-money.diff: flags monetary value stored as float as high", () => {
    const diff = readFixture("float-money.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Monetary value stored as float");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/payment/cart.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("card-in-logs.diff: flags card data in logs as high", () => {
    const diff = readFixture("card-in-logs.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Card data in logs");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/payment/processor.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("card-literal.diff: flags card number literal in source as high", () => {
    const diff = readFixture("card-literal.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Card number literal in source");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/payment/test-helpers.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("cvv-stored.diff: flags CVV stored/persisted as high", () => {
    const diff = readFixture("cvv-stored.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "CVV stored/persisted");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/payment/card-vault.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("webhook-unverified.diff: flags webhook signature verification disabled as medium", () => {
    const diff = readFixture("webhook-unverified.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Webhook signature verification disabled"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/webhooks/stripe.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("float-math.diff: flags floating-point arithmetic on money as medium", () => {
    const diff = readFixture("float-math.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Floating-point arithmetic on money");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/payment/invoice.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("pii-plaintext.diff: flags financial PII in plaintext as high", () => {
    const diff = readFixture("pii-plaintext.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Financial PII in plaintext");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/kyc/customer.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("tls-disabled.diff: flags TLS certificate verification disabled as high", () => {
    const diff = readFixture("tls-disabled.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "TLS certificate verification disabled"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/payment/gateway-client.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("currency-rounding.diff: flags float rounding used for currency as low", () => {
    const diff = readFixture("currency-rounding.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Float rounding used for currency");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("low");
    expect(finding!.file).toBe("src/payment/display.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("sql-concat.diff: flags SQL built by string concatenation as high", () => {
    const diff = readFixture("sql-concat.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "SQL built by string concatenation");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/payment/ledger.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });
});

describe("Fintech heuristics — fixture table (file and line set)", () => {
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

describe("Fintech heuristics — clean fixture", () => {
  it("clean-fintech.diff: yields none of the 10 fintech heuristic findings", () => {
    const diff = readFixture("clean-fintech.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const fintechFindings = result.findings.filter((f) =>
      (ALL_FINTECH_TITLES as readonly string[]).includes(f.title)
    );
    expect(fintechFindings).toHaveLength(0);
  });
});

describe("Fintech heuristics — non-fintech diff does not fire fintech checks", () => {
  it("a plain Solidity diff does not produce any fintech heuristic findings", () => {
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
    const fintechFindings = result.findings.filter((f) =>
      (ALL_FINTECH_TITLES as readonly string[]).includes(f.title)
    );
    expect(fintechFindings).toHaveLength(0);
  });
});

describe("Fintech heuristics — KPI: >= 10 distinct vulnerability classes", () => {
  it("all 10 vulnerable fixtures together produce >= 10 distinct fintech titles", () => {
    const vulnerableFixtures = [
      "float-money.diff",
      "card-in-logs.diff",
      "card-literal.diff",
      "cvv-stored.diff",
      "webhook-unverified.diff",
      "float-math.diff",
      "pii-plaintext.diff",
      "tls-disabled.diff",
      "currency-rounding.diff",
      "sql-concat.diff"
    ];

    const distinctTitles = new Set<string>();

    for (const fixture of vulnerableFixtures) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      for (const finding of result.findings) {
        if ((ALL_FINTECH_TITLES as readonly string[]).includes(finding.title)) {
          distinctTitles.add(finding.title);
        }
      }
    }

    expect(distinctTitles.size).toBeGreaterThanOrEqual(10);
  });

  it("each of the 10 fintech vulnerability classes is covered by its dedicated fixture", () => {
    for (const { fixture, title } of FIXTURE_CASES) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const found = result.findings.some((f) => f.title === title);
      expect(found, `Fixture ${fixture} must trigger "${title}"`).toBe(true);
    }
  });
});
