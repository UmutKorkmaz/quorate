import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  createDefaultConfig,
  parseConfig,
  renderMarkdownReport,
  runCouncil,
  shouldFailForReport,
  type QuorateConfig,
  type Severity
} from "@quorate/core";

type Octokit = ReturnType<typeof github.getOctokit>;
import { buildPullRequestDiff } from "./diff.js";
import { upsertReportComment } from "./comment.js";

function input(name: string): string | undefined {
  const value = core.getInput(name);
  return value.trim() === "" ? undefined : value;
}

function inputBoolean(name: string, fallback: boolean): boolean {
  const value = input(name);
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function applyOverrides(config: QuorateConfig): QuorateConfig {
  const providers = input("providers");
  const failOn = input("fail-on");
  const runnerMode = input("runner-mode");

  const selected = providers
    ? new Set(providers.split(",").map((provider) => provider.trim()).filter(Boolean))
    : undefined;

  return {
    ...config,
    providers: selected
      ? config.providers.map((provider) => ({
          ...provider,
          enabled: selected.has(provider.id)
        }))
      : config.providers,
    github: {
      ...config.github,
      failOn: (failOn as Severity | "never" | undefined) ?? config.github.failOn,
      runnerMode: (runnerMode as "auto" | "cli" | "api" | undefined) ?? config.github.runnerMode
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

export async function run(): Promise<void> {
  const token = input("github-token") ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("Missing github-token input or GITHUB_TOKEN environment variable.");
  }

  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest) {
    throw new Error("Quorate GitHub Action currently runs on pull_request events only.");
  }

  const { owner, repo } = github.context.repo;
  const pullNumber = pullRequest.number;
  const client = github.getOctokit(token);
  const base = pullRequest.base as { sha?: string; ref?: string } | undefined;
  const baseRef = base?.sha ?? base?.ref ?? github.context.payload.repository?.default_branch ?? "main";
  const configPath = input("config-path");
  const candidates = configPath ? [configPath] : [".quorate.yml", ".quorate.yaml", "quorate.config.yml"];
  const config = applyOverrides(await loadBaseConfig(client, { owner, repo, ref: baseRef, candidates }));
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
  const body = renderMarkdownReport(report, { includeMarker: true });

  core.setOutput("verdict", report.verdict);
  core.setOutput("findings", String(report.findings.length));
  core.summary.addRaw(body);
  await core.summary.write();

  if (inputBoolean("post-comment", true) && config.github.commentMode !== "off") {
    await upsertReportComment(client, {
      owner,
      repo,
      issueNumber: pullNumber,
      body,
      mode: config.github.commentMode
    });
  }

  if (shouldFailForReport(report, config.github)) {
    core.setFailed(`Quorate verdict ${report.verdict} meets fail threshold ${config.github.failOn}.`);
  }
}

if (!process.env.VITEST) {
  run().catch((error: unknown) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
  });
}
