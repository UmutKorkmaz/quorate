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

  it("formats multiple files into one diff stream", async () => {
    const client = {
      rest: { pulls: { listFiles: {} } },
      paginate: async () => [
        { filename: "a.ts", status: "modified", patch: "@@ -1 +1 @@\n-a\n+A" },
        { filename: "b.ts", status: "added", patch: "@@ -0,0 +1 @@\n+B" }
      ]
    };

    const diff = await buildPullRequestDiff(client, { owner: "o", repo: "r", pullNumber: 1 });

    expect(diff).toContain("diff --git a/a.ts b/a.ts");
    expect(diff).toContain("diff --git a/b.ts b/b.ts");
    expect(diff).toContain("+A");
    expect(diff).toContain("+B");
  });

  it("marks files with no textual patch as incomplete evidence", async () => {
    const client = {
      rest: { pulls: { listFiles: {} } },
      paginate: async () => [
        { filename: "logo.png", status: "added" },
        { filename: "old.ts", status: "removed" },
        { filename: "new-name.ts", status: "renamed" }
      ]
    };

    const diff = await buildPullRequestDiff(client, { owner: "o", repo: "r", pullNumber: 1 });

    expect(diff).toContain("# quorate-supply-chain-incomplete: added file has no textual patch");
    expect(diff).toContain("# quorate-supply-chain-incomplete: removed file has no textual patch");
    expect(diff).toContain("# quorate-supply-chain-incomplete: renamed file has no textual patch");
  });

  it("marks a non-empty patch with an incomplete hunk as incomplete evidence", async () => {
    const client = {
      rest: { pulls: { listFiles: {} } },
      paginate: async () => [
        {
          filename: ".github/workflows/release.yml",
          status: "modified",
          patch: "@@ -1,3 +1,3 @@\n-old\n+new"
        }
      ]
    };

    const diff = await buildPullRequestDiff(client, { owner: "o", repo: "r", pullNumber: 1 });

    expect(diff).toContain("# quorate-supply-chain-incomplete: patch hunk is truncated");
  });

  it("truncates the diff once the running byte size exceeds maxBytes", async () => {
    const big = (label: string) => `@@ -1 +1 @@\n-old\n+${"x".repeat(160)}${label}`;
    const client = {
      rest: { pulls: { listFiles: {} } },
      paginate: async () => [
        { filename: "one.ts", status: "modified", patch: big("1") },
        { filename: "two.ts", status: "modified", patch: big("2") },
        { filename: "three.ts", status: "modified", patch: big("3") }
      ]
    };

    const diff = await buildPullRequestDiff(client, { owner: "o", repo: "r", pullNumber: 1 }, 300);

    expect(diff).toContain("diff --git a/one.ts b/one.ts");
    expect(diff).not.toContain("diff --git a/three.ts b/three.ts");
    expect(diff).toContain(
      "# quorate-supply-chain-incomplete: diff truncated to 300 bytes (1 of 3 files shown)"
    );
  });

  it("marks an oversized first patch incomplete instead of bypassing maxBytes", async () => {
    const client = {
      rest: { pulls: { listFiles: {} } },
      paginate: async () => [
        {
          filename: "huge.ts",
          status: "modified",
          patch: `@@ -1 +1 @@\n+${"x".repeat(500)}`
        }
      ]
    };

    const diff = await buildPullRequestDiff(
      client,
      { owner: "o", repo: "r", pullNumber: 1 },
      100
    );

    expect(Buffer.byteLength(diff, "utf8")).toBeLessThanOrEqual(200);
    expect(diff).toContain("# quorate-supply-chain-incomplete: first patch exceeds 100 bytes");
    expect(diff).not.toContain("x".repeat(100));
  });
});
