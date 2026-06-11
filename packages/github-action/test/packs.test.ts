import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "@quorate/core";
import { applyPacks, changedFilesFromDiff } from "../src/index.js";

const base = () => ({ ...createDefaultConfig(), councils: ["maintainer"], roleGuidance: undefined as Record<string, string> | undefined });

describe("changedFilesFromDiff", () => {
  it("extracts file paths from +++ b/ headers", () => {
    const diff = [
      "diff --git a/app/Token.sol b/app/Token.sol",
      "--- a/app/Token.sol",
      "+++ b/app/Token.sol",
      "@@ -1 +1 @@",
      "+contract C {}",
      "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
      "+++ b/.github/workflows/ci.yml"
    ].join("\n");
    expect(changedFilesFromDiff(diff)).toEqual(["app/Token.sol", ".github/workflows/ci.yml"]);
  });
});

describe("applyPacks", () => {
  it("is a no-op when no pack is requested", () => {
    const config = base();
    expect(applyPacks(config, undefined, ["x.sol"]).councils).toEqual(["maintainer"]);
    expect(applyPacks(config, "", ["x.sol"]).councils).toEqual(["maintainer"]);
  });

  it("layers an explicit pack list onto the config councils + roleGuidance", () => {
    const out = applyPacks(base(), "solana,web", []);
    expect(out.councils).toContain("solana-security");
    expect(out.councils).toContain("ssrf");
    expect(out.councils).toContain("maintainer");
    expect(out.roleGuidance?.["solana-security"]).toBeTruthy();
    expect(out.roleGuidance?.["ssrf"]).toBeTruthy();
  });

  it("auto-detects packs from changed files", () => {
    const out = applyPacks(base(), "auto", ["app/Token.sol", ".github/workflows/ci.yml"]);
    expect(out.councils).toContain("evm-security");
    expect(out.councils).toContain("workflow-security");
  });

  it("auto with no recognizable files leaves the config unchanged", () => {
    const out = applyPacks(base(), "auto", ["README.md"]);
    expect(out.councils).toEqual(["maintainer"]);
  });

  it("throws on an unknown pack id", () => {
    expect(() => applyPacks(base(), "solana,nope", [])).toThrow(/Unknown pack "nope"/);
  });

  it("does not overwrite existing config roleGuidance for a shared council key", () => {
    const config = { ...base(), roleGuidance: { "solana-security": "MY OVERRIDE" } };
    const out = applyPacks(config, "solana", []);
    expect(out.roleGuidance?.["solana-security"]).toBe("MY OVERRIDE");
  });
});
