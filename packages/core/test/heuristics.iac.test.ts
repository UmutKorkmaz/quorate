import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "iac");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

const ALL_IAC_TITLES = [
  "Public storage ACL",
  "Unrestricted ingress (0.0.0.0/0)",
  "Encryption disabled",
  "Public IP assignment",
  "Hardcoded secret in IaC",
  "Privileged container",
  "Host namespace sharing",
  "Container runs as root",
  "Privilege escalation allowed",
  "Mutable image tag (:latest)"
] as const;

type IacTitle = typeof ALL_IAC_TITLES[number];

interface FixtureCase {
  fixture: string;
  title: IacTitle;
  severity: "high" | "medium" | "low" | "info";
  expectedFile: string;
}

const FIXTURE_CASES: FixtureCase[] = [
  {
    fixture: "public-acl.diff",
    title: "Public storage ACL",
    severity: "high",
    expectedFile: "terraform/storage.tf"
  },
  {
    fixture: "open-ingress.diff",
    title: "Unrestricted ingress (0.0.0.0/0)",
    severity: "high",
    expectedFile: "terraform/security_group.tf"
  },
  {
    fixture: "encryption-disabled.diff",
    title: "Encryption disabled",
    severity: "medium",
    expectedFile: "terraform/database.tf"
  },
  {
    fixture: "public-ip.diff",
    title: "Public IP assignment",
    severity: "medium",
    expectedFile: "terraform/ec2.tf"
  },
  {
    fixture: "hardcoded-secret.diff",
    title: "Hardcoded secret in IaC",
    severity: "high",
    expectedFile: "terraform/rds.tf"
  },
  {
    fixture: "privileged.diff",
    title: "Privileged container",
    severity: "high",
    expectedFile: "k8s/deployment.yaml"
  },
  {
    fixture: "host-namespace.diff",
    title: "Host namespace sharing",
    severity: "high",
    expectedFile: "k8s/daemonset.yaml"
  },
  {
    fixture: "run-as-root.diff",
    title: "Container runs as root",
    severity: "medium",
    expectedFile: "k8s/job.yaml"
  },
  {
    fixture: "privilege-escalation.diff",
    title: "Privilege escalation allowed",
    severity: "medium",
    expectedFile: "k8s/pod.yaml"
  },
  {
    fixture: "latest-tag.diff",
    title: "Mutable image tag (:latest)",
    severity: "low",
    expectedFile: "k8s/deployment.yaml"
  }
];

describe("IaC heuristics — vulnerable fixtures (per-class)", () => {
  it("public-acl.diff: flags public storage ACL as high severity", () => {
    const diff = readFixture("public-acl.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Public storage ACL");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("terraform/storage.tf");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("open-ingress.diff: flags 0.0.0.0/0 ingress as high severity", () => {
    const diff = readFixture("open-ingress.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Unrestricted ingress (0.0.0.0/0)"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("terraform/security_group.tf");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("encryption-disabled.diff: flags disabled encryption as medium severity", () => {
    const diff = readFixture("encryption-disabled.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Encryption disabled");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("terraform/database.tf");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("public-ip.diff: flags public IP assignment as medium severity", () => {
    const diff = readFixture("public-ip.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Public IP assignment");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("terraform/ec2.tf");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("hardcoded-secret.diff: flags hardcoded secret as high severity", () => {
    const diff = readFixture("hardcoded-secret.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Hardcoded secret in IaC");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("terraform/rds.tf");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("privileged.diff: flags privileged container as high severity", () => {
    const diff = readFixture("privileged.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Privileged container");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("k8s/deployment.yaml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("host-namespace.diff: flags hostNetwork as high severity", () => {
    const diff = readFixture("host-namespace.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Host namespace sharing");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("k8s/daemonset.yaml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("run-as-root.diff: flags runAsUser 0 as medium severity", () => {
    const diff = readFixture("run-as-root.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Container runs as root");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("k8s/job.yaml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("privilege-escalation.diff: flags allowPrivilegeEscalation as medium severity", () => {
    const diff = readFixture("privilege-escalation.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Privilege escalation allowed"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("k8s/pod.yaml");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("latest-tag.diff: flags :latest image tag as low severity", () => {
    const diff = readFixture("latest-tag.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Mutable image tag (:latest)");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("low");
    expect(finding!.file).toBe("k8s/deployment.yaml");
    expect(finding!.line).toBeGreaterThan(0);
  });
});

describe("IaC heuristics — fixture table (file and line set)", () => {
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

describe("IaC heuristics — clean fixture", () => {
  it("clean-iac.diff: yields none of the 10 IaC heuristic findings", () => {
    const diff = readFixture("clean-iac.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const iacFindings = result.findings.filter((f) =>
      (ALL_IAC_TITLES as readonly string[]).includes(f.title)
    );
    expect(iacFindings).toHaveLength(0);
  });
});

describe("IaC heuristics — non-IaC diff does not fire IaC checks", () => {
  it("a plain Solidity diff does not produce any IaC heuristic findings", () => {
    const diff = [
      "diff --git a/contracts/Token.sol b/contracts/Token.sol",
      "--- a/contracts/Token.sol",
      "+++ b/contracts/Token.sol",
      "@@ -1,3 +1,6 @@",
      "+pragma solidity 0.8.24;",
      "+contract Token {",
      "+    mapping(address => uint256) public balances;",
      "+}"
    ].join("\n");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const iacFindings = result.findings.filter((f) =>
      (ALL_IAC_TITLES as readonly string[]).includes(f.title)
    );
    expect(iacFindings).toHaveLength(0);
  });
});

describe("IaC heuristics — KPI: >= 10 distinct vulnerability classes", () => {
  it("all 10 vulnerable fixtures together produce >= 10 distinct IaC titles", () => {
    const vulnerableFixtures = [
      "public-acl.diff",
      "open-ingress.diff",
      "encryption-disabled.diff",
      "public-ip.diff",
      "hardcoded-secret.diff",
      "privileged.diff",
      "host-namespace.diff",
      "run-as-root.diff",
      "privilege-escalation.diff",
      "latest-tag.diff"
    ];

    const distinctTitles = new Set<string>();

    for (const fixture of vulnerableFixtures) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      for (const finding of result.findings) {
        if ((ALL_IAC_TITLES as readonly string[]).includes(finding.title)) {
          distinctTitles.add(finding.title);
        }
      }
    }

    expect(distinctTitles.size).toBeGreaterThanOrEqual(10);
  });

  it("each of the 10 IaC vulnerability classes is covered by its dedicated fixture", () => {
    for (const { fixture, title } of FIXTURE_CASES) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const found = result.findings.some((f) => f.title === title);
      expect(found, `Fixture ${fixture} must trigger "${title}"`).toBe(true);
    }
  });
});
