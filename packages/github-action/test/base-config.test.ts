import { describe, expect, it } from "vitest";
import { loadBaseConfig } from "../src/index.js";

// Minimal Octokit stub: getContent returns a base64 file for known paths, 404 otherwise.
function fakeClient(files: Record<string, string>): Parameters<typeof loadBaseConfig>[0] {
  return {
    rest: {
      repos: {
        getContent: async ({ path }: { path: string }) => {
          if (path in files) {
            return {
              data: {
                type: "file",
                encoding: "base64",
                content: Buffer.from(files[path], "utf8").toString("base64")
              }
            };
          }
          const error = new Error("Not Found") as Error & { status: number };
          error.status = 404;
          throw error;
        }
      }
    }
  } as unknown as Parameters<typeof loadBaseConfig>[0];
}

const params = { owner: "o", repo: "r", ref: "base-sha", candidates: [".quorate.yml", ".quorate.yaml"] };

describe("loadBaseConfig", () => {
  it("loads the config from the base branch (not the PR head)", async () => {
    const yaml = [
      "councils:",
      "  - maintainer",
      "providers:",
      "  - id: codex",
      "    type: cli",
      "    enabled: true",
      "    args: ['exec', '-']"
    ].join("\n");
    const config = await loadBaseConfig(fakeClient({ ".quorate.yml": yaml }), params);
    const codex = config.providers.find((provider) => provider.id === "codex");
    expect(codex?.enabled).toBe(true);
  });

  it("loads Webacy integration settings from the base branch config", async () => {
    const yaml = [
      "councils:",
      "  - web3-due-diligence",
      "  - maintainer",
      "integrations:",
      "  webacy:",
      "    enabled: true",
      "    chains: [eth, base, sol]",
      "    allowlist:",
      "      domains: [trusted.example]"
    ].join("\n");

    const config = await loadBaseConfig(fakeClient({ ".quorate.yml": yaml }), params);
    expect(config.integrations?.webacy?.enabled).toBe(true);
    expect(config.integrations?.webacy?.chains).toEqual(["eth", "base", "sol"]);
    expect(config.integrations?.webacy?.allowlist.domains).toEqual(["trusted.example"]);
  });

  it("falls back to the safe default when the base has no config", async () => {
    const config = await loadBaseConfig(fakeClient({}), params);
    // Default config keeps real providers disabled and only the heuristic enabled.
    expect(config.providers.find((provider) => provider.id === "heuristic")?.enabled).toBe(true);
    expect(config.providers.find((provider) => provider.id === "codex")?.enabled).not.toBe(true);
  });
});
