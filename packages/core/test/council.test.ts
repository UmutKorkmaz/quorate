import { describe, expect, it } from "vitest";
import { clusterFindings, runCouncil, sortFindings } from "../src/council.js";
import { renderMarkdownReport, shouldFailForThreshold } from "../src/render.js";
import type { Finding } from "../src/types.js";

const riskyDiff = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,5 @@
+const apiKey = "sk-example-secret-value";
+test.only("focused", () => {});
`;

describe("runCouncil", () => {
  it("uses heuristic fallback and returns high-severity findings", async () => {
    const report = await runCouncil({
      mode: "review",
      subject: "fixture",
      diff: riskyDiff
    });

    expect(report.verdict).toBe("fail");
    expect(report.findings.some((finding) => finding.title === "Focused test committed")).toBe(true);
    expect(report.findings.some((finding) => finding.title === "Possible secret in added code")).toBe(true);
    expect(shouldFailForThreshold(report, "high")).toBe(true);
  });

  it("renders a Markdown report with the comment marker", async () => {
    const report = await runCouncil({
      mode: "review",
      subject: "fixture",
      diff: riskyDiff
    });

    const markdown = renderMarkdownReport(report, { includeMarker: true });
    expect(markdown).toContain("<!-- quorate-report -->");
    expect(markdown).toContain("Quorate Report");
  });

  it("exposes the new metadata fields and keeps a real fail verdict despite degraded heuristic-only run", async () => {
    const report = await runCouncil({
      mode: "review",
      subject: "fixture",
      diff: riskyDiff
    });

    // heuristic-only run is degraded, but high-severity findings keep the verdict at fail (no downgrade applies)
    expect(report.verdict).toBe("fail");
    expect(report.metadata.degraded).toBe(true);
    expect(report.metadata.requestedProviders).toContain("heuristic:maintainer");
    expect(report.metadata.ranProviders).toContain("heuristic:maintainer");
    expect(report.providerResults.every((result) => result.providerType === "mock")).toBe(true);
  });
});

describe("clusterFindings", () => {
  it("collapses two providers describing the same bug in different words into one finding with agreement 2", () => {
    const fromA: Finding = {
      severity: "high",
      title: "SQL injection in the user lookup query",
      body: "untrusted user input is concatenated directly into the SQL query string",
      file: "db.ts",
      line: 40,
      providerId: "codex",
      role: "security"
    };
    const fromB: Finding = {
      severity: "critical",
      title: "SQL injection vulnerability in the user lookup query",
      body: "untrusted user input is concatenated directly into the SQL query",
      file: "db.ts",
      line: 42,
      providerId: "review-bot",
      role: "security",
      suggestion: "Use a parameterized query."
    };

    const clustered = clusterFindings([fromA, fromB]);
    expect(clustered).toHaveLength(1);

    const [finding] = clustered;
    expect(finding.agreement).toBe(2);
    expect(finding.agreedBy).toEqual(["codex", "review-bot"]);
    // The highest-severity member is the representative.
    expect(finding.severity).toBe("critical");
    // A missing suggestion on the base is filled from a cluster member.
    expect(finding.suggestion).toBe("Use a parameterized query.");
    expect(finding.confidence).toBeGreaterThan(0.5);
  });

  it("does not collapse distinct findings emitted by the same provider at nearby lines", () => {
    const address: Finding = {
      severity: "low",
      title: "Hardcoded Web3 address introduced",
      body: "0x1111...111111 was added in a Web3-sensitive context. Confirm the address, chain, ownership, and upgrade path before merge.",
      file: "checkout.ts",
      line: 1,
      providerId: "web3-dd",
      role: "web3-due-diligence"
    };
    const url: Finding = {
      severity: "low",
      title: "External Web3 URL introduced",
      body: "evil.example was added in a wallet/token/transaction context. Verify it is not a phishing, malware, or untrusted metadata endpoint.",
      file: "checkout.ts",
      line: 3,
      providerId: "web3-dd",
      role: "web3-due-diligence"
    };

    const clustered = clusterFindings([address, url]);

    expect(clustered.map((finding) => finding.title).sort()).toEqual([
      "External Web3 URL introduced",
      "Hardcoded Web3 address introduced"
    ]);
  });

  it("preserves a lone critical finding raised by a single provider (popularity-trap guard)", () => {
    const lone: Finding = {
      severity: "critical",
      title: "Hardcoded credential",
      body: "an API secret is committed in plaintext",
      file: "config.ts",
      line: 3,
      providerId: "codex",
      role: "security"
    };
    const unrelated: Finding = {
      severity: "low",
      title: "Trailing whitespace",
      body: "cosmetic formatting nit in a comment",
      file: "utils.ts",
      line: 88,
      providerId: "codex",
      role: "maintainer"
    };

    const clustered = clusterFindings([lone, unrelated]);
    const survivor = clustered.find((finding) => finding.title === "Hardcoded credential");
    expect(survivor).toBeDefined();
    expect(survivor?.severity).toBe("critical");
    expect(survivor?.agreement).toBe(1);

    // Sorting keeps the critical singleton at the top despite low agreement.
    expect(sortFindings(clustered)[0].severity).toBe("critical");
  });
});
