import { describe, expect, it } from "vitest";

import { redactSecrets, redactUrlCredentials } from "../src/redact.js";

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

  it("redacts Anthropic, AWS, Google, and Slack key shapes", () => {
    // Assembled at runtime: token-shaped literals in the file trip secret
    // scanners (GitHub push protection) even though they are fake fixtures.
    const anthropicKey = ["sk-ant-api3", "A".repeat(28)].join("-");
    const awsKey = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    const googleKey = ["AIzaSy", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"].join("");
    const slackToken = ["xoxb", "1".repeat(24), "2".repeat(24), "AbCdEfGhIjKl"].join("-");
    const output = redactSecrets(
      [`anthropic=${anthropicKey}`, `aws=${awsKey}`, `google=${googleKey}`, `slack=${slackToken}`].join("\n")
    );

    expect(output).not.toContain(anthropicKey);
    expect(output).not.toContain(awsKey);
    expect(output).not.toContain(googleKey);
    expect(output).not.toContain(slackToken);
    expect(output).toContain("[redacted]");
  });

  it("redacts JWTs (three base64url segments)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N60w5f77g32";
    const output = redactSecrets(`token: ${jwt}`);

    expect(output).not.toContain(jwt);
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(output).toContain("[redacted]");
  });

  it("redacts whole PEM private key blocks", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA0123456789abcdefghijklmnopqrstuvwxyzABCD==",
      "-----END RSA PRIVATE KEY-----"
    ].join("\n");
    const output = redactSecrets(`signing key:\n${pem}`);

    expect(output).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(output).not.toContain("MIIEpAIBAAKCAQEA");
    expect(output).toContain("[redacted]");
  });

  it("preserves the Bearer prefix while redacting the credential", () => {
    const output = redactSecrets("Authorization: Bearer abcdefghijklmnop");

    expect(output).toBe("Authorization: Bearer [redacted]");
  });
});

describe("redactUrlCredentials", () => {
  it("masks bare-token userinfo", () => {
    expect(redactUrlCredentials("https://token@api.internal/v1")).toBe(
      "https://[redacted]@api.internal/v1"
    );
  });

  it("masks user:pass userinfo and keeps the path", () => {
    expect(redactUrlCredentials("https://user:super-secret@proxy.internal/v1/chat")).toBe(
      "https://[redacted]@proxy.internal/v1/chat"
    );
  });

  it("leaves URLs without userinfo untouched", () => {
    expect(redactUrlCredentials("https://api.internal/v1")).toBe("https://api.internal/v1");
    expect(redactUrlCredentials("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
  });
});
