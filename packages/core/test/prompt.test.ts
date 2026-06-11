import { describe, expect, it } from "vitest";
import { buildReviewPrompt } from "../src/prompt.js";
import type { CouncilRequest, ProviderConfig } from "../src/types.js";

const provider: ProviderConfig = { id: "test-provider", type: "api" };

const baseRequest: CouncilRequest = {
  mode: "review",
  subject: "Test subject"
};

const requestWithDiff: CouncilRequest = {
  ...baseRequest,
  diff: "diff --git a/file.ts b/file.ts\n+const x = 1;"
};

describe("buildReviewPrompt", () => {
  describe("no roleGuidance", () => {
    it("contains the role identity line", () => {
      const output = buildReviewPrompt(provider, "security", baseRequest);
      expect(output).toContain("You are the security member of Quorate.");
    });

    it("contains the JSON-array instruction", () => {
      const output = buildReviewPrompt(provider, "security", baseRequest);
      expect(output).toContain(
        'You MAY instead return a JSON array of findings in a fenced ```json block, where each item is'
      );
      expect(output).toContain('{"severity","title","body","file?","line?","suggestion?"}.');
    });

    it("includes the Diff section when diff is present", () => {
      const output = buildReviewPrompt(provider, "security", requestWithDiff);
      expect(output).toContain("\n\nDiff:\n");
      expect(output).toContain(requestWithDiff.diff);
    });

    it("does NOT include a Diff section when diff is absent", () => {
      const output = buildReviewPrompt(provider, "security", baseRequest);
      expect(output).not.toContain("\n\nDiff:\n");
    });

    it("matches the exact legacy string (byte-identical output)", () => {
      const expected = [
        "You are the security member of Quorate.",
        "Mode: review",
        "Subject: Test subject",
        "Return concise findings as Markdown bullets. Use this finding format when possible:",
        "- [severity] Title (path/to/file.ts:12): concrete evidence and recommendation",
        "Use severity values: critical, high, medium, low, info.",
        "You MAY instead return a JSON array of findings in a fenced ```json block, where each item is",
        '{"severity","title","body","file?","line?","suggestion?"}.'
      ].join("\n") + "\n\nProvider: test-provider\n\nDiff:\ndiff --git a/file.ts b/file.ts\n+const x = 1;";

      expect(buildReviewPrompt(provider, "security", requestWithDiff)).toBe(expected);
    });
  });

  describe("with roleGuidance", () => {
    it("injects guidance for the matching role", () => {
      const request: CouncilRequest = {
        ...baseRequest,
        roleGuidance: { security: "Focus on auth bypass vulnerabilities." }
      };
      const output = buildReviewPrompt(provider, "security", request);
      expect(output).toContain("Reviewer guidance for security:");
      expect(output).toContain("Focus on auth bypass vulnerabilities.");
    });

    it("guidance appears between header and Provider line", () => {
      const request: CouncilRequest = {
        ...baseRequest,
        roleGuidance: { security: "Look for injection flaws." }
      };
      const output = buildReviewPrompt(provider, "security", request);
      const guidanceIdx = output.indexOf("Reviewer guidance for security:");
      const providerIdx = output.indexOf("\n\nProvider: test-provider");
      expect(guidanceIdx).toBeGreaterThan(0);
      expect(guidanceIdx).toBeLessThan(providerIdx);
    });

    it("does NOT inject guidance for a different role", () => {
      const request: CouncilRequest = {
        ...baseRequest,
        roleGuidance: { security: "Focus on auth bypass vulnerabilities." }
      };
      const output = buildReviewPrompt(provider, "performance", request);
      expect(output).not.toContain("Reviewer guidance for");
      expect(output).not.toContain("Focus on auth bypass vulnerabilities.");
    });

    it("roleGuidance lacking the active role yields no-guidance output", () => {
      const requestWithGuidance: CouncilRequest = {
        ...requestWithDiff,
        roleGuidance: { performance: "Watch for N+1 queries." }
      };
      const withoutGuidance = buildReviewPrompt(provider, "security", requestWithDiff);
      const withUnrelatedGuidance = buildReviewPrompt(provider, "security", requestWithGuidance);
      expect(withUnrelatedGuidance).toBe(withoutGuidance);
    });
  });
});
