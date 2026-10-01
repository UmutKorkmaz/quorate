import { afterEach, describe, expect, it, vi } from "vitest";
import { clusterFindings, runCouncil, sortFindings } from "../src/council.js";
import { renderMarkdownReport, shouldFailForThreshold } from "../src/render.js";
import { createDefaultConfig } from "../src/providers.js";
import { shouldFailForPolicy } from "../src/policy.js";
import type { Finding, QuorateConfig } from "../src/types.js";

afterEach(() => vi.unstubAllGlobals());

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

describe("adaptive council execution", () => {
  const config = (): QuorateConfig => ({
    ...createDefaultConfig([]),
    execution: { mode: "adaptive", maxParallelProviders: 2 },
    providers: ["maintainer", "security", "performance"].map((role, index) => ({
      id: `provider-${index}`, type: "api", model: "fixture", roles: [role], baseUrl: `https://fixture-${index}.invalid`
    }))
  });
  const request = (path: string, added = "plain text") => ({
    mode: "review" as const, subject: "adaptive fixture",
    diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${added}\n`
  });
  const response = () => new Response(JSON.stringify({ choices: [{ message: { content: "[]" } }] }), { status: 200 });

  it("runs deterministic evidence first and records every omitted specialist", async () => {
    const events: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      expect(events).toContain("heuristic");
      expect(events).toContain("supply-chain");
      return response();
    }));
    const report = await runCouncil(request("docs/guide.md"), { ...config(), supplyChain: { enabled: true } }, {
      onEvent: (event) => { if (event.type === "provider/done") events.push(event.providerId); }
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(report.metadata.routing?.risk).toBe("low");
    expect(report.metadata.routing?.skipped.map((lane) => lane.role)).toEqual(["security", "performance"]);
    expect(report.providerResults.filter((result) => result.status === "skipped")).toHaveLength(2);
    expect(report.metadata.ranProviders).not.toContain("provider-1:security");
  });

  it("retains policy-required roles and enough distinct real providers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const report = await runCouncil(request("README.md"), config(), { requiredRoles: ["security"], minRealProviders: 3 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(report.metadata.routing?.skipped).toEqual([]);
    expect(report.metadata.routing?.selected.find((lane) => lane.role === "security")?.reason).toContain("policy");
    expect(report.metadata.routing?.selected.find((lane) => lane.role === "performance")?.reason).toContain("floor");
  });

  it("cannot make an impossible policy floor pass", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const report = await runCouncil(request("README.md"), config(), { minRealProviders: 4, requiredRoles: ["missing-role"] });
    expect(shouldFailForPolicy(report, {
      enabled: true, blockOnVerdict: [], failOn: "never", allowWarnMerge: true,
      failOnDegraded: false, rolesRequired: ["missing-role"], minRealProviders: 4
    })).toBe(true);
  });

  it("retains custom roles instead of guessing their relevance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const custom = config();
    custom.providers[1].roles = ["company-policy"];
    const report = await runCouncil(request("README.md"), custom);
    expect(report.metadata.routing?.selected.find((lane) => lane.role === "company-policy")?.reason).toContain("Custom");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("escalates all configured roles when deterministic checks find high risk in documentation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const report = await runCouncil(request("docs/guide.md", 'const token = "fixture-credential-value";'), config());
    expect(report.metadata.routing?.risk).toBe("high");
    expect(report.metadata.routing?.skipped).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(report.verdict).toBe("fail");
  });

  it("enforces measured concurrency without discarding queued roles", async () => {
    let active = 0;
    let peak = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return response();
    }));
    const report = await runCouncil(request("src/main.ts"), config());
    expect(peak).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(report.providerResults.filter((result) => result.providerType === "api" && result.status === "ok")).toHaveLength(3);
  });

  it("interrupts queued providers without starting them after cancellation", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const configured = config();
    configured.execution!.maxParallelProviders = 1;
    const pending = runCouncil(request("src/main.ts"), configured, { signal: controller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort();
    const report = await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(report.providerResults.filter((result) => result.providerType === "api").every((result) => result.status === "interrupted")).toBe(true);
    expect(report.metadata.degraded).toBe(true);
  });

  it("leaves all configured lanes and legacy metadata intact when adaptive mode is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const configured = config();
    delete configured.execution;
    const report = await runCouncil(request("README.md"), configured);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(report.providerResults).toHaveLength(3);
    expect(report.metadata.routing).toBeUndefined();
  });

  it.each([0, 17, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects direct API configurations with invalid concurrency %s", async (maxParallelProviders) => {
    const configured = config();
    configured.execution!.maxParallelProviders = maxParallelProviders;
    await expect(runCouncil(request("README.md"), configured)).rejects.toThrow("maxParallelProviders");
  });
});
