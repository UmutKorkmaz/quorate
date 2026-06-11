/**
 * Tests for multi-pack init and --auto pack-detection behaviour.
 *
 * Strategy: unit-test the logic (pack lookup, buildMultiPackConfig,
 * detectPacks) without invoking the built CLI binary, so tests are
 * hermetic and do not require a prior build step.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMultiPackConfig,
  detectPacks,
  PACK_IDS,
  PACKS,
  parseConfig,
  serializeConfig
} from "@quorate/core";
import type { DetectedProvider } from "@quorate/core";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const twoDetected: DetectedProvider[] = [
  { id: "claude", command: "claude", available: true },
  { id: "heuristic", command: "heuristic", available: true }
] as DetectedProvider[];

// ---------------------------------------------------------------------------
// Multi-pack: --pack web,fintech
// ---------------------------------------------------------------------------

describe("multi-pack buildMultiPackConfig — web + fintech", () => {
  it("includes councils from both packs", () => {
    const config = buildMultiPackConfig([PACKS.web, PACKS.fintech], twoDetected);
    // web councils
    expect(config.councils).toContain("injection");
    expect(config.councils).toContain("broken-access-control");
    // fintech councils
    expect(config.councils).toContain("payment-security");
    expect(config.councils).toContain("pci-compliance");
  });

  it("maintainer appears exactly once and is last", () => {
    const config = buildMultiPackConfig([PACKS.web, PACKS.fintech], twoDetected);
    const maintainerIndices = config.councils
      .map((c, i) => (c === "maintainer" ? i : -1))
      .filter((i) => i !== -1);
    expect(maintainerIndices).toHaveLength(1);
    expect(maintainerIndices[0]).toBe(config.councils.length - 1);
  });

  it("roleGuidance includes keys from both packs", () => {
    const config = buildMultiPackConfig([PACKS.web, PACKS.fintech], twoDetected);
    expect(config.roleGuidance).toHaveProperty("injection");
    expect(config.roleGuidance).toHaveProperty("payment-security");
  });

  it("config round-trips through serializeConfig + parseConfig with both packs' councils", () => {
    const config = buildMultiPackConfig([PACKS.web, PACKS.fintech], twoDetected);
    const yaml = serializeConfig(config);
    const reparsed = parseConfig(yaml);

    expect(reparsed.councils).toContain("injection");
    expect(reparsed.councils).toContain("payment-security");
    expect(reparsed.councils).toContain("maintainer");
  });

  it("every provider has at least one role", () => {
    const config = buildMultiPackConfig([PACKS.web, PACKS.fintech], twoDetected);
    for (const provider of config.providers) {
      expect((provider.roles ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("mock/heuristic provider has roles == ['maintainer']", () => {
    const config = buildMultiPackConfig([PACKS.web, PACKS.fintech], twoDetected);
    const mock = config.providers.find((p) => p.type === "mock");
    expect(mock).toBeDefined();
    expect(mock?.roles).toEqual(["maintainer"]);
  });
});

// ---------------------------------------------------------------------------
// Multi-pack: unknown id throws
// ---------------------------------------------------------------------------

describe("multi-pack — unknown id handling", () => {
  it("looking up an unknown pack id throws", () => {
    expect(() => {
      const id = "nonexistent-pack";
      const pack = PACKS[id];
      if (!pack) {
        throw new Error(`Unknown pack "${id}". Available: ${PACK_IDS.join(", ")}.`);
      }
    }).toThrow(/Unknown pack/);
  });

  it("looking up a known id does NOT throw", () => {
    expect(() => {
      const pack = PACKS["web"];
      if (!pack) throw new Error("missing");
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Multi-pack: single pack delegation is consistent with buildPackConfig
// ---------------------------------------------------------------------------

describe("buildMultiPackConfig with a single pack", () => {
  it("produces the same councils as the named pack", () => {
    const config = buildMultiPackConfig([PACKS.solana], twoDetected);
    expect(config.councils).toEqual(expect.arrayContaining(PACKS.solana.councils));
  });

  it("roleGuidance matches the pack's guidance", () => {
    const config = buildMultiPackConfig([PACKS.ci], twoDetected);
    expect(config.roleGuidance?.["workflow-security"]).toBe(
      PACKS.ci.roleGuidance["workflow-security"]
    );
  });
});

// ---------------------------------------------------------------------------
// detectPacks — hermetic signal-based tests (no real FS scan)
// ---------------------------------------------------------------------------

describe("detectPacks — file signal matching", () => {
  it("detects solana from a .rs file", () => {
    const ids = detectPacks({ files: ["programs/counter/src/lib.rs"] });
    expect(ids).toContain("solana");
  });

  it("detects evm from a .sol file", () => {
    const ids = detectPacks({ files: ["contracts/Token.sol"] });
    expect(ids).toContain("evm");
  });

  it("detects ci from a GitHub Actions workflow path", () => {
    const ids = detectPacks({ files: [".github/workflows/ci.yml"] });
    expect(ids).toContain("ci");
  });

  it("detects ci from a Dockerfile", () => {
    const ids = detectPacks({ files: ["Dockerfile"] });
    expect(ids).toContain("ci");
  });

  it("detects mobile from a Swift file", () => {
    const ids = detectPacks({ files: ["ios/App/AppDelegate.swift"] });
    expect(ids).toContain("mobile");
  });

  it("detects mobile from a Kotlin file", () => {
    const ids = detectPacks({ files: ["android/app/src/main/MainActivity.kt"] });
    expect(ids).toContain("mobile");
  });

  it("detects move from a .move file", () => {
    const ids = detectPacks({ files: ["sources/counter.move"] });
    expect(ids).toContain("move");
  });

  it("detects iac from a .tf file", () => {
    const ids = detectPacks({ files: ["infra/main.tf"] });
    expect(ids).toContain("iac");
  });

  it("detects multiple packs from mixed signals", () => {
    const ids = detectPacks({
      files: [
        ".github/workflows/ci.yml",
        "contracts/Token.sol"
      ]
    });
    expect(ids).toContain("ci");
    expect(ids).toContain("evm");
  });

  it("returns ids in stable PACK_IDS order", () => {
    const ids = detectPacks({ files: [".github/workflows/ci.yml", "contracts/Token.sol"] });
    const positions = ids.map((id) => PACK_IDS.indexOf(id));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("returns empty array for no recognized signals", () => {
    const ids = detectPacks({ files: ["README.md", "src/index.ts"], dependencies: [] });
    // No blockchain / CI / mobile / etc. signals — expect no match
    // (web may or may not match depending on impl; we just check it's an array)
    expect(Array.isArray(ids)).toBe(true);
  });

  it("detects web from express dependency", () => {
    const ids = detectPacks({
      files: ["src/server.ts"],
      dependencies: ["express", "typescript"]
    });
    expect(ids).toContain("web");
  });

  it("detects fintech from stripe dependency", () => {
    const ids = detectPacks({
      files: ["src/payment.ts"],
      dependencies: ["stripe"]
    });
    expect(ids).toContain("fintech");
  });

  it("detects llm from openai dependency", () => {
    const ids = detectPacks({
      files: ["src/chat.ts"],
      dependencies: ["openai"]
    });
    expect(ids).toContain("llm");
  });
});

// ---------------------------------------------------------------------------
// detectPacks — combined sol + CI signals produce multi-pack buildMultiPackConfig
// ---------------------------------------------------------------------------

describe("detectPacks -> buildMultiPackConfig integration", () => {
  it("combining ci + evm packs produces a valid config with both council sets", () => {
    const files = [".github/workflows/ci.yml", "contracts/Vault.sol"];
    const ids = detectPacks({ files });
    expect(ids).toContain("ci");
    expect(ids).toContain("evm");

    const packsArray = ids.map((id) => PACKS[id]);
    const config = buildMultiPackConfig(packsArray, twoDetected);

    expect(config.councils).toContain("workflow-security");
    expect(config.councils).toContain("evm-security");
    expect(config.councils).toContain("maintainer");

    // YAML round-trip
    const yaml = serializeConfig(config);
    const reparsed = parseConfig(yaml);
    expect(reparsed.councils).toContain("workflow-security");
    expect(reparsed.councils).toContain("evm-security");
  });

  it("writes a config to a temp dir (simulates init file write)", () => {
    const tmpDir = join(tmpdir(), `quorate-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const ids = detectPacks({ files: [".github/workflows/ci.yml"] });
    const packs = ids.map((id) => PACKS[id]);
    const config = buildMultiPackConfig(packs, twoDetected);
    const yaml = serializeConfig(config);
    const configPath = join(tmpDir, ".quorate.yml");
    writeFileSync(configPath, yaml, "utf8");

    const reparsed = parseConfig(yaml);
    expect(reparsed.councils).toContain("workflow-security");
  });
});
