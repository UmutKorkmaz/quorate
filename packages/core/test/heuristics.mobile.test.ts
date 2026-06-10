import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "mobile");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

const ALL_MOBILE_TITLES = [
  "Secret stored in insecure local storage",
  "Hardcoded secret in mobile source",
  "Cleartext HTTP / ATS exception",
  "Exported Android component",
  "WebView JavaScript bridge enabled",
  "TLS certificate validation disabled",
  "Sensitive data written to device logs",
  "Debuggable build flag enabled",
  "Insecure randomness for a security value",
  "Weak Keychain accessibility"
] as const;

type MobileTitle = (typeof ALL_MOBILE_TITLES)[number];

interface FixtureCase {
  fixture: string;
  title: MobileTitle;
  severity: "critical" | "high" | "medium" | "low" | "info";
  expectedFile: string;
}

const FIXTURE_CASES: FixtureCase[] = [
  {
    fixture: "insecure-storage.diff",
    title: "Secret stored in insecure local storage",
    severity: "high",
    expectedFile: "ios/AuthManager.swift"
  },
  {
    fixture: "hardcoded-secret.diff",
    title: "Hardcoded secret in mobile source",
    severity: "high",
    expectedFile: "android/app/src/main/java/com/example/ApiClient.kt"
  },
  {
    fixture: "cleartext-traffic.diff",
    title: "Cleartext HTTP / ATS exception",
    severity: "high",
    expectedFile: "android/app/src/main/AndroidManifest.xml"
  },
  {
    fixture: "exported-component.diff",
    title: "Exported Android component",
    severity: "medium",
    expectedFile: "android/app/src/main/AndroidManifest.xml"
  },
  {
    fixture: "webview-js.diff",
    title: "WebView JavaScript bridge enabled",
    severity: "medium",
    expectedFile: "android/app/src/main/java/com/example/WebActivity.kt"
  },
  {
    fixture: "tls-disabled.diff",
    title: "TLS certificate validation disabled",
    severity: "high",
    expectedFile: "ios/NetworkManager.swift"
  },
  {
    fixture: "sensitive-logging.diff",
    title: "Sensitive data written to device logs",
    severity: "medium",
    expectedFile: "android/app/src/main/java/com/example/LoginManager.kt"
  },
  {
    fixture: "debuggable.diff",
    title: "Debuggable build flag enabled",
    severity: "medium",
    expectedFile: "android/app/src/main/AndroidManifest.xml"
  },
  {
    fixture: "insecure-random.diff",
    title: "Insecure randomness for a security value",
    severity: "medium",
    expectedFile: "ios/CryptoUtil.swift"
  },
  {
    fixture: "keychain-accessibility.diff",
    title: "Weak Keychain accessibility",
    severity: "low",
    expectedFile: "ios/KeychainHelper.swift"
  }
];

describe("Mobile heuristics — vulnerable fixtures (per-class)", () => {
  it("insecure-storage.diff: flags secret in UserDefaults as high", () => {
    const diff = readFixture("insecure-storage.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Secret stored in insecure local storage");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("ios/AuthManager.swift");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("hardcoded-secret.diff: flags hardcoded API key as high", () => {
    const diff = readFixture("hardcoded-secret.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Hardcoded secret in mobile source");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("android/app/src/main/java/com/example/ApiClient.kt");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("cleartext-traffic.diff: flags cleartext HTTP in AndroidManifest as high", () => {
    const diff = readFixture("cleartext-traffic.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Cleartext HTTP / ATS exception");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("android/app/src/main/AndroidManifest.xml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("exported-component.diff: flags exported Android component as medium", () => {
    const diff = readFixture("exported-component.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Exported Android component");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("android/app/src/main/AndroidManifest.xml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("webview-js.diff: flags WebView JS bridge as medium", () => {
    const diff = readFixture("webview-js.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "WebView JavaScript bridge enabled");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("android/app/src/main/java/com/example/WebActivity.kt");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("tls-disabled.diff: flags TLS certificate validation disabled as high", () => {
    const diff = readFixture("tls-disabled.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "TLS certificate validation disabled");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("ios/NetworkManager.swift");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("sensitive-logging.diff: flags sensitive data in device logs as medium", () => {
    const diff = readFixture("sensitive-logging.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Sensitive data written to device logs");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("android/app/src/main/java/com/example/LoginManager.kt");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("debuggable.diff: flags debuggable build flag as medium", () => {
    const diff = readFixture("debuggable.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Debuggable build flag enabled");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("android/app/src/main/AndroidManifest.xml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("insecure-random.diff: flags arc4random for security value as medium", () => {
    const diff = readFixture("insecure-random.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Insecure randomness for a security value");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("ios/CryptoUtil.swift");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("keychain-accessibility.diff: flags kSecAttrAccessibleAlways as low", () => {
    const diff = readFixture("keychain-accessibility.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Weak Keychain accessibility");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("low");
    expect(finding!.file).toBe("ios/KeychainHelper.swift");
    expect(finding!.line).toBeGreaterThan(0);
  });
});

describe("Mobile heuristics — fixture table (file and line set)", () => {
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

describe("Mobile heuristics — clean fixture", () => {
  it("clean-mobile.diff: yields none of the 10 mobile heuristic findings", () => {
    const diff = readFixture("clean-mobile.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const mobileFindings = result.findings.filter((f) =>
      (ALL_MOBILE_TITLES as readonly string[]).includes(f.title)
    );
    expect(mobileFindings).toHaveLength(0);
  });
});

describe("Mobile heuristics — non-mobile diffs do not fire mobile checks", () => {
  it("a plain TypeScript diff does not produce any mobile heuristic findings", () => {
    const diff = [
      "diff --git a/src/api/users.ts b/src/api/users.ts",
      "--- a/src/api/users.ts",
      "+++ b/src/api/users.ts",
      "@@ -1,3 +1,6 @@",
      "+export function getUser(id: string) {",
      "+  const token = process.env.API_TOKEN;",
      "+  return fetch(`/api/users/${id}`, { headers: { Authorization: `Bearer ${token}` } });",
      "+"
    ].join("\n");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const mobileFindings = result.findings.filter((f) =>
      (ALL_MOBILE_TITLES as readonly string[]).includes(f.title)
    );
    expect(mobileFindings).toHaveLength(0);
  });

  it("a Solidity diff does not produce any mobile heuristic findings", () => {
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
    const mobileFindings = result.findings.filter((f) =>
      (ALL_MOBILE_TITLES as readonly string[]).includes(f.title)
    );
    expect(mobileFindings).toHaveLength(0);
  });
});

describe("Mobile heuristics — KPI: >= 10 distinct vulnerability classes", () => {
  it("all 10 vulnerable fixtures together produce >= 10 distinct mobile titles", () => {
    const vulnerableFixtures = [
      "insecure-storage.diff",
      "hardcoded-secret.diff",
      "cleartext-traffic.diff",
      "exported-component.diff",
      "webview-js.diff",
      "tls-disabled.diff",
      "sensitive-logging.diff",
      "debuggable.diff",
      "insecure-random.diff",
      "keychain-accessibility.diff"
    ];

    const distinctTitles = new Set<string>();

    for (const fixture of vulnerableFixtures) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      for (const finding of result.findings) {
        if ((ALL_MOBILE_TITLES as readonly string[]).includes(finding.title)) {
          distinctTitles.add(finding.title);
        }
      }
    }

    expect(distinctTitles.size).toBeGreaterThanOrEqual(10);
  });

  it("each of the 10 mobile vulnerability classes is covered by its dedicated fixture", () => {
    for (const { fixture, title } of FIXTURE_CASES) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const found = result.findings.some((f) => f.title === title);
      expect(found, `Fixture ${fixture} must trigger "${title}"`).toBe(true);
    }
  });
});
