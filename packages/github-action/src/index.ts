import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  loadConfig,
  renderMarkdownReport,
  runCouncil,
  shouldFailForReport,
  type QuorateConfig,
  type Severity
} from "@quorate/core";
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
  const config = applyOverrides(loadConfig(input("config-path"), process.cwd()));
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

run().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
