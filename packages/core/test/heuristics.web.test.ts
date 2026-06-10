import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "web");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

const ALL_WEB_TITLES = [
  "SSRF — user input in a server-side request",
  "Command injection (untrusted input in a shell command)",
  "Path traversal (untrusted input in a file path)",
  "Reflected XSS (unescaped input echoed to the response)",
  "Open redirect (user-controlled redirect target)",
  "Mass assignment (request body bound directly to a model)",
  "Permissive CORS (wildcard / reflected origin)",
  "CSRF protection disabled",
  "Insecure deserialization of untrusted data",
  "Weak or broken cryptographic algorithm"
] as const;

type WebTitle = (typeof ALL_WEB_TITLES)[number];

interface FixtureCase {
  fixture: string;
  title: WebTitle;
  severity: "critical" | "high" | "medium" | "low" | "info";
  expectedFile: string;
}

const FIXTURE_CASES: FixtureCase[] = [
  {
    fixture: "ssrf.diff",
    title: "SSRF — user input in a server-side request",
    severity: "high",
    expectedFile: "src/api/proxy.ts"
  },
  {
    fixture: "command-injection.diff",
    title: "Command injection (untrusted input in a shell command)",
    severity: "critical",
    expectedFile: "src/api/convert.ts"
  },
  {
    fixture: "path-traversal.diff",
    title: "Path traversal (untrusted input in a file path)",
    severity: "high",
    expectedFile: "src/api/files.ts"
  },
  {
    fixture: "reflected-xss.diff",
    title: "Reflected XSS (unescaped input echoed to the response)",
    severity: "high",
    expectedFile: "src/api/search.ts"
  },
  {
    fixture: "open-redirect.diff",
    title: "Open redirect (user-controlled redirect target)",
    severity: "medium",
    expectedFile: "src/api/auth.ts"
  },
  {
    fixture: "mass-assignment.diff",
    title: "Mass assignment (request body bound directly to a model)",
    severity: "medium",
    expectedFile: "src/api/users.ts"
  },
  {
    fixture: "cors-wildcard.diff",
    title: "Permissive CORS (wildcard / reflected origin)",
    severity: "medium",
    expectedFile: "src/middleware/cors.ts"
  },
  {
    fixture: "csrf-disabled.diff",
    title: "CSRF protection disabled",
    severity: "medium",
    expectedFile: "src/api/checkout.ts"
  },
  {
    fixture: "insecure-deserialization.diff",
    title: "Insecure deserialization of untrusted data",
    severity: "high",
    expectedFile: "src/api/session.py"
  },
  {
    fixture: "weak-crypto.diff",
    title: "Weak or broken cryptographic algorithm",
    severity: "medium",
    expectedFile: "src/lib/crypto.ts"
  }
];

describe("Web heuristics — vulnerable fixtures (per-class)", () => {
  it("ssrf.diff: flags SSRF as high", () => {
    const diff = readFixture("ssrf.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "SSRF — user input in a server-side request"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/api/proxy.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("command-injection.diff: flags command injection as critical", () => {
    const diff = readFixture("command-injection.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Command injection (untrusted input in a shell command)"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("critical");
    expect(finding!.file).toBe("src/api/convert.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("path-traversal.diff: flags path traversal as high", () => {
    const diff = readFixture("path-traversal.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Path traversal (untrusted input in a file path)"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/api/files.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("reflected-xss.diff: flags reflected XSS as high", () => {
    const diff = readFixture("reflected-xss.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Reflected XSS (unescaped input echoed to the response)"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/api/search.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("open-redirect.diff: flags open redirect as medium", () => {
    const diff = readFixture("open-redirect.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Open redirect (user-controlled redirect target)"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/api/auth.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("mass-assignment.diff: flags mass assignment as medium", () => {
    const diff = readFixture("mass-assignment.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Mass assignment (request body bound directly to a model)"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/api/users.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("cors-wildcard.diff: flags permissive CORS as medium", () => {
    const diff = readFixture("cors-wildcard.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Permissive CORS (wildcard / reflected origin)"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/middleware/cors.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("csrf-disabled.diff: flags CSRF protection disabled as medium", () => {
    const diff = readFixture("csrf-disabled.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "CSRF protection disabled");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/api/checkout.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("insecure-deserialization.diff: flags insecure deserialization as high", () => {
    const diff = readFixture("insecure-deserialization.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Insecure deserialization of untrusted data"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/api/session.py");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("weak-crypto.diff: flags weak cryptographic algorithm as medium", () => {
    const diff = readFixture("weak-crypto.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Weak or broken cryptographic algorithm"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/lib/crypto.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });
});

describe("Web heuristics — fixture table (file and line set)", () => {
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

describe("Web heuristics — clean fixture", () => {
  it("clean-web.diff: yields none of the 10 web heuristic findings", () => {
    const diff = readFixture("clean-web.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const webFindings = result.findings.filter((f) =>
      (ALL_WEB_TITLES as readonly string[]).includes(f.title)
    );
    expect(webFindings).toHaveLength(0);
  });
});

describe("Web heuristics — non-web diff does not fire web checks", () => {
  it("a plain Solidity diff does not produce any web heuristic findings", () => {
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
    const webFindings = result.findings.filter((f) =>
      (ALL_WEB_TITLES as readonly string[]).includes(f.title)
    );
    expect(webFindings).toHaveLength(0);
  });
});

describe("Web heuristics — KPI: >= 10 distinct vulnerability classes", () => {
  it("all 10 vulnerable fixtures together produce >= 10 distinct web titles", () => {
    const vulnerableFixtures = [
      "ssrf.diff",
      "command-injection.diff",
      "path-traversal.diff",
      "reflected-xss.diff",
      "open-redirect.diff",
      "mass-assignment.diff",
      "cors-wildcard.diff",
      "csrf-disabled.diff",
      "insecure-deserialization.diff",
      "weak-crypto.diff"
    ];

    const distinctTitles = new Set<string>();

    for (const fixture of vulnerableFixtures) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      for (const finding of result.findings) {
        if ((ALL_WEB_TITLES as readonly string[]).includes(finding.title)) {
          distinctTitles.add(finding.title);
        }
      }
    }

    expect(distinctTitles.size).toBeGreaterThanOrEqual(10);
  });

  it("each of the 10 web vulnerability classes is covered by its dedicated fixture", () => {
    for (const { fixture, title } of FIXTURE_CASES) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const found = result.findings.some((f) => f.title === title);
      expect(found, `Fixture ${fixture} must trigger "${title}"`).toBe(true);
    }
  });
});
