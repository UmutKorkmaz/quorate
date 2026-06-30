import { describe, expect, it } from "vitest";

import { redactSecrets } from "../src/redact.js";

describe("redactSecrets", () => {
  it("redacts explicit secret values and common token shapes", () => {
    const output = redactSecrets(
      "Authorization: Bearer abcdefghijklmnop\napi_key=sk-secret1234567890\ntoken=github_pat_abcdefghijklmnop",
      ["abcdefghijklmnop"]
    );

    expect(output).toContain("[redacted]");
    expect(output).not.toContain("abcdefghijklmnop");
    expect(output).not.toContain("sk-secret");
    expect(output).not.toContain("github_pat_");
  });
});
