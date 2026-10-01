import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCustomPackDefinitions,
  customPackScaffold,
  parseCustomPackYaml,
  type QuorateConfig
} from "@quorate/core";
import { applyWorkspaceCustomPacks, loadWorkspaceCustomPacks } from "../src/custom-packs.js";

/** Run `body` with QUORATE_TRUST_WORKSPACE guaranteed unset. */
function withoutWorkspaceTrust(body: () => void): void {
  const previous = process.env.QUORATE_TRUST_WORKSPACE;
  delete process.env.QUORATE_TRUST_WORKSPACE;
  try {
    body();
  } finally {
    if (previous !== undefined) process.env.QUORATE_TRUST_WORKSPACE = previous;
  }
}

const baseConfig = (): QuorateConfig => ({
  councils: ["maintainer"],
  providers: [{ id: "heuristic", type: "mock", enabled: true, roles: ["maintainer"] }],
  github: { commentMode: "update", failOn: "high", runnerMode: "auto" }
});

function workspaceWithPack(): string {
  const dir = mkdtempSync(join(tmpdir(), "quorate-pack-"));
  const packsDir = join(dir, ".quorate", "packs");
  mkdirSync(packsDir, { recursive: true });
  writeFileSync(join(packsDir, "org-rules.yml"), customPackScaffold("org-rules"), "utf8");
  return dir;
}

describe("workspace custom packs", () => {
  it("skips .quorate/packs in an untrusted workspace (no QUORATE_TRUST_WORKSPACE)", () => {
    const dir = workspaceWithPack();
    // Untrusted by default: a repo's packs are NOT applied without opt-in —
    // identical behavior to no packs being present.
    withoutWorkspaceTrust(() => {
      expect(loadWorkspaceCustomPacks(dir)).toHaveLength(0);

      const config = applyWorkspaceCustomPacks(baseConfig(), dir);
      expect(config.councils).toEqual(["maintainer"]);
      expect(config.roleGuidance).toBeUndefined();
      expect(config.customHeuristics).toBeUndefined();
    });
  });

  it("loads and applies workspace packs when trusted", () => {
    const dir = workspaceWithPack();
    const definitions = loadWorkspaceCustomPacks(dir, true);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.pack.id).toBe("org-rules");

    const config = applyWorkspaceCustomPacks(baseConfig(), dir, true);
    expect(config.councils).toContain("maintainer");
    expect(config.councils).toContain("org-rules-reviewer");
    expect(config.roleGuidance?.["org-rules-reviewer"]).toBeTruthy();
    expect(config.customHeuristics).toHaveLength(1);
  });

  it("applies explicitly provided pack definitions without the trust opt-in", () => {
    // The gate covers DISCOVERY of .quorate/packs in the working repo only.
    // Definitions handed over explicitly (an explicit user-chosen file, or
    // base-ref packs fetched via the API in CI) are not repo self-enablement
    // and must keep loading with QUORATE_TRUST_WORKSPACE unset.
    withoutWorkspaceTrust(() => {
      const definition = parseCustomPackYaml(customPackScaffold("org-rules"), "explicit org-rules.yml");
      const config = applyCustomPackDefinitions(baseConfig(), [definition]);
      expect(config.councils).toContain("org-rules-reviewer");
      expect(config.roleGuidance?.["org-rules-reviewer"]).toBeTruthy();
      expect(config.customHeuristics).toHaveLength(1);
    });
  });

  it("keeps the config (user-level councils, providers) intact when packs are skipped", () => {
    const dir = workspaceWithPack();
    const base = { ...baseConfig(), roleGuidance: { maintainer: "keep me" } };
    const config = applyWorkspaceCustomPacks(base, dir);
    expect(config.councils).toEqual(["maintainer"]);
    expect(config.roleGuidance).toEqual({ maintainer: "keep me" });
    expect(config.providers).toHaveLength(1);
  });
});
