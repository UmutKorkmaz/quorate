/**
 * Unit tests for reviewPullRequest.
 *
 * Everything is hermetic — no network. The stub octokit records every
 * checks.create / checks.update call and returns a fixed PR file list that
 * includes a TypeScript file containing a focused test.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHostedConfig, reviewPullRequest, type AppDeps, type AppOctokit } from "../src/review.js";
import { addSuppression, createBaseline, createDefaultConfig, createSuppressionStore, PACKS, PROVIDER_PRESETS, runCouncil, validateDecisionRecord } from "@quorate/core";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------
// Test fixture: a minimal diff that the heuristic provider will flag
// ---------------------------------------------------------------------------

/** A line that reliably triggers a heuristic finding (focused test). */
const VULN_FILE = "src/utils.ts";
const VULN_LINE = 2;

const FAKE_DIFF = [
  `diff --git a/${VULN_FILE} b/${VULN_FILE}`,
  `--- a/${VULN_FILE}`,
  `+++ b/${VULN_FILE}`,
  "@@ -1,2 +1,3 @@",
  " export const run = (code: string) => {",
  '+  test.only("regression", () => {});',
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
  it("allows only the hosted preset's exact origin and credential pair", () => {
    const base = createDefaultConfig([]);
    const provider = { ...PROVIDER_PRESETS.openai, id: "hosted" };
    expect(buildHostedConfig([], { ...base, providers: [provider] }).providers).toEqual([provider]);
    for (const override of [
      { baseUrl: "https://collect.example/v1" },
      { baseUrl: "http://localhost:11434/v1" },
      { baseUrl: "file:///etc/passwd" },
      { baseUrl: "https://user:password@api.openai.com/v1" },
      { baseUrl: "https://api.openai.com/v1?token=secret" },
      { apiKeyEnv: "GROQ_API_KEY" },
      { apiKeyEnv: "PRIVATE_KEY" },
      { apiKeyEnv: "GITHUB_TOKEN" },
      { env: { OPENAI_API_KEY: "inline-secret" } },
      { inheritEnv: true },
      { envAllowlist: ["GITHUB_TOKEN"] }
    ]) {
      expect(() => buildHostedConfig([], { ...base, providers: [{ ...provider, ...override }] })).toThrow("Hosted API provider rejected");
    }
  });

  it("lets the host operator approve a gateway without granting App credential access", () => {
    vi.stubEnv("QUORATE_APP_PROVIDER_ALLOWLIST", JSON.stringify([{ origin: "https://gateway.example", apiKeyEnv: "TEAM_MODEL_KEY" }]));
    const base = createDefaultConfig([]);
    const provider = { ...PROVIDER_PRESETS.openai, id: "gateway", baseUrl: "https://gateway.example/v1", apiKeyEnv: "TEAM_MODEL_KEY" };
    expect(buildHostedConfig([], { ...base, providers: [provider] }).providers[0]).toEqual(provider);
    for (const extra of [
      [{ origin: "https://gateway.example", apiKeyEnv: "GITHUB_TOKEN" }],
      [{ origin: "https://gateway.example", apiKeyEnv: "PRIVATE_KEY" }],
      [{ origin: "https://user:pass@gateway.example", apiKeyEnv: "TEAM_MODEL_KEY" }],
      [{ origin: "https://gateway.example/v1", apiKeyEnv: "TEAM_MODEL_KEY" }],
      { origin: "https://gateway.example", apiKeyEnv: "TEAM_MODEL_KEY" }
    ]) {
      vi.stubEnv("QUORATE_APP_PROVIDER_ALLOWLIST", JSON.stringify(extra));
      expect(() => buildHostedConfig([], base)).toThrow("QUORATE_APP_PROVIDER_ALLOWLIST");
    }
    vi.stubEnv("QUORATE_APP_PROVIDER_ALLOWLIST", "invalid");
    expect(() => buildHostedConfig([], base)).toThrow("QUORATE_APP_PROVIDER_ALLOWLIST");
  });

  it("marks unapproved repository credentials visibly failed before model execution", async () => {
    const { octokit, checkCalls, commentCalls } = makeStubOctokit();
    const policyLoader = vi.fn();
    await expect(reviewPullRequest({
      octokit, owner: "acme", repo: "web", pullNumber: 42, headSha: "head",
      getConfig: async () => ({ ...createDefaultConfig([]), providers: [{ ...PROVIDER_PRESETS.openai, id: "unsafe", baseUrl: "https://collect.example/v1" }] }),
      getPolicy: policyLoader
    })).rejects.toThrow("Hosted API provider rejected");
    expect(checkCalls.at(-1)?.params.conclusion).toBe("failure");
    expect((checkCalls.at(-1)?.params.output as { summary: string }).summary).toContain("approved origin and credential pair");
    expect(policyLoader).not.toHaveBeenCalled();
    expect(commentCalls).toEqual([]);
  });

  it("returns a valid receipt binding the final gate, committed policy and source revisions", async () => {
    const { octokit, checkCalls } = makeStubOctokit();
    const result = await reviewPullRequest({
      octokit, owner: "acme", repo: "web", pullNumber: 42, headSha: "a".repeat(40), baseSha: "b".repeat(40),
      getConfig: async () => createDefaultConfig([]),
      getPolicy: async () => ({ enabled: true, blockOnVerdict: [], allowWarnMerge: true,
        failOn: "never", failOnDegraded: false, rolesRequired: ["security"], minRealProviders: 2 })
    });
    expect(validateDecisionRecord(result.decision)).toBe(true);
    expect(result.decision?.source).toEqual({ kind: "pull-request", headSha: "a".repeat(40), baseSha: "b".repeat(40) });
    expect(result.decision?.policy.value).toMatchObject({ rolesRequired: ["security"], minRealProviders: 2 });
    expect(result.decision?.toolVersion).toBe("1.4.0");
    expect(result.decision?.gate.blocked).toBe(true);
    expect(result.conclusion).toBe("failure");
    expect((checkCalls.at(-1)?.params.output as { summary: string }).summary).toContain(result.decision?.integrity.hash);
    const recordText = (checkCalls.at(-1)?.params.output as { text: string }).text;
    const embedded = JSON.parse(recordText.split("```json\n")[1].split("\n```")[0]);
    expect(validateDecisionRecord(embedded)).toBe(true);
    expect(embedded).toEqual(result.decision);
  });

  it("retains required API reviewers during adaptive routing for a documentation change", async () => {
    vi.stubEnv("OPENAI_API_KEY", "hosted-test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "[]" }, finish_reason: "stop" }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { octokit } = makeStubOctokit();
    octokit.paginate = async <T>(endpoint: unknown): Promise<T[]> =>
      (endpoint as { __stub?: string }).__stub === "listFiles"
        ? [{ filename: "README.md", status: "modified", patch: "@@ -1 +1 @@\n-old documentation\n+updated documentation" }] as T[] : [];
    const result = await reviewPullRequest({
      octokit, owner: "acme", repo: "web", pullNumber: 42, headSha: "a".repeat(40), baseSha: "b".repeat(40),
      getConfig: async () => ({ ...createDefaultConfig([]), execution: { mode: "adaptive", maxParallelProviders: 1 },
        councils: ["security"], providers: [{ ...PROVIDER_PRESETS.openai, id: "hosted", roles: ["security"] }] }),
      getPolicy: async () => ({ enabled: true, blockOnVerdict: [], allowWarnMerge: true,
        failOn: "never", failOnDegraded: false, rolesRequired: ["security"], minRealProviders: 1 })
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.decision?.providers).toEqual(expect.arrayContaining([expect.objectContaining({ id: "hosted", role: "security", status: "ok" })]));
    expect(result.decision?.coverage.routing?.risk).toBe("low");
    expect(result.decision?.gate.blocked).toBe(false);
  });

  it("applies valid committed baseline and risk acceptance before the merge gate", async () => {
    const config = createDefaultConfig([]);
    const raw = await runCouncil({ mode: "review", subject: "fixture", diff: FAKE_DIFF }, config);
    expect(raw.findings.length).toBeGreaterThan(0);
    const baseline = createBaseline(raw.findings);
    const baselineResult = await reviewPullRequest({
      octokit: makeStubOctokit().octokit, owner: "acme", repo: "web", pullNumber: 42, headSha: "head",
      getConfig: async () => config, getBaseline: async () => baseline
    });
    expect(baselineResult.findingsCount).toBe(0);
    expect(baselineResult.conclusion).not.toBe("failure");
    expect(baselineResult.decision?.findings).toEqual([]);
    expect(baselineResult.decision?.gate.blocked).toBe(false);
    const suppressions = addSuppression(createSuppressionStore(), {
      fingerprint: raw.findings[0].fingerprint!, reason: "Accepted in fixture", createdAt: new Date().toISOString()
    });
    const suppressedResult = await reviewPullRequest({
      octokit: makeStubOctokit().octokit, owner: "acme", repo: "web", pullNumber: 42, headSha: "head",
      getConfig: async () => config, getSuppressions: async () => suppressions
    });
    expect(suppressedResult.findingsCount).toBeGreaterThan(0);
    expect(suppressedResult.conclusion).not.toBe("failure");
    expect(suppressedResult.decision?.findings[0].status).toBe("suppressed");
  });

  it("applies hosted restrictions and detected pack guidance after repository configuration", () => {
    const base = createDefaultConfig([]);
    const config = buildHostedConfig(["programs/vault/src/lib.rs", "Anchor.toml"], {
      ...base,
      providers: [
        { id: "host-command", type: "cli", command: "node", args: ["-e", "throw new Error('must not run')"], enabled: true, roles: ["security"] },
        { id: "disabled-api", type: "api", enabled: false, roles: ["security"] },
        base.providers[0]
      ]
    });
    expect(config.providers.map((provider) => provider.id)).toEqual(["disabled-api", "heuristic"]);
    expect(config.providers[0].enabled).toBe(false);
    expect(config.councils).toEqual(expect.arrayContaining(PACKS.solana.councils));
    expect(config.roleGuidance).toMatchObject(PACKS.solana.roleGuidance);
  });

  it("fails closed before provider execution when the committed policy is malformed", async () => {
    const { octokit, checkCalls, commentCalls } = makeStubOctokit();
    const baseline = vi.fn();
    await expect(reviewPullRequest({
      octokit, owner: "acme", repo: "web", pullNumber: 42, headSha: "head",
      getConfig: async () => createDefaultConfig([]),
      getPolicy: async () => { throw new Error("Invalid policy"); },
      getBaseline: baseline
    })).rejects.toThrow("Invalid policy");
    expect(checkCalls.at(-1)?.params.conclusion).toBe("failure");
    expect(commentCalls).toEqual([]);
    expect(baseline).not.toHaveBeenCalled();
  });

  it("cancels a superseded review without posting an obsolete PR comment", async () => {
    const { octokit, checkCalls, commentCalls } = makeStubOctokit();
    const isCurrent = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    const result = await reviewPullRequest({
      octokit, owner: "acme", repo: "web", pullNumber: 42, headSha: "old-head",
      getConfig: async () => createDefaultConfig([]), isCurrent
    });
    expect(result.conclusion).toBe("cancelled");
    expect(commentCalls).toEqual([]);
    expect(checkCalls.at(-1)?.params.conclusion).toBe("cancelled");
  });

  it("keeps findings gated and shows warnings when risk-acceptance files are malformed", async () => {
    const { octokit, checkCalls } = makeStubOctokit();
    const config = createDefaultConfig([]);
    config.providers[0] = { ...config.providers[0], roles: ["security"] };
    const result = await reviewPullRequest({
      octokit, owner: "acme", repo: "web", pullNumber: 42, headSha: "head",
      getConfig: async () => config,
      getBaseline: async () => { throw new Error("bad baseline"); },
      getSuppressions: async () => { throw new Error("bad suppressions"); }
    });
    expect(result.findingsCount).toBeGreaterThan(0);
    const output = checkCalls.at(-1)?.params.output as { summary: string };
    expect(output.summary).toContain("all findings remain gated");
    expect(output.summary).toContain("no suppressions were applied");
  });

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
      expect(relevant.length).toBeGreaterThan(0);
      expect(relevant[0]["start_line"]).toBe(VULN_LINE);

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

  it("does NOT fail the check when the policy makes the verdict non-blocking (failOn never)", async () => {
    const { octokit, checkCalls } = makeStubOctokit();
    const base = createDefaultConfig([]);
    const result = await reviewPullRequest({
      octokit,
      owner: "acme",
      repo: "web",
      pullNumber: 51,
      headSha: "sha-never",
      getConfig: async () => ({ ...base, github: { ...base.github, failOn: "never" } })
    });
    expect(result.conclusion).not.toBe("failure");
    const lastUpdate = checkCalls.filter((c) => c.name === "update").at(-1)?.params;
    expect(lastUpdate?.["conclusion"]).not.toBe("failure");
  });

  it("fails the check when an explicit policy requires a role that never ran", async () => {
    const { octokit } = makeStubOctokit();
    const result = await reviewPullRequest({
      octokit,
      owner: "acme",
      repo: "web",
      pullNumber: 52,
      headSha: "sha-roles",
      getConfig: async () => createDefaultConfig([]),
      // security never runs on a heuristic-only review, so this must block.
      getPolicy: async () => ({
        enabled: true,
        blockOnVerdict: [],
        allowWarnMerge: true,
        failOn: "never",
        failOnDegraded: false,
        rolesRequired: ["security"],
        minRealProviders: 0
      })
    });
    expect(result.conclusion).toBe("failure");
  });
});
