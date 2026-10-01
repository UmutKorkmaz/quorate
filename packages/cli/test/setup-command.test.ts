import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig, resolvePolicy, shouldFailForPolicy, type QuorateConfig } from "@quorate/core";

import {
  buildRiskReport,
  generateGithubActionWorkflow,
  mergeVscodeRecommendations,
  runSetupDemo
} from "../src/setup-command.js";

const demoDirectories: string[] = [];
afterEach(() => { for (const dir of demoDirectories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("offline first gate demo", () => {
  it("runs the real deterministic gate against the before and corrected diffs with portable evidence", () => {
    const demo = runSetupDemo(process.cwd());
    demoDirectories.push(demo.directory);
    const config = loadConfig(join(demo.directory, ".quorate.yml"), demo.directory);
    const policy = resolvePolicy(config);
    expect(shouldFailForPolicy(demo.before, policy)).toBe(true);
    expect(shouldFailForPolicy(demo.after, policy)).toBe(false);
    expect(demo.after.findings).toEqual([]);
    expect(demo.before.findings).toContainEqual(expect.objectContaining({ file: ".github/workflows/example.yml", severity: "medium" }));
    expect(config.providers.every((provider) => provider.type === "mock")).toBe(true);
    expect(JSON.parse(readFileSync(join(demo.directory, "blocked.json"), "utf8"))).toEqual(demo.before);
    expect(JSON.parse(readFileSync(join(demo.directory, "passed.json"), "utf8"))).toEqual(demo.after);
    expect(readFileSync(join(demo.directory, "before.diff"), "utf8")).toContain("actions/checkout@v4");
    expect(readFileSync(join(demo.directory, "after.diff"), "utf8")).toContain("actions/checkout@11d5960a326750d5838078e36cf38b85af677262");
  });

  it("accepts a new explicit directory and refuses to overwrite existing work", () => {
    const parent = mkdtempSync(join(tmpdir(), "quorate-demo-parent-"));
    demoDirectories.push(parent);
    const demo = runSetupDemo(parent, "sample");
    expect(demo.directory).toBe(join(parent, "sample"));
    writeFileSync(join(demo.directory, "before.diff"), "user work");
    expect(() => runSetupDemo(parent, "sample")).toThrow(/EEXIST/);
    expect(readFileSync(join(demo.directory, "before.diff"), "utf8")).toBe("user work");
  });
});

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
    expect(yaml).toMatch(/UmutKorkmaz\/quorate@[0-9a-f]{40}/);
    expect(yaml).toContain("Pinned to a reviewed immutable Action bundle commit");
    expect(yaml).toMatch(/actions\/checkout@[0-9a-f]{40}/);
    expect(yaml).toContain("persist-credentials: false");
    expect(yaml).not.toContain("replace the release-candidate tag");
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
