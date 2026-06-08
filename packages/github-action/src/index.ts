import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  createDefaultConfig,
  parseConfig,
  renderMarkdownReport,
  runCouncil,
  shouldFailForReport,
  summarizeDiff,
  type QuorateConfig,
  type Severity
} from "@quorate/core";

type Octokit = ReturnType<typeof github.getOctokit>;
import { buildPullRequestDiff } from "./diff.js";
import { upsertReportComment } from "./comment.js";
import { postInlineComments } from "./inline.js";

/**
 * Minimal shape of the action's GitHub event context. Kept narrow and explicit
 * so the orchestration logic can be exercised with plain stub objects in tests.
 */
export interface ActionContext {
  repo: { owner: string; repo: string };
  payload: {
    pull_request?: {
      number: number;
      title?: string;
      html_url?: string;
      base?: { sha?: string; ref?: string };
      head?: { sha?: string };
    };
    repository?: { default_branch?: string };
  };
}

/** Dependencies injected into {@link runAction}; real wiring lives in {@link run}. */
export interface ActionDeps {
  getInput: (name: string) => string | undefined;
  setOutput: (name: string, value: string) => void;
  setFailed: (message: string) => void;
  summary: { addRaw: (text: string) => unknown; write: () => Promise<unknown> };
  context: ActionContext;
  getOctokit: (token: string) => Octokit;
  env?: Record<string, string | undefined>;
}

/** Normalize an input value: trim and treat the empty string as "unset". */
export function normalizeInput(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim() === "" ? undefined : value;
}

/** Parse a string input into a boolean, honoring the usual truthy spellings. */
export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = normalizeInput(value);
  if (normalized === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized.toLowerCase());
}

/**
 * Resolve the trusted base ref: prefer the PR base sha, then base ref, then the
 * repository default branch, and only fall back to "main" as a last resort.
 */
export function resolveBaseRef(context: ActionContext): string {
  const base = context.payload.pull_request?.base;
  return base?.sha ?? base?.ref ?? context.payload.repository?.default_branch ?? "main";
}

export function applyOverrides(
  config: QuorateConfig,
  inputs: {
    providers?: string;
    failOn?: string;
    runnerMode?: string;
    inlineComments?: string;
    inlineCommentLimit?: string;
  }
): QuorateConfig {
  const providers = normalizeInput(inputs.providers);
  const failOn = normalizeInput(inputs.failOn);
  const runnerMode = normalizeInput(inputs.runnerMode);
  const inlineComments = normalizeInput(inputs.inlineComments);
  const inlineCommentLimit = normalizeInput(inputs.inlineCommentLimit);

  const selected = providers
    ? new Set(providers.split(",").map((provider) => provider.trim()).filter(Boolean))
    : undefined;

  const parsedLimit = inlineCommentLimit !== undefined ? Number(inlineCommentLimit) : undefined;

  // runner-mode restricts which provider *types* may run on this runner: `cli`
  // keeps only local CLI agents, `api` keeps only HTTP endpoints, `auto` keeps
  // everything. The mock heuristic is the always-on safety baseline and is never
  // filtered out, so a misconfigured mode can never produce an empty council.
  const effectiveRunnerMode =
    (runnerMode as "auto" | "cli" | "api" | undefined) ?? config.github.runnerMode;

  return {
    ...config,
    providers: config.providers.map((provider) => {
      const baseEnabled = selected ? selected.has(provider.id) : provider.enabled !== false;
      const allowedByRunnerMode =
        effectiveRunnerMode === "auto" ||
        provider.type === "mock" ||
        provider.type === effectiveRunnerMode;
      return { ...provider, enabled: baseEnabled && allowedByRunnerMode };
    }),
    github: {
      ...config.github,
      failOn: (failOn as Severity | "never" | undefined) ?? config.github.failOn,
      runnerMode: effectiveRunnerMode,
      inlineComments:
        inlineComments !== undefined
          ? ["1", "true", "yes", "on"].includes(inlineComments.toLowerCase())
          : config.github.inlineComments,
      inlineCommentLimit:
        parsedLimit !== undefined && Number.isFinite(parsedLimit)
          ? parsedLimit
          : config.github.inlineCommentLimit
    }
  };
}

/**
 * Load the Quorate config from the pull request's BASE branch (trusted), never
 * from the PR head. A pull request must not be able to supply the config that
 * governs its own review — otherwise a malicious PR could enable a provider with
 * an arbitrary command on the runner. Falls back to the safe built-in default.
 */
export async function loadBaseConfig(
  client: Octokit,
  params: { owner: string; repo: string; ref: string; candidates: string[] }
): Promise<QuorateConfig> {
  for (const path of params.candidates) {
    try {
      const res = await client.rest.repos.getContent({
        owner: params.owner,
        repo: params.repo,
        path,
        ref: params.ref
      });
      const data = res.data;
      if (!Array.isArray(data) && data.type === "file" && typeof (data as { content?: string }).content === "string") {
        const file = data as { content: string; encoding?: string };
        const decoded = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8").toString("utf8");
        return parseConfig(decoded);
      }
    } catch (error: unknown) {
      const status = (error as { status?: number }).status;
      if (status !== 404) throw error;
    }
  }
  return createDefaultConfig();
}

/**
 * Dependency-injected orchestration for the action. Behavior mirrors the real
 * entry point exactly; {@link run} simply wires up @actions/core and
 * @actions/github and delegates here so the logic stays unit-testable.
 */
export async function runAction(deps: ActionDeps): Promise<void> {
  const input = (name: string): string | undefined => normalizeInput(deps.getInput(name));

  const token = input("github-token") ?? deps.env?.GITHUB_TOKEN;
  if (!token) {
    throw new Error("Missing github-token input or GITHUB_TOKEN environment variable.");
  }

  const pullRequest = deps.context.payload.pull_request;
  if (!pullRequest) {
    throw new Error("Quorate GitHub Action currently runs on pull_request events only.");
  }

  const { owner, repo } = deps.context.repo;
  const pullNumber = pullRequest.number;
  const client = deps.getOctokit(token);
  const baseRef = resolveBaseRef(deps.context);
  const configPath = input("config-path");
  const candidates = configPath ? [configPath] : [".quorate.yml", ".quorate.yaml", "quorate.config.yml"];
  const config = applyOverrides(await loadBaseConfig(client, { owner, repo, ref: baseRef, candidates }), {
    providers: input("providers"),
    failOn: input("fail-on"),
    runnerMode: input("runner-mode"),
    inlineComments: input("inline-comments"),
    inlineCommentLimit: input("inline-comment-limit")
  });
  const diff = await buildPullRequestDiff(client, { owner, repo, pullNumber });
  const report = await runCouncil(
    {
      mode: "review",
      subject: `PR #${pullNumber}: ${pullRequest.title ?? "Untitled pull request"}`,
      diff,
      repoPath: process.cwd(),
      pullRequest: {
        number: pullNumber,
        title: pullRequest.title,
        url: pullRequest.html_url
      }
    },
    config
  );
  const summary = summarizeDiff(diff);
  const body = renderMarkdownReport(report, { includeMarker: true, summary });

  deps.setOutput("verdict", report.verdict);
  deps.setOutput("findings", String(report.findings.length));
  deps.summary.addRaw(body);
  await deps.summary.write();

  if (parseBoolean(input("post-comment"), true) && config.github.commentMode !== "off") {
    await upsertReportComment(client, {
      owner,
      repo,
      issueNumber: pullNumber,
      body,
      mode: config.github.commentMode
    });
  }

  if (config.github.inlineComments) {
    const commitId = pullRequest.head?.sha;
    if (commitId) {
      try {
        await postInlineComments(client, {
          owner,
          repo,
          pullNumber,
          commitId,
          findings: report.findings,
          limit: config.github.inlineCommentLimit ?? 10
        });
      } catch {
        // An inline-comment failure (e.g. permissions, transient API error)
        // must not fail the whole run; the summary comment and gating still run.
      }
    }
  }

  if (shouldFailForReport(report, config.github)) {
    deps.setFailed(`Quorate verdict ${report.verdict} meets fail threshold ${config.github.failOn}.`);
  }
}

export async function run(): Promise<void> {
  await runAction({
    getInput: (name) => core.getInput(name),
    setOutput: (name, value) => core.setOutput(name, value),
    setFailed: (message) => core.setFailed(message),
    summary: {
      addRaw: (text) => core.summary.addRaw(text),
      write: () => core.summary.write()
    },
    context: github.context as unknown as ActionContext,
    getOctokit: (token) => github.getOctokit(token),
    env: process.env
  });
}

if (!process.env.VITEST) {
  run().catch((error: unknown) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
  });
}
