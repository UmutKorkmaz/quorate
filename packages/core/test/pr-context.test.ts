import { describe, expect, it } from "vitest";

import { buildPullRequestContext, redactPrContext } from "../src/pr-context.js";

describe("PR context", () => {
  it("redacts likely secrets", () => {
    expect(redactPrContext("api_key = sk-abc12345678901234567890")).toContain("[REDACTED]");
    expect(redactPrContext("Authorization: ghp_abcdefghijklmnopqrstuvwxyz")).toContain("[REDACTED]");
  });

  it("builds a byte-capped context block", () => {
    const out = buildPullRequestContext(
      {
        number: 7,
        title: "Add checkout",
        body: "A".repeat(200),
        commits: [{ sha: "abcdef1234567890", message: "Implement flow" }]
      },
      120
    );
    expect(out).toContain("PR: #7 Add checkout");
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(140);
    expect(out).toMatch(/truncated/i);
  });
});
