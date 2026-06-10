import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "ci");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

const ALL_CI_TITLES = [
  "pull_request_target trigger",
  "Untrusted input in workflow expression",
  "Action not pinned to a commit SHA",
  "Over-broad workflow permissions",
  "Self-hosted runner",
  "Checks out untrusted PR head",
  "Install script added",
  "Hardcoded registry/auth token",
  "Pipe-to-shell of a remote script",
  "Unpinned base image or remote ADD"
] as const;

type CiTitle = (typeof ALL_CI_TITLES)[number];

interface FixtureCase {
  fixture: string;
  title: CiTitle;
  severity: "critical" | "high" | "medium" | "low" | "info";
  expectedFile: string;
}

const FIXTURE_CASES: FixtureCase[] = [
  {
    fixture: "pull-request-target.diff",
    title: "pull_request_target trigger",
    severity: "high",
    expectedFile: ".github/workflows/ci.yml"
  },
  {
    fixture: "expression-injection.diff",
    title: "Untrusted input in workflow expression",
    severity: "high",
    expectedFile: ".github/workflows/ci.yml"
  },
  {
    fixture: "unpinned-action.diff",
    title: "Action not pinned to a commit SHA",
    severity: "medium",
    expectedFile: ".github/workflows/ci.yml"
  },
  {
    fixture: "broad-permissions.diff",
    title: "Over-broad workflow permissions",
    severity: "medium",
    expectedFile: ".github/workflows/ci.yml"
  },
  {
    fixture: "self-hosted.diff",
    title: "Self-hosted runner",
    severity: "medium",
    expectedFile: ".github/workflows/ci.yml"
  },
  {
    fixture: "pr-head-checkout.diff",
    title: "Checks out untrusted PR head",
    severity: "high",
    expectedFile: ".github/workflows/ci.yml"
  },
  {
    fixture: "install-script.diff",
    title: "Install script added",
    severity: "medium",
    expectedFile: "package.json"
  },
  {
    fixture: "hardcoded-token.diff",
    title: "Hardcoded registry/auth token",
    severity: "high",
    expectedFile: ".npmrc"
  },
  {
    fixture: "pipe-to-shell.diff",
    title: "Pipe-to-shell of a remote script",
    severity: "high",
    expectedFile: ".github/workflows/ci.yml"
  },
  {
    fixture: "docker-latest.diff",
    title: "Unpinned base image or remote ADD",
    severity: "medium",
    expectedFile: "Dockerfile"
  }
];

describe("CI heuristics — vulnerable fixtures (per-class)", () => {
  it("pull-request-target.diff: flags pull_request_target trigger as high", () => {
    const diff = readFixture("pull-request-target.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "pull_request_target trigger");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe(".github/workflows/ci.yml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("expression-injection.diff: flags untrusted input in workflow expression as high", () => {
    const diff = readFixture("expression-injection.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Untrusted input in workflow expression"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe(".github/workflows/ci.yml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("unpinned-action.diff: flags action not pinned to SHA as medium", () => {
    const diff = readFixture("unpinned-action.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Action not pinned to a commit SHA");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe(".github/workflows/ci.yml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("broad-permissions.diff: flags over-broad workflow permissions as medium", () => {
    const diff = readFixture("broad-permissions.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Over-broad workflow permissions");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe(".github/workflows/ci.yml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("self-hosted.diff: flags self-hosted runner as medium", () => {
    const diff = readFixture("self-hosted.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Self-hosted runner");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe(".github/workflows/ci.yml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("pr-head-checkout.diff: flags untrusted PR head checkout as high", () => {
    const diff = readFixture("pr-head-checkout.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Checks out untrusted PR head");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe(".github/workflows/ci.yml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("install-script.diff: flags postinstall script as medium", () => {
    const diff = readFixture("install-script.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Install script added");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("package.json");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("hardcoded-token.diff: flags hardcoded registry token as high", () => {
    const diff = readFixture("hardcoded-token.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Hardcoded registry/auth token");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe(".npmrc");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("pipe-to-shell.diff: flags pipe-to-shell remote script as high", () => {
    const diff = readFixture("pipe-to-shell.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Pipe-to-shell of a remote script");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe(".github/workflows/ci.yml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("docker-latest.diff: flags unpinned base image as medium", () => {
    const diff = readFixture("docker-latest.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Unpinned base image or remote ADD");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("Dockerfile");
    expect(finding!.line).toBeGreaterThan(0);
  });
});

describe("CI heuristics — fixture table (file and line set)", () => {
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

describe("CI heuristics — clean fixture", () => {
  it("clean-ci.diff: yields none of the 10 CI heuristic findings", () => {
    const diff = readFixture("clean-ci.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const ciFindings = result.findings.filter((f) =>
      (ALL_CI_TITLES as readonly string[]).includes(f.title)
    );
    expect(ciFindings).toHaveLength(0);
  });
});

describe("CI heuristics — non-CI diff does not fire CI checks", () => {
  it("a plain Solidity diff does not produce any CI heuristic findings", () => {
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
    const ciFindings = result.findings.filter((f) =>
      (ALL_CI_TITLES as readonly string[]).includes(f.title)
    );
    expect(ciFindings).toHaveLength(0);
  });
});

describe("CI heuristics — KPI: >= 10 distinct vulnerability classes", () => {
  it("all 10 vulnerable fixtures together produce >= 10 distinct CI titles", () => {
    const vulnerableFixtures = [
      "pull-request-target.diff",
      "expression-injection.diff",
      "unpinned-action.diff",
      "broad-permissions.diff",
      "self-hosted.diff",
      "pr-head-checkout.diff",
      "install-script.diff",
      "hardcoded-token.diff",
      "pipe-to-shell.diff",
      "docker-latest.diff"
    ];

    const distinctTitles = new Set<string>();

    for (const fixture of vulnerableFixtures) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      for (const finding of result.findings) {
        if ((ALL_CI_TITLES as readonly string[]).includes(finding.title)) {
          distinctTitles.add(finding.title);
        }
      }
    }

    expect(distinctTitles.size).toBeGreaterThanOrEqual(10);
  });

  it("each of the 10 CI vulnerability classes is covered by its dedicated fixture", () => {
    for (const { fixture, title } of FIXTURE_CASES) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const found = result.findings.some((f) => f.title === title);
      expect(found, `Fixture ${fixture} must trigger "${title}"`).toBe(true);
    }
  });
});
