import { describe, expect, it } from "vitest";
import { runCouncil } from "../src/council.js";
import { renderMarkdownReport, shouldFailForThreshold } from "../src/render.js";

const riskyDiff = `diff --git a/src/example.test.ts b/src/example.test.ts
--- a/src/example.test.ts
+++ b/src/example.test.ts
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
