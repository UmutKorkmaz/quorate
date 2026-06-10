import { describe, expect, it } from "vitest";
import { createDefaultConfig, reportCommentMarker } from "@quorate/core";
import {
  applyOverrides,
  normalizeInput,
  parseBoolean,
  resolveBaseRef,
  runAction,
  type ActionContext,
  type ActionDeps
} from "../src/index.js";

/** Build a deps object with sensible defaults that individual tests can override. */
function makeDeps(overrides: Partial<ActionDeps> = {}): {
  deps: ActionDeps;
  outputs: Record<string, string>;
  failed: string[];
  summaryRaw: string[];
  rest: ReturnType<typeof makeOctokit>["rest"];
} {
  const outputs: Record<string, string> = {};
  const failed: string[] = [];
  const summaryRaw: string[] = [];

  const inputs: Record<string, string> = {
    "github-token": "token-123",
    "post-comment": "true"
  };

  const octokit = makeOctokit();

  const context: ActionContext = {
    repo: { owner: "owner", repo: "repo" },
    payload: {
      pull_request: {
        number: 7,
        title: "A pull request",
        html_url: "https://example.test/pr/7",
        base: { sha: "base-sha-123", ref: "feature-base" },
        head: { sha: "head-sha-123" }
      },
      repository: { default_branch: "trunk" }
    }
  };

  const deps: ActionDeps = {
    getInput: (name) => inputs[name],
    setOutput: (name, value) => {
      outputs[name] = value;
    },
    setFailed: (message) => {
      failed.push(message);
    },
    summary: {
      addRaw: (text) => {
        summaryRaw.push(text);
        return undefined;
      },
      write: async () => undefined
    },
    context,
    getOctokit: () => octokit as never,
    env: {},
    ...overrides
  };

  return { deps, outputs, failed, summaryRaw, rest: octokit.rest };
}

/**
 * Stub Octokit covering the calls runAction makes: paginate (PR files +
 * comments), rest.repos.getContent (base config, 404 -> default), and the
 * issues create/update endpoints that record their invocations.
 */
function makeOctokit() {
  const rest = {
    repos: {
      // No base config in the repo -> 404 -> safe default config.
      getContent: async () => {
        const error = new Error("Not Found") as Error & { status: number };
        error.status = 404;
        throw error;
      }
    },
    pulls: {
      listFiles: { id: "listFiles" },
      listReviewComments: { id: "listReviewComments" },
      createReview: async () => {
        rest.calls.push("review");
      }
    },
    issues: {
      listComments: { id: "listComments" },
      createComment: async () => {
        rest.calls.push("create");
      },
      updateComment: async () => {
        rest.calls.push("update");
      }
    },
    calls: [] as string[]
  };

  const paginate = async <T>(endpoint: unknown): Promise<T[]> => {
    if (endpoint === rest.pulls.listFiles) {
      return [
        { filename: "src/app.ts", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new" }
      ] as unknown as T[];
    }
    if (endpoint === rest.issues.listComments) {
      return [{ id: 5, body: `${reportCommentMarker}\nprevious`, user: { type: "Bot" } }] as unknown as T[];
    }
    return [] as T[];
  };

  return { rest, paginate };
}

describe("normalizeInput / parseBoolean", () => {
  it("treats blank and whitespace-only input as unset", () => {
    expect(normalizeInput(undefined)).toBeUndefined();
    expect(normalizeInput("")).toBeUndefined();
    expect(normalizeInput("   ")).toBeUndefined();
    expect(normalizeInput(" keep ")).toBe(" keep ");
  });

  it("parses the usual truthy spellings and falls back otherwise", () => {
    for (const truthy of ["1", "true", "TRUE", "yes", "on"]) {
      expect(parseBoolean(truthy, false)).toBe(true);
    }
    for (const falsy of ["0", "false", "no", "off"]) {
      expect(parseBoolean(falsy, true)).toBe(false);
    }
    expect(parseBoolean(undefined, true)).toBe(true);
    expect(parseBoolean("", false)).toBe(false);
  });
});

describe("applyOverrides", () => {
  it("applies provider, fail-on and runner-mode overrides", () => {
    const base = createDefaultConfig();
    const overridden = applyOverrides(base, {
      providers: "heuristic",
      failOn: "low",
      runnerMode: "cli"
    });

    expect(overridden.github.failOn).toBe("low");
    expect(overridden.github.runnerMode).toBe("cli");
    // Only the explicitly selected provider stays enabled.
    expect(overridden.providers.find((p) => p.id === "heuristic")?.enabled).toBe(true);
    for (const provider of overridden.providers) {
      if (provider.id !== "heuristic") {
        expect(provider.enabled).toBe(false);
      }
    }
  });

  it("leaves config untouched when no overrides are provided", () => {
    const base = createDefaultConfig();
    const overridden = applyOverrides(base, {});
    expect(overridden.github.failOn).toBe(base.github.failOn);
    expect(overridden.github.runnerMode).toBe(base.github.runnerMode);
    expect(overridden.providers.map((p) => p.enabled)).toEqual(base.providers.map((p) => p.enabled));
  });

  it("runner-mode filters enabled providers by type, keeping the heuristic", () => {
    const base = {
      ...createDefaultConfig(),
      providers: [
        { id: "heuristic", type: "mock" as const, enabled: true },
        { id: "claude", type: "cli" as const, command: "claude", args: ["--print"], enabled: true },
        { id: "local-llama", type: "api" as const, model: "llama3.1", enabled: true }
      ]
    };

    const cliOnly = applyOverrides(base, { runnerMode: "cli" });
    expect(cliOnly.providers.find((p) => p.id === "heuristic")?.enabled).toBe(true);
    expect(cliOnly.providers.find((p) => p.id === "claude")?.enabled).toBe(true);
    expect(cliOnly.providers.find((p) => p.id === "local-llama")?.enabled).toBe(false);

    const apiOnly = applyOverrides(base, { runnerMode: "api" });
    expect(apiOnly.providers.find((p) => p.id === "heuristic")?.enabled).toBe(true);
    expect(apiOnly.providers.find((p) => p.id === "claude")?.enabled).toBe(false);
    expect(apiOnly.providers.find((p) => p.id === "local-llama")?.enabled).toBe(true);

    const auto = applyOverrides(base, { runnerMode: "auto" });
    expect(auto.providers.every((p) => p.enabled)).toBe(true);
  });

  it("auto is runner-aware: github-hosted runners keep api + heuristic only", () => {
    const base = {
      ...createDefaultConfig(),
      providers: [
        { id: "heuristic", type: "mock" as const, enabled: true },
        { id: "claude", type: "cli" as const, command: "claude", args: ["--print"], enabled: true },
        { id: "gateway", type: "api" as const, model: "gpt-4o", enabled: true }
      ]
    };

    const hosted = applyOverrides(base, { runnerMode: "auto", runnerEnvironment: "github-hosted" });
    expect(hosted.providers.find((p) => p.id === "heuristic")?.enabled).toBe(true);
    expect(hosted.providers.find((p) => p.id === "claude")?.enabled).toBe(false);
    expect(hosted.providers.find((p) => p.id === "gateway")?.enabled).toBe(true);

    // Self-hosted keeps everything under auto.
    const selfHosted = applyOverrides(base, { runnerMode: "auto", runnerEnvironment: "self-hosted" });
    expect(selfHosted.providers.every((p) => p.enabled)).toBe(true);

    // An explicit cli mode is honored even on a hosted runner (preinstalled CLIs).
    const explicit = applyOverrides(base, { runnerMode: "cli", runnerEnvironment: "github-hosted" });
    expect(explicit.providers.find((p) => p.id === "claude")?.enabled).toBe(true);
  });
});

describe("resolveBaseRef", () => {
  const ctx = (payload: ActionContext["payload"]): ActionContext => ({
    repo: { owner: "o", repo: "r" },
    payload
  });

  it("prefers the PR base sha", () => {
    expect(
      resolveBaseRef(ctx({ pull_request: { number: 1, base: { sha: "abc", ref: "r" } }, repository: { default_branch: "trunk" } }))
    ).toBe("abc");
  });

  it("falls back to base ref, then default branch", () => {
    expect(
      resolveBaseRef(ctx({ pull_request: { number: 1, base: { ref: "the-ref" } }, repository: { default_branch: "trunk" } }))
    ).toBe("the-ref");
    expect(
      resolveBaseRef(ctx({ pull_request: { number: 1, base: {} }, repository: { default_branch: "trunk" } }))
    ).toBe("trunk");
  });

  it("falls back to main as a last resort", () => {
    expect(resolveBaseRef(ctx({ pull_request: { number: 1 } }))).toBe("main");
  });
});

describe("runAction", () => {
  it("throws when the github token is missing", async () => {
    const { deps } = makeDeps({ getInput: () => undefined, env: {} });
    await expect(runAction(deps)).rejects.toThrow(/github-token/i);
  });

  it("throws on non-pull_request events", async () => {
    const { deps } = makeDeps();
    deps.context = { repo: { owner: "o", repo: "r" }, payload: {} };
    await expect(runAction(deps)).rejects.toThrow(/pull_request/i);
  });

  it("sets the verdict/findings outputs, writes the summary and upserts the comment", async () => {
    const { deps, outputs, summaryRaw, rest } = makeDeps();

    await runAction(deps);

    expect(outputs.verdict).toBeDefined();
    expect(outputs.findings).toBeDefined();
    expect(Number.isNaN(Number(outputs.findings))).toBe(false);
    expect(summaryRaw.length).toBe(1);
    expect(summaryRaw[0]).toContain(reportCommentMarker);
    // The diff summary section is rendered into the report body.
    expect(summaryRaw[0]).toContain("## Summary");
    expect(summaryRaw[0]).toContain("file changed");
    expect(summaryRaw[0]).toContain("src/app.ts");
    // Existing marker comment present -> update, not create.
    // inlineComments defaults off, so no review is posted.
    expect(rest.calls).toEqual(["update"]);
  });

  it("posts an inline review when inline-comments is enabled and findings are located", async () => {
    const { deps, rest } = makeDeps();
    // A diff line the heuristic reviewer flags, with a real file + line.
    deps.getOctokit = () =>
      ({
        rest,
        paginate: async <T>(endpoint: unknown): Promise<T[]> => {
          if (endpoint === rest.pulls.listFiles) {
            return [
              { filename: "src/app.ts", status: "modified", patch: "@@ -1 +1,2 @@\n unchanged\n+console.log('hi')" }
            ] as unknown as T[];
          }
          // No pre-existing issue comments or review comments.
          return [] as T[];
        }
      }) as never;
    deps.getInput = (name) =>
      name === "github-token"
        ? "tok"
        : name === "post-comment"
          ? "false"
          : name === "inline-comments"
            ? "true"
            : undefined;

    await runAction(deps);

    expect(rest.calls).toContain("review");
  });

  it("skips the comment when post-comment is false", async () => {
    const { deps, rest } = makeDeps();
    deps.getInput = (name) => (name === "github-token" ? "tok" : name === "post-comment" ? "false" : undefined);

    await runAction(deps);

    expect(rest.calls).toEqual([]);
  });

  it("reads the token from the environment when the input is unset", async () => {
    const { deps, outputs } = makeDeps({
      getInput: (name) => (name === "post-comment" ? "false" : undefined),
      env: { GITHUB_TOKEN: "env-token" }
    });

    await runAction(deps);
    expect(outputs.verdict).toBeDefined();
  });
});
