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

const ALL_SOLANA_TITLES = [
  "Unchecked account type",
  "Raw CPI invocation",
  "Unchecked remaining_accounts used in CPI",
  "CPI program account not pinned",
  "Preflight checks disabled",
  "Transaction sent without confirmation",
  "Blockhash expiry not tracked",
  "Confirmation missing blockhash expiry guard",
  "Deprecated blockhash freshness API",
  "Panic in on-chain code",
  "Non-canonical PDA bump",
  "Manual account closing",
  "Unvalidated token account",
  "Token-2022 extension constraints missing",
  "Token-2022 extensions not validated",
  "Unchecked arithmetic on funds",
  "Authority invariant changed",
  "Hardcoded keypair material",
  "Anchor account constraint removed",
  "Anchor account constraint weakened",
  "Solana invariant check removed"
] as const;

type SolanaTitle = typeof ALL_SOLANA_TITLES[number];

interface FixtureCase {
  fixture: string;
  title: SolanaTitle;
  severity: "high" | "medium" | "low" | "info";
  expectedFile: string;
}

const FIXTURE_CASES: FixtureCase[] = [
  {
    fixture: "unchecked-account.diff",
    title: "Unchecked account type",
    severity: "high",
    expectedFile: "programs/foo/src/lib.rs"
  },
  {
    fixture: "raw-cpi.diff",
    title: "Raw CPI invocation",
    severity: "medium",
    expectedFile: "programs/foo/src/processor.rs"
  },
  {
    fixture: "remaining-accounts.diff",
    title: "Unchecked remaining_accounts used in CPI",
    severity: "high",
    expectedFile: "programs/router/src/lib.rs"
  },
  {
    fixture: "cpi-program-unpinned.diff",
    title: "CPI program account not pinned",
    severity: "high",
    expectedFile: "programs/rewards/src/lib.rs"
  },
  {
    fixture: "skip-preflight.diff",
    title: "Preflight checks disabled",
    severity: "medium",
    expectedFile: "app/src/tx.ts"
  },
  {
    fixture: "unconfirmed-transaction.diff",
    title: "Transaction sent without confirmation",
    severity: "medium",
    expectedFile: "app/src/closeEscrow.ts"
  },
  {
    fixture: "blockhash-expiry.diff",
    title: "Blockhash expiry not tracked",
    severity: "medium",
    expectedFile: "app/src/blockhash.ts"
  },
  {
    fixture: "signature-only-confirmation.diff",
    title: "Confirmation missing blockhash expiry guard",
    severity: "medium",
    expectedFile: "app/src/confirm.ts"
  },
  {
    fixture: "deprecated-blockhash.diff",
    title: "Deprecated blockhash freshness API",
    severity: "medium",
    expectedFile: "app/src/legacy-blockhash.ts"
  },
  {
    fixture: "panic.diff",
    title: "Panic in on-chain code",
    severity: "medium",
    expectedFile: "programs/vault/src/lib.rs"
  },
  {
    fixture: "non-canonical-bump.diff",
    title: "Non-canonical PDA bump",
    severity: "medium",
    expectedFile: "programs/escrow/src/lib.rs"
  },
  {
    fixture: "manual-close.diff",
    title: "Manual account closing",
    severity: "high",
    expectedFile: "programs/staking/src/lib.rs"
  },
  {
    fixture: "unvalidated-token.diff",
    title: "Unvalidated token account",
    severity: "medium",
    expectedFile: "programs/swap/src/lib.rs"
  },
  {
    fixture: "token-2022-extension.diff",
    title: "Token-2022 extension constraints missing",
    severity: "medium",
    expectedFile: "programs/swap/src/lib.rs"
  },
  {
    fixture: "token-2022-extension.diff",
    title: "Token-2022 extensions not validated",
    severity: "high",
    expectedFile: "programs/swap/src/lib.rs"
  },
  {
    fixture: "unchecked-arithmetic.diff",
    title: "Unchecked arithmetic on funds",
    severity: "medium",
    expectedFile: "programs/lending/src/lib.rs"
  },
  {
    fixture: "authority-invariant.diff",
    title: "Authority invariant changed",
    severity: "medium",
    expectedFile: "programs/escrow/src/lib.rs"
  },
  {
    fixture: "hardcoded-keypair.diff",
    title: "Hardcoded keypair material",
    severity: "high",
    expectedFile: "app/src/admin.ts"
  },
  {
    fixture: "constraint-removed.diff",
    title: "Anchor account constraint removed",
    severity: "high",
    expectedFile: "programs/governance/src/lib.rs"
  },
  {
    fixture: "constraint-weakened.diff",
    title: "Anchor account constraint weakened",
    severity: "high",
    expectedFile: "programs/governance/src/lib.rs"
  },
  {
    fixture: "invariant-removed.diff",
    title: "Solana invariant check removed",
    severity: "high",
    expectedFile: "programs/pool/src/lib.rs"
  }
];

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

  it("deprecated-blockhash.diff: flags both deprecated blockhash freshness APIs", () => {
    const diff = readFixture("deprecated-blockhash.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const findings = result.findings.filter((f) => f.title === "Deprecated blockhash freshness API");
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.every((f) => f.severity === "medium")).toBe(true);
  });

  it("panic.diff: flags .unwrap() as medium severity Panic in on-chain code", () => {
    const diff = readFixture("panic.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Panic in on-chain code");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("programs/vault/src/lib.rs");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("non-canonical-bump.diff: flags create_program_address as medium severity", () => {
    const diff = readFixture("non-canonical-bump.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Non-canonical PDA bump");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("programs/escrow/src/lib.rs");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("manual-close.diff: flags lamports.borrow_mut() as high severity", () => {
    const diff = readFixture("manual-close.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Manual account closing");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("programs/staking/src/lib.rs");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("unvalidated-token.diff: flags spl_token::state:: as medium severity", () => {
    const diff = readFixture("unvalidated-token.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Unvalidated token account");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("programs/swap/src/lib.rs");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("unchecked-arithmetic.diff: flags balance += without checked_ as medium severity", () => {
    const diff = readFixture("unchecked-arithmetic.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Unchecked arithmetic on funds");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("programs/lending/src/lib.rs");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("hardcoded-keypair.diff: flags fromSecretKey( as high severity", () => {
    const diff = readFixture("hardcoded-keypair.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Hardcoded keypair material");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("app/src/admin.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("constraint-removed.diff: flags removed has_one constraint as high severity", () => {
    const diff = readFixture("constraint-removed.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Anchor account constraint removed");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("programs/governance/src/lib.rs");
    expect(finding!.line).toBeGreaterThan(0);
  });
});

describe("Solana heuristics — fixture table (file and line set)", () => {
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

describe("Solana heuristics — clean fixtures", () => {
  for (const fixture of ["clean-anchor.diff", "clean-web3.diff", "clean-token-2022-validated.diff"]) {
    it(`${fixture}: yields no Solana heuristic findings`, () => {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const solanaFindings = result.findings.filter((f) =>
        (ALL_SOLANA_TITLES as readonly string[]).includes(f.title)
      );
      expect(solanaFindings).toHaveLength(0);
    });
  }
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
      (ALL_SOLANA_TITLES as readonly string[]).includes(f.title)
    );
    expect(solanaFindings).toHaveLength(0);
  });
});

describe("Solana heuristics — KPI: distinct vulnerability classes", () => {
  it("all vulnerable fixtures together produce every Solana title", () => {
    const vulnerableFixtures = [...new Set(FIXTURE_CASES.map((entry) => entry.fixture))];
    const distinctTitles = new Set<string>();

    for (const fixture of vulnerableFixtures) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      for (const finding of result.findings) {
        if ((ALL_SOLANA_TITLES as readonly string[]).includes(finding.title)) {
          distinctTitles.add(finding.title);
        }
      }
    }

    expect(distinctTitles.size).toBe(ALL_SOLANA_TITLES.length);
  });

  it("each Solana vulnerability class is covered by its dedicated fixture", () => {
    for (const { fixture, title } of FIXTURE_CASES) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const found = result.findings.some((f) => f.title === title);
      expect(found, `Fixture ${fixture} must trigger "${title}"`).toBe(true);
    }
  });
});
