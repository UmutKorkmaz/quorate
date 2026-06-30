import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "../src/providers.js";
import { runCouncil } from "../src/council.js";
import type { QuorateConfig, WebacyIntegrationConfig } from "../src/types.js";
import {
  extractWeb3DdIndicators,
  runWeb3DdReview,
  type WebacyRiskClient
} from "../src/web3-dd.js";

const riskDiff = `diff --git a/src/checkout.ts b/src/checkout.ts
--- a/src/checkout.ts
+++ b/src/checkout.ts
@@ -1,2 +1,8 @@
+export const TOKEN_CONTRACT = "0x1111111111111111111111111111111111111111";
+export const SOLANA_MINT = "So11111111111111111111111111111111111111112";
+export const CLAIM_URL = "https://evil.example/claim";
+await token.approve(spender, MaxUint256);
+await wallet.signTypedData({ domain: { verifyingContract: TOKEN_CONTRACT, chainId: 8453 } });
+await signer.sendRawTransaction(rawTransaction);
`;

function webacyConfig(overrides: Partial<WebacyIntegrationConfig> = {}): WebacyIntegrationConfig {
  return {
    enabled: true,
    apiKeyEnv: "WEBACY_API_KEY",
    chains: ["eth", "base", "sol"],
    failOn: { riskLevel: "high", sanctioned: true, maliciousUrl: true },
    warnOn: { riskLevel: "medium" },
    allowlist: { addresses: [], domains: [], urls: [] },
    cache: { ttlHours: 24 },
    ...overrides
  };
}

function config(overrides: Partial<QuorateConfig> = {}): QuorateConfig {
  const base = createDefaultConfig();
  return {
    ...base,
    councils: ["web3-due-diligence", "wallet-safety", "transaction-safety", "phishing-safety", "maintainer"],
    integrations: { webacy: webacyConfig() },
    ...overrides
  };
}

function fakeClient(): WebacyRiskClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async analyzeAddress(address, chain) {
      calls.push(`address:${chain}:${address}`);
      return {
        count: 1,
        medium: 0,
        high: chain === "base" ? 1 : 0,
        overallRisk: chain === "base" ? 92 : 10,
        issues: chain === "base" ? [{ title: "drainer exposure" }] : []
      };
    },
    async checkSanctioned(address, chain) {
      calls.push(`sanctioned:${chain}:${address}`);
      return { is_sanctioned: false };
    },
    async checkUrl(url) {
      calls.push(`url:${url}`);
      return {
        blacklist: "true",
        prediction: "malicious",
        whitelist: "false",
        details: { confidence: 98, categories: ["phishing"], threat_type: "credential theft" }
      };
    }
  };
}

describe("web3-dd", () => {
  it("extracts EVM addresses, Solana addresses, and URLs from added lines", () => {
    const indicators = extractWeb3DdIndicators(riskDiff, webacyConfig());

    expect(indicators).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "address", chainType: "evm", value: "0x1111111111111111111111111111111111111111" }),
        expect.objectContaining({ kind: "address", chainType: "solana", value: "So11111111111111111111111111111111111111112" }),
        expect.objectContaining({ kind: "url", value: "https://evil.example/claim" })
      ])
    );
  });

  it("runs static Web3 DD findings when the pack is selected without Webacy", async () => {
    const result = await runWeb3DdReview(
      { mode: "review", subject: "static", diff: riskDiff },
      config({ integrations: undefined })
    );

    expect(result?.providerType).toBe("mock");
    expect(result?.findings.map((finding) => finding.title)).toEqual(
      expect.arrayContaining([
        "Hardcoded Web3 address introduced",
        "External Web3 URL introduced",
        "High-risk token approval pattern",
        "Typed-data signing path changed",
        "Raw transaction submission path changed"
      ])
    );
  });

  it("emits a setup finding when Webacy is enabled without an API key", async () => {
    const result = await runWeb3DdReview(
      { mode: "review", subject: "missing key", diff: riskDiff },
      config(),
      { env: {}, cachePath: false }
    );

    expect(result?.status).toBe("error");
    expect(result?.findings).toContainEqual(
      expect.objectContaining({ severity: "high", title: "Webacy API key missing" })
    );
  });

  it("turns mocked Webacy address and URL risk into normal findings", async () => {
    const client = fakeClient();
    const result = await runWeb3DdReview(
      { mode: "review", subject: "webacy", diff: riskDiff, repoPath: "/tmp/quorate-web3-dd-test" },
      config(),
      { env: { WEBACY_API_KEY: "test-key" }, client, cachePath: false }
    );

    expect(result?.status).toBe("ok");
    expect(result?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "high",
          title: "Webacy high-risk address introduced",
          body: expect.stringContaining("drainer exposure")
        }),
        expect.objectContaining({
          severity: "high",
          title: "Webacy high-risk URL introduced",
          body: expect.stringContaining("credential theft")
        })
      ])
    );
    expect(client.calls).toContain("url:https://evil.example/claim");
  });

  it("turns partial Webacy lookup failures into policy-visible findings", async () => {
    const client: WebacyRiskClient = {
      async analyzeAddress() {
        throw new Error("upstream failed with secret test-key");
      },
      async checkSanctioned() {
        return { is_sanctioned: false };
      },
      async checkUrl() {
        return { blacklist: "false", prediction: "safe" };
      }
    };

    const result = await runWeb3DdReview(
      { mode: "review", subject: "partial failure", diff: riskDiff },
      config(),
      { env: { WEBACY_API_KEY: "test-key" }, client, cachePath: false }
    );

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ severity: "high", title: "Webacy lookup failed" })
    );
    expect(result?.error).not.toContain("test-key");
  });

  it("respects allowlisted addresses and domains before querying", async () => {
    const client = fakeClient();
    const result = await runWeb3DdReview(
      { mode: "review", subject: "allowlist", diff: riskDiff },
      config({
        integrations: {
          webacy: webacyConfig({
            allowlist: {
              addresses: ["0x1111111111111111111111111111111111111111"],
              domains: ["evil.example"],
              urls: []
            }
          })
        }
      }),
      { env: { WEBACY_API_KEY: "test-key" }, client, cachePath: false }
    );

    expect(client.calls).not.toContain("url:https://evil.example/claim");
    expect(result?.findings.some((finding) => finding.title.startsWith("Webacy"))).toBe(false);
  });

  it("feeds Web3 DD findings through the normal council report path", async () => {
    const report = await runCouncil(
      { mode: "review", subject: "council", diff: riskDiff },
      config({ integrations: undefined })
    );
    const titles = report.findings.map((finding) => finding.title);

    expect(report.providerResults.some((result) => result.providerId === "web3-dd")).toBe(true);
    expect(report.findings.some((finding) => finding.providerId === "web3-dd")).toBe(true);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Hardcoded Web3 address introduced",
        "External Web3 URL introduced",
        "High-risk token approval pattern",
        "Typed-data signing path changed",
        "Raw transaction submission path changed"
      ])
    );
  });
});
