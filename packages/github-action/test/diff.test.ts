import { describe, expect, it } from "vitest";
import { buildPullRequestDiff } from "../src/diff.js";

describe("buildPullRequestDiff", () => {
  it("formats pull request file patches as a unified diff stream", async () => {
    const client = {
      rest: { pulls: { listFiles: {} } },
      paginate: async () => [
        {
          filename: "src/index.ts",
          status: "modified",
          patch: "@@ -1 +1 @@\n-old\n+new"
        }
      ]
    };

    const diff = await buildPullRequestDiff(client, {
      owner: "owner",
      repo: "repo",
      pullNumber: 1
    });

    expect(diff).toContain("diff --git a/src/index.ts b/src/index.ts");
    expect(diff).toContain("+new");
  });
});
