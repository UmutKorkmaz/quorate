import { describe, expect, it } from "vitest";

import { loadBasePolicy } from "../src/index.js";

function fakeClient(files: Record<string, string>): Parameters<typeof loadBasePolicy>[0] {
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
  } as unknown as Parameters<typeof loadBasePolicy>[0];
}

const params = { owner: "o", repo: "r", ref: "base-sha", path: ".quorate/policy.yml" };

describe("loadBasePolicy", () => {
  it("loads and normalizes a policy from the base ref", async () => {
    const yaml = "version: 1\nverdict:\n  fail_on: critical\nroles_required: [security]";
    const policy = await loadBasePolicy(fakeClient({ ".quorate/policy.yml": yaml }), params);
    expect(policy?.failOn).toBe("critical");
    expect(policy?.rolesRequired).toEqual(["security"]);
  });

  it("returns null when the base ref has no policy", async () => {
    expect(await loadBasePolicy(fakeClient({}), params)).toBeNull();
  });

  it("throws on a malformed policy (the caller falls back fail-secure)", async () => {
    await expect(
      loadBasePolicy(fakeClient({ ".quorate/policy.yml": "version: 99" }), params)
    ).rejects.toThrow(/version/i);
  });
});
