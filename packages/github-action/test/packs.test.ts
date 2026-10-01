import { describe, expect, it } from "vitest";
import { applyCustomPackDefinitions, createDefaultConfig } from "@quorate/core";
import { applyPacks, changedFilesFromDiff, loadBaseCustomPacks } from "../src/index.js";

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
    const out = applyPacks(base(), "solana,web3-dd", []);
    expect(out.councils).toContain("solana-security");
    expect(out.councils).toContain("web3-due-diligence");
    expect(out.councils).toContain("maintainer");
    expect(out.roleGuidance?.["solana-security"]).toBeTruthy();
    expect(out.roleGuidance?.["web3-due-diligence"]).toBeTruthy();
  });

  it("auto-detects packs from changed files", () => {
    const out = applyPacks(base(), "auto", ["app/Token.sol", ".github/workflows/ci.yml"]);
    expect(out.councils).toContain("evm-security");
    expect(out.councils).toContain("web3-due-diligence");
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

// Minimal Octokit stub: `.quorate/packs` lists files, each pack path serves a
// base64 file, anything else 404s — mirroring loadBaseCustomPacks' API calls.
function packsClient(packs: Record<string, string>): Parameters<typeof loadBaseCustomPacks>[0] {
  return {
    rest: {
      repos: {
        getContent: async ({ path }: { path: string }) => {
          if (path === ".quorate/packs") {
            return {
              data: Object.keys(packs).map((packPath) => ({
                type: "file",
                path: packPath,
                name: packPath.split("/").pop()
              }))
            };
          }
          if (path in packs) {
            return {
              data: {
                type: "file",
                encoding: "base64",
                content: Buffer.from(packs[path], "utf8").toString("base64")
              }
            };
          }
          const error = new Error("Not Found") as Error & { status: number };
          error.status = 404;
          throw error;
        }
      }
    }
  } as unknown as Parameters<typeof loadBaseCustomPacks>[0];
}

const ORG_PACK = [
  "version: 1",
  "id: org-rules",
  "description: Organization rules",
  "councils:",
  "  - org-reviewer",
  "role_guidance:",
  "  org-reviewer: Watch organization-specific risks.",
  "heuristics: []"
].join("\n");

describe("loadBaseCustomPacks", () => {
  it("applies base-ref packs regardless of the workspace trust gate", async () => {
    // Base-ref packs are trusted by design (they come from the base branch,
    // fetched via the API — never the PR head or a local checkout), so the
    // QUORATE_TRUST_WORKSPACE opt-in for local workspace packs must not
    // suppress them. Run with the env var explicitly unset to prove it.
    const previous = process.env.QUORATE_TRUST_WORKSPACE;
    delete process.env.QUORATE_TRUST_WORKSPACE;
    try {
      const definitions = await loadBaseCustomPacks(
        packsClient({ ".quorate/packs/org-rules.yml": ORG_PACK }),
        { owner: "o", repo: "r", ref: "base-sha" }
      );
      expect(definitions).toHaveLength(1);
      expect(definitions[0]?.pack.id).toBe("org-rules");

      const config = applyCustomPackDefinitions({ ...base() }, definitions);
      expect(config.councils).toContain("org-reviewer");
      expect(config.roleGuidance?.["org-reviewer"]).toMatch(/organization/i);
    } finally {
      if (previous !== undefined) process.env.QUORATE_TRUST_WORKSPACE = previous;
    }
  });

  it("returns no definitions when the base has no packs directory", async () => {
    const definitions = await loadBaseCustomPacks(packsClient({}), {
      owner: "o",
      repo: "r",
      ref: "base-sha"
    });
    expect(definitions).toHaveLength(0);
  });
});
