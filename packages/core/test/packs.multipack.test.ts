import { describe, expect, it } from "vitest";
import {
  buildMultiPackConfig,
  buildPackConfig,
  detectPacks,
  PACKS,
  PACK_IDS
} from "../src/packs.js";
import type { DetectedProvider } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Two fake detected providers — one real CLI, one mock-style. */
function makeDetected(): DetectedProvider[] {
  return [
    { id: "claude", command: "claude", available: true },
    { id: "codex", command: "codex", available: true }
  ];
}

// ---------------------------------------------------------------------------
// buildMultiPackConfig — multi-pack merge
// ---------------------------------------------------------------------------

describe("buildMultiPackConfig", () => {
  it("includes councils from all packs with maintainer last exactly once", () => {
    const detected = makeDetected();
    const config = buildMultiPackConfig([PACKS.web, PACKS.fintech], detected);

    // Both packs' domain councils are present.
    expect(config.councils).toContain("ssrf");
    expect(config.councils).toContain("pci-compliance");

    // maintainer appears exactly once.
    const maintainerCount = config.councils.filter((c) => c === "maintainer").length;
    expect(maintainerCount).toBe(1);

    // maintainer is the last element.
    expect(config.councils.at(-1)).toBe("maintainer");
  });

  it("roleGuidance contains keys from both packs", () => {
    const detected = makeDetected();
    const config = buildMultiPackConfig([PACKS.web, PACKS.fintech], detected);

    // web roleGuidance keys.
    expect(config.roleGuidance).toBeDefined();
    expect(config.roleGuidance!["ssrf"]).toBeTruthy();
    // fintech roleGuidance keys.
    expect(config.roleGuidance!["pci-compliance"]).toBeTruthy();
  });

  it("first pack wins on roleGuidance key collision", () => {
    // Both packs share the "maintainer" key — but maintainer is stripped from
    // distribution so it still appears in roleGuidance via the first pack.
    const detected = makeDetected();
    const configWF = buildMultiPackConfig([PACKS.web, PACKS.fintech], detected);
    const configFW = buildMultiPackConfig([PACKS.fintech, PACKS.web], detected);

    // "maintainer" guidance from each pack is different.
    expect(configWF.roleGuidance!["maintainer"]).toBe(PACKS.web.roleGuidance["maintainer"]);
    expect(configFW.roleGuidance!["maintainer"]).toBe(PACKS.fintech.roleGuidance["maintainer"]);
  });

  it("every provider has roles.length >= 1", () => {
    const detected = makeDetected();
    const config = buildMultiPackConfig([PACKS.web, PACKS.fintech], detected);

    for (const provider of config.providers) {
      expect((provider.roles ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("mock (heuristic) provider has roles === ['maintainer']", () => {
    const detected = makeDetected();
    const config = buildMultiPackConfig([PACKS.web, PACKS.fintech], detected);

    const mock = config.providers.find((p) => p.type === "mock");
    expect(mock).toBeDefined();
    expect(mock!.roles).toEqual(["maintainer"]);
  });

  it("single-pack result deep-equals buildPackConfig", () => {
    const detected = makeDetected();
    const multi = buildMultiPackConfig([PACKS.solana], detected);
    const single = buildPackConfig(PACKS.solana, detected);

    expect(multi).toEqual(single);
  });
});

// ---------------------------------------------------------------------------
// detectPacks
// ---------------------------------------------------------------------------

describe("detectPacks", () => {
  it("detects solana, evm, ci from mixed repo files (in PACK_IDS order)", () => {
    const result = detectPacks({
      files: [
        "programs/x/src/lib.rs",
        "app/Foo.sol",
        ".github/workflows/ci.yml"
      ]
    });

    expect(result).toContain("solana");
    expect(result).toContain("evm");
    expect(result).toContain("ci");

    // Must be in PACK_IDS order.
    const solanaIdx = result.indexOf("solana");
    const evmIdx = result.indexOf("evm");
    const ciIdx = result.indexOf("ci");
    expect(PACK_IDS.indexOf("solana")).toBeLessThan(PACK_IDS.indexOf("evm"));
    expect(solanaIdx).toBeLessThan(evmIdx);
    expect(evmIdx).toBeLessThan(ciIdx);
  });

  it("detects mobile from Swift source", () => {
    const result = detectPacks({ files: ["src/App.swift"] });
    expect(result).toEqual(["mobile"]);
  });

  it("detects mobile from Kotlin and Android files", () => {
    const result = detectPacks({
      files: ["app/src/main/MainActivity.kt", "app/src/main/AndroidManifest.xml"]
    });
    expect(result).toContain("mobile");
  });

  it("detects mobile from *.kts build files", () => {
    const result = detectPacks({ files: ["build.gradle.kts"] });
    expect(result).toContain("mobile");
  });

  it("detects mobile from *.plist", () => {
    const result = detectPacks({ files: ["ios/Runner/Info.plist"] });
    expect(result).toContain("mobile");
  });

  it("detects web and fintech from dependency list", () => {
    const result = detectPacks({
      files: ["index.ts"],
      dependencies: ["express", "stripe"]
    });
    expect(result).toContain("web");
    expect(result).toContain("fintech");
  });

  it("detects llm from AI SDK dependencies", () => {
    const resultOpenai = detectPacks({
      files: [],
      dependencies: ["openai"]
    });
    expect(resultOpenai).toContain("llm");

    const resultAnthropic = detectPacks({
      files: [],
      dependencies: ["@anthropic-ai/sdk"]
    });
    expect(resultAnthropic).toContain("llm");
  });

  it("returns empty array when no signals match", () => {
    const result = detectPacks({ files: ["readme.md"] });
    expect(result).toEqual([]);
  });

  it("returns empty array when both files and deps are empty / unmatched", () => {
    const result = detectPacks({ files: [], dependencies: [] });
    expect(result).toEqual([]);
  });

  it("detects move from *.move files", () => {
    const result = detectPacks({ files: ["sources/token.move"] });
    expect(result).toContain("move");
  });

  it("detects move from Move.toml", () => {
    const result = detectPacks({ files: ["Move.toml"] });
    expect(result).toContain("move");
  });

  it("detects iac from terraform files", () => {
    const result = detectPacks({ files: ["infra/main.tf", "infra/terraform.tfvars"] });
    expect(result).toContain("iac");
  });

  it("detects iac from kubernetes YAML paths", () => {
    const result = detectPacks({
      files: ["deploy/k8s/deployment.yaml", "kubernetes/service.yml"]
    });
    expect(result).toContain("iac");
  });

  it("detects ci from Dockerfile", () => {
    const result = detectPacks({ files: ["Dockerfile"] });
    expect(result).toContain("ci");
  });

  it("result order matches PACK_IDS for multi-signal repos", () => {
    const result = detectPacks({
      files: [
        "programs/lib.rs",   // solana
        "contracts/Token.sol", // evm
        "sources/coin.move",   // move
        "infra/main.tf",       // iac
        ".github/workflows/ci.yml", // ci
        "app/ViewController.swift" // mobile
      ],
      dependencies: ["openai", "express", "stripe", "@medplum/core"] // llm, web, fintech, healthcare
    });

    for (let i = 0; i < result.length - 1; i++) {
      expect(PACK_IDS.indexOf(result[i]!)).toBeLessThan(PACK_IDS.indexOf(result[i + 1]!));
    }
  });

  it("deduplicates — same signal matched twice still appears once", () => {
    const result = detectPacks({
      files: ["a.rs", "b.rs", "c.rs"]
    });
    const solanaCount = result.filter((id) => id === "solana").length;
    expect(solanaCount).toBe(1);
  });
});
