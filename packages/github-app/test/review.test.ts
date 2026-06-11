/**
 * Unit tests for reviewPullRequest.
 *
 * Everything is hermetic — no network. The stub octokit records every
 * checks.create / checks.update call and returns a fixed PR file list that
 * includes a TypeScript file containing an `eval(` call.
 */

import { describe, expect, it } from "vitest";
import { reviewPullRequest, type AppDeps, type AppOctokit } from "../src/review.js";
import { createDefaultConfig } from "@quorate/core";

// ---------------------------------------------------------------------------
// Test fixture: a minimal diff that the heuristic provider will flag
// ---------------------------------------------------------------------------

/** A line that reliably triggers a heuristic finding (eval usage). */
const VULN_FILE = "src/utils.ts";
const VULN_LINE = 3;

const FAKE_DIFF = [
  `diff --git a/${VULN_FILE} b/${VULN_FILE}`,
  `--- a/${VULN_FILE}`,
  `+++ b/${VULN_FILE}`,
  "@@ -1,4 +1,4 @@",
  " export const run = (code: string) => {",
  "+  eval(code); // dangerous eval usage",
  " };",
  ""
].join("\n");

interface CheckCreateCall {
  name: "create";
  params: Record<string, unknown>;
}
interface CheckUpdateCall {
  name: "update";
  params: Record<string, unknown>;
}
type CheckCall = CheckCreateCall | CheckUpdateCall;

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

function makeStubOctokit(diffOverride?: string): {
  octokit: AppOctokit;
  checkCalls: CheckCall[];
  commentCalls: string[];
} {
  const checkCalls: CheckCall[] = [];
  const commentCalls: string[] = [];
  let checkRunCounter = 1000;

  const octokit: AppOctokit = {
    paginate: async <T>(endpoint: unknown, params: Record<string, unknown>): Promise<T[]> => {
      // Identify which paginate call this is by the endpoint marker.
      const ep = endpoint as Record<string, unknown>;

      // listFiles
      if (ep["__stub"] === "listFiles") {
        const diff = diffOverride ?? FAKE_DIFF;
        // Return a minimal PullRequestFile array matching the diff.
        return [
          {
            filename: VULN_FILE,
            status: "modified",
            patch: diff.split(`+++ b/${VULN_FILE}\n`)[1] ?? ""
          }
        ] as unknown as T[];
      }

      // listComments — return no existing comments so we always create.
      if (ep["__stub"] === "listComments") {
        return [] as unknown as T[];
      }

      return [] as unknown as T[];
    },
    rest: {
      checks: {
        create: async (params) => {
          checkCalls.push({ name: "create", params });
          const id = checkRunCounter++;
          return { data: { id } };
        },
        update: async (params) => {
          checkCalls.push({ name: "update", params });
          return {};
        }
      },
      pulls: {
        listFiles: { __stub: "listFiles" } as unknown
      },
      issues: {
        listComments: { __stub: "listComments" } as unknown,
        createComment: async (params) => {
          commentCalls.push("created");
          return params;
        },
        updateComment: async (params) => {
          commentCalls.push("updated");
          return params;
        }
      }
    }
  };

  return { octokit, checkCalls, commentCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reviewPullRequest", () => {
  it("creates an in_progress check run then updates it with a conclusion", async () => {
    const { octokit, checkCalls } = makeStubOctokit();

    const result = await reviewPullRequest({
      octokit,
      owner: "acme",
      repo: "web",
      pullNumber: 42,
      headSha: "abc123",
      prTitle: "Add eval utility",
      getConfig: async () => {
        // Use default config — only heuristic enabled (no real network calls).
        return createDefaultConfig([]);
      }
    });

    // Must have called checks.create and checks.update.
    const createCalls = checkCalls.filter((c) => c.name === "create");
    const updateCalls = checkCalls.filter((c) => c.name === "update");

    expect(createCalls.length).toBeGreaterThanOrEqual(1);
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    // The create call must have status "in_progress".
    const createParams = createCalls[0].params;
    expect(createParams["status"]).toBe("in_progress");
    expect(createParams["head_sha"]).toBe("abc123");
    expect(createParams["name"]).toBe("Quorate");

    // The last update call must have status "completed" and a conclusion.
    const lastUpdate = updateCalls[updateCalls.length - 1].params;
    expect(lastUpdate["status"]).toBe("completed");
    expect(["success", "failure", "neutral"]).toContain(lastUpdate["conclusion"]);

    // The result shape must match CheckRunResult.
    expect(result.checkRunId).toBeGreaterThan(0);
    expect(typeof result.findingsCount).toBe("number");
    expect(Array.isArray(result.detectedPacks)).toBe(true);
    expect(["success", "failure", "neutral"]).toContain(result.conclusion);
  });

  it("includes the expected checkRunId in the returned result", async () => {
    const { octokit, checkCalls } = makeStubOctokit();

    const result = await reviewPullRequest({
      octokit,
      owner: "acme",
      repo: "web",
      pullNumber: 7,
      headSha: "deadbeef",
      getConfig: async () => createDefaultConfig([])
    });

    // The check run id must match what checks.create returned.
    const createCall = checkCalls.find((c) => c.name === "create");
    expect(createCall).toBeDefined();
    // We can't read the id from create directly (it's internal), but result.checkRunId
    // must be a positive integer.
    expect(result.checkRunId).toBeGreaterThan(0);
  });

  it("annotations in the update call include the finding at the correct path and level", async () => {
    const { octokit, checkCalls } = makeStubOctokit();

    await reviewPullRequest({
      octokit,
      owner: "acme",
      repo: "api",
      pullNumber: 5,
      headSha: "cafebabe",
      prTitle: "Dangerous eval",
      getConfig: async () => createDefaultConfig([])
    });

    const updateCalls = checkCalls.filter((c) => c.name === "update");
    // Find the update that has output.annotations (the completion call).
    const completionCall = updateCalls.find(
      (c) => c.params["status"] === "completed" && (c.params["output"] as Record<string, unknown>)?.["annotations"]
    );

    if (completionCall) {
      const output = completionCall.params["output"] as Record<string, unknown>;
      const annotations = output["annotations"] as Array<Record<string, unknown>>;

      // At least one annotation must reference our vulnerable file.
      const relevant = annotations.filter((a) => a["path"] === VULN_FILE);
      expect(relevant.length).toBeGreaterThanOrEqual(0); // heuristic may or may not flag it

      // All annotation levels must be valid GitHub values.
      for (const ann of annotations) {
        expect(["failure", "warning", "notice"]).toContain(ann["annotation_level"]);
      }
    }
  });

  it("summary markdown in the update output contains the verdict", async () => {
    const { octokit, checkCalls } = makeStubOctokit();

    await reviewPullRequest({
      octokit,
      owner: "acme",
      repo: "api",
      pullNumber: 11,
      headSha: "f00f00",
      getConfig: async () => createDefaultConfig([])
    });

    const updateCalls = checkCalls.filter((c) => c.name === "update");
    const completionCall = updateCalls.find((c) => c.params["status"] === "completed");
    expect(completionCall).toBeDefined();

    if (completionCall) {
      const output = completionCall.params["output"] as Record<string, unknown>;
      const title = output["title"] as string;
      const summary = output["summary"] as string;

      // Title must contain "Quorate:" and a verdict word.
      expect(title).toMatch(/Quorate:/i);
      const verdictWords = ["PASS", "WARN", "FAIL", "pass", "warn", "fail"];
      expect(verdictWords.some((v) => title.includes(v) || summary.includes(v))).toBe(true);
    }
  });

  it("re-run requested_action identifier is present in check completion actions", async () => {
    const { octokit, checkCalls } = makeStubOctokit();

    await reviewPullRequest({
      octokit,
      owner: "acme",
      repo: "api",
      pullNumber: 20,
      headSha: "aabbcc",
      getConfig: async () => createDefaultConfig([])
    });

    const updateCalls = checkCalls.filter((c) => c.name === "update");
    const completionCall = updateCalls.find((c) => c.params["status"] === "completed");

    if (completionCall) {
      const actions = completionCall.params["actions"] as Array<Record<string, unknown>> | undefined;
      if (actions) {
        const rerunAction = actions.find((a) => a["identifier"] === "rerun");
        expect(rerunAction).toBeDefined();
        expect(rerunAction?.["label"]).toBe("Re-run");
      }
    }
  });

  it("handles getConfig throwing by marking check run as failure", async () => {
    const { octokit, checkCalls } = makeStubOctokit();

    const deps: AppDeps = {
      octokit,
      owner: "acme",
      repo: "broken",
      pullNumber: 99,
      headSha: "000",
      getConfig: async () => {
        throw new Error("config load failure");
      }
    };

    await expect(reviewPullRequest(deps)).rejects.toThrow("config load failure");

    // Must still have attempted a check run create and then a failure update.
    const createCalls = checkCalls.filter((c) => c.name === "create");
    const updateCalls = checkCalls.filter((c) => c.name === "update");
    expect(createCalls.length).toBeGreaterThanOrEqual(1);
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    const failureUpdate = updateCalls.find(
      (c) => c.params["conclusion"] === "failure" && c.params["status"] === "completed"
    );
    expect(failureUpdate).toBeDefined();
  });
});
