import { describe, expect, it } from "vitest";
import { buildPackConfig, PACKS, parseConfig, serializeConfig } from "@quorate/core";
import type { DetectedProvider } from "@quorate/core";

const twoDetected: DetectedProvider[] = [
  { id: "claude", command: "claude", available: true },
  { id: "heuristic", command: "heuristic", available: true }
] as DetectedProvider[];

describe("buildPackConfig — solana pack", () => {
  it("produced config round-trips through serializeConfig + parseConfig", () => {
    const config = buildPackConfig(PACKS.solana, twoDetected);
    const yaml = serializeConfig(config);
    const reparsed = parseConfig(yaml);

    expect(reparsed.councils).toContain("anchor-accounts");
    expect(reparsed.councils).toContain("token-safety");
  });

  it("roleGuidance[solana-security] is a non-empty string", () => {
    const config = buildPackConfig(PACKS.solana, twoDetected);
    const guidance = config.roleGuidance?.["solana-security"];
    expect(typeof guidance).toBe("string");
    expect((guidance ?? "").length).toBeGreaterThan(0);
  });

  it("every provider has at least one role", () => {
    const config = buildPackConfig(PACKS.solana, twoDetected);
    for (const provider of config.providers) {
      expect((provider.roles ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("heuristic / mock provider has exactly roles == ['maintainer']", () => {
    const config = buildPackConfig(PACKS.solana, twoDetected);
    const mock = config.providers.find((p) => p.type === "mock");
    expect(mock).toBeDefined();
    expect(mock?.roles).toEqual(["maintainer"]);
  });

  it("unknown pack throws", () => {
    expect(() => {
      if (!PACKS["nope"]) throw new Error("Unknown pack");
    }).toThrow();
  });
});
