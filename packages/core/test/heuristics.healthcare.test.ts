import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "healthcare");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

const ALL_HEALTHCARE_TITLES = [
  "PHI written to logs",
  "PHI stored in plaintext literal",
  "PHI in URL/query string",
  "PHI sent to an external service",
  "PHI exposed in API response",
  "PHI sent to analytics/telemetry",
  "Patient record fetched by user-supplied id (verify authorization)",
  "Hardcoded clinical-system credential",
  "Over-broad PHI query (minimum-necessary)",
  "Weak/disabled encryption for PHI"
] as const;

type HealthcareTitle = (typeof ALL_HEALTHCARE_TITLES)[number];

interface FixtureCase {
  fixture: string;
  title: HealthcareTitle;
  severity: "critical" | "high" | "medium" | "low" | "info";
  expectedFile: string;
}

const FIXTURE_CASES: FixtureCase[] = [
  {
    fixture: "phi-in-logs.diff",
    title: "PHI written to logs",
    severity: "high",
    expectedFile: "src/ehr/audit.ts"
  },
  {
    fixture: "phi-plaintext.diff",
    title: "PHI stored in plaintext literal",
    severity: "high",
    expectedFile: "src/ehr/seed-data.ts"
  },
  {
    fixture: "phi-in-url.diff",
    title: "PHI in URL/query string",
    severity: "medium",
    expectedFile: "src/ehr/patient-api.ts"
  },
  {
    fixture: "phi-to-external.diff",
    title: "PHI sent to an external service",
    severity: "medium",
    expectedFile: "src/ehr/notifications.ts"
  },
  {
    fixture: "phi-in-response.diff",
    title: "PHI exposed in API response",
    severity: "medium",
    expectedFile: "src/ehr/records-api.ts"
  },
  {
    fixture: "phi-to-analytics.diff",
    title: "PHI sent to analytics/telemetry",
    severity: "medium",
    expectedFile: "src/ehr/tracking.ts"
  },
  {
    fixture: "patient-idor.diff",
    title: "Patient record fetched by user-supplied id (verify authorization)",
    severity: "medium",
    expectedFile: "src/ehr/patient-service.ts"
  },
  {
    fixture: "clinical-credential.diff",
    title: "Hardcoded clinical-system credential",
    severity: "high",
    expectedFile: "src/ehr/fhir-client.ts"
  },
  {
    fixture: "broad-phi-query.diff",
    title: "Over-broad PHI query (minimum-necessary)",
    severity: "low",
    expectedFile: "src/ehr/reports.ts"
  },
  {
    fixture: "weak-phi-encryption.diff",
    title: "Weak/disabled encryption for PHI",
    severity: "medium",
    expectedFile: "src/ehr/crypto-util.ts"
  }
];

describe("Healthcare heuristics — vulnerable fixtures (per-class)", () => {
  it("phi-in-logs.diff: flags PHI written to logs as high", () => {
    const diff = readFixture("phi-in-logs.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "PHI written to logs");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/ehr/audit.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("phi-plaintext.diff: flags PHI stored in plaintext literal as high", () => {
    const diff = readFixture("phi-plaintext.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "PHI stored in plaintext literal");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/ehr/seed-data.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("phi-in-url.diff: flags PHI in URL/query string as medium", () => {
    const diff = readFixture("phi-in-url.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "PHI in URL/query string");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/ehr/patient-api.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("phi-to-external.diff: flags PHI sent to external service as medium", () => {
    const diff = readFixture("phi-to-external.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "PHI sent to an external service");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/ehr/notifications.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("phi-in-response.diff: flags PHI exposed in API response as medium", () => {
    const diff = readFixture("phi-in-response.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "PHI exposed in API response");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/ehr/records-api.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("phi-to-analytics.diff: flags PHI sent to analytics/telemetry as medium", () => {
    const diff = readFixture("phi-to-analytics.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "PHI sent to analytics/telemetry");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/ehr/tracking.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("patient-idor.diff: flags patient record fetched by user-supplied id as medium", () => {
    const diff = readFixture("patient-idor.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Patient record fetched by user-supplied id (verify authorization)"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/ehr/patient-service.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("clinical-credential.diff: flags hardcoded clinical-system credential as high", () => {
    const diff = readFixture("clinical-credential.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Hardcoded clinical-system credential");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/ehr/fhir-client.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("broad-phi-query.diff: flags over-broad PHI query as low", () => {
    const diff = readFixture("broad-phi-query.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Over-broad PHI query (minimum-necessary)");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("low");
    expect(finding!.file).toBe("src/ehr/reports.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("weak-phi-encryption.diff: flags weak/disabled encryption for PHI as medium", () => {
    const diff = readFixture("weak-phi-encryption.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Weak/disabled encryption for PHI");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/ehr/crypto-util.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });
});

describe("Healthcare heuristics — fixture table (file and line set)", () => {
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

describe("Healthcare heuristics — clean fixture", () => {
  it("clean-healthcare.diff: yields none of the 10 healthcare heuristic findings", () => {
    const diff = readFixture("clean-healthcare.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const healthcareFindings = result.findings.filter((f) =>
      (ALL_HEALTHCARE_TITLES as readonly string[]).includes(f.title)
    );
    expect(healthcareFindings).toHaveLength(0);
  });
});

describe("Healthcare heuristics — non-healthcare diff does not fire healthcare checks", () => {
  it("a plain Solidity diff does not produce any healthcare heuristic findings", () => {
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
    const healthcareFindings = result.findings.filter((f) =>
      (ALL_HEALTHCARE_TITLES as readonly string[]).includes(f.title)
    );
    expect(healthcareFindings).toHaveLength(0);
  });
});

describe("Healthcare heuristics — KPI: >= 10 distinct vulnerability classes", () => {
  it("all 10 vulnerable fixtures together produce >= 10 distinct healthcare titles", () => {
    const vulnerableFixtures = [
      "phi-in-logs.diff",
      "phi-plaintext.diff",
      "phi-in-url.diff",
      "phi-to-external.diff",
      "phi-in-response.diff",
      "phi-to-analytics.diff",
      "patient-idor.diff",
      "clinical-credential.diff",
      "broad-phi-query.diff",
      "weak-phi-encryption.diff"
    ];

    const distinctTitles = new Set<string>();

    for (const fixture of vulnerableFixtures) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      for (const finding of result.findings) {
        if ((ALL_HEALTHCARE_TITLES as readonly string[]).includes(finding.title)) {
          distinctTitles.add(finding.title);
        }
      }
    }

    expect(distinctTitles.size).toBeGreaterThanOrEqual(10);
  });

  it("each of the 10 healthcare vulnerability classes is covered by its dedicated fixture", () => {
    for (const { fixture, title } of FIXTURE_CASES) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const found = result.findings.some((f) => f.title === title);
      expect(found, `Fixture ${fixture} must trigger "${title}"`).toBe(true);
    }
  });
});
