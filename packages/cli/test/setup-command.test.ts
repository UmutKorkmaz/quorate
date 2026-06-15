import { describe, expect, it } from "vitest";

import { type QuorateConfig } from "@quorate/core";

import {
  buildRiskReport,
  generateGithubActionWorkflow,
  mergeVscodeRecommendations
} from "../src/setup-command.js";

function config(overrides: Partial<QuorateConfig> = {}): QuorateConfig {
  return {
    councils: ["security", "maintainer"],
    providers: [
      { id: "heuristic", type: "mock", roles: ["maintainer"], enabled: true },
      { id: "glm", type: "api", model: "glm-5.1", apiKeyEnv: "GLM_API_KEY", roles: ["security"], enabled: true }
    ],
    github: { commentMode: "update", failOn: "high", runnerMode: "auto" },
    ...overrides
  };
}

describe("generateGithubActionWorkflow", () => {
  it("produces a valid Quorate workflow that parses as a config-free YAML doc", () => {
    const yaml = generateGithubActionWorkflow();
    expect(yaml).toContain("name: Quorate");
    expect(yaml).toContain("on:");
    expect(yaml).toContain("pull_request");
    expect(yaml).toContain("UmutKorkmaz/quorate@");
    expect(yaml).toContain("github-token: ${{ secrets.GITHUB_TOKEN }}");
    // pull-requests write permission is required to post the comment
    expect(yaml).toContain("pull-requests: write");
  });
});

describe("mergeVscodeRecommendations", () => {
  it("creates an extensions.json recommending the Quorate extension", () => {
    const merged = JSON.parse(mergeVscodeRecommendations(undefined));
    expect(merged.recommendations).toContain("umutkorkmaz.quorate-vscode");
  });

  it("appends to an existing recommendations array without dropping entries", () => {
    const existing = JSON.stringify({ recommendations: ["dbaeumer.vscode-eslint"] });
    const merged = JSON.parse(mergeVscodeRecommendations(existing));
    expect(merged.recommendations).toContain("dbaeumer.vscode-eslint");
    expect(merged.recommendations).toContain("umutkorkmaz.quorate-vscode");
  });

  it("is idempotent — does not duplicate the recommendation", () => {
    const once = mergeVscodeRecommendations(undefined);
    const twice = mergeVscodeRecommendations(once!);
    const list = JSON.parse(twice!).recommendations.filter((r: string) => r === "umutkorkmaz.quorate-vscode");
    expect(list).toHaveLength(1);
  });

  it("returns null (never clobbers) when the existing file can't be parsed (JSONC)", () => {
    const jsonc = '{\n  // eslint recommended\n  "recommendations": ["dbaeumer.vscode-eslint"]\n}';
    expect(mergeVscodeRecommendations(jsonc)).toBeNull();
  });
});

describe("buildRiskReport", () => {
  it("flags a risk when no real provider is enabled (heuristic-only)", () => {
    const heuristicOnly = config({
      providers: [{ id: "heuristic", type: "mock", roles: ["maintainer"], enabled: true }]
    });
    const report = buildRiskReport({ config: heuristicOnly, detectedPacks: [], hasCiWorkflow: true, missingProviderKeys: [] });
    const realProviders = report.items.find((i) => i.label.toLowerCase().includes("real provider"));
    expect(realProviders?.level).toBe("risk");
  });

  it("is OK on real providers when keys are present and CI is wired", () => {
    const report = buildRiskReport({ config: config(), detectedPacks: [], hasCiWorkflow: true, missingProviderKeys: [] });
    expect(report.items.find((i) => i.label.toLowerCase().includes("real provider"))?.level).toBe("ok");
  });

  it("warns about missing provider key env vars", () => {
    const report = buildRiskReport({
      config: config(),
      detectedPacks: [],
      hasCiWorkflow: true,
      missingProviderKeys: ["GLM_API_KEY"]
    });
    const keys = report.items.find((i) => i.label.toLowerCase().includes("key"));
    expect(keys?.level).toBe("warn");
    expect(keys?.detail).toContain("GLM_API_KEY");
  });

  it("warns when no CI workflow references Quorate", () => {
    const report = buildRiskReport({ config: config(), detectedPacks: [], hasCiWorkflow: false, missingProviderKeys: [] });
    expect(report.items.find((i) => i.label.toLowerCase().includes("ci"))?.level).toBe("warn");
  });

  it("reports the detected stack when packs are present", () => {
    const report = buildRiskReport({
      config: config(),
      detectedPacks: ["web", "evm"],
      hasCiWorkflow: true,
      missingProviderKeys: []
    });
    const stack = report.items.find((i) => i.label.toLowerCase().includes("stack"));
    expect(stack?.detail).toContain("web");
  });
});
