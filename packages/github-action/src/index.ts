import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  analyzeReviewBudget,
  applyBaseline,
  applyCustomPackDefinitions,
  applySuppressions,
  buildPullRequestContext,
  createDefaultConfig,
  DEFAULT_BASELINE_PATH,
  DEFAULT_POLICY_PATH,
  DEFAULT_SUPPRESSION_PATH,
  detectPacks,
  formatBudgetSummary,
  isBaselineStale,
  listExpired,
  PACKS,
  PACK_IDS,
  parseBaseline,
  parseConfig,
  parseCustomPackYaml,
  parsePolicyYaml,
  parseSuppressionStore,
  renderReviewGraph,
  renderMarkdownReport,
  renderSarif,
  resolvePolicy,
  runCouncil,
  shouldFailForPolicy,
  summarizeDiff,
  type BaselineStore,
  type CouncilReport,
  type CustomPackDefinition,
  type QuorateConfig,
  type QuoratePolicy,
  type Severity,
  type SuppressionStore
} from "@quorate/core";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
// esbuild inlines this JSON at build time, so the Action's SARIF carries the
// same tool version the CLI records.
import pkg from "../package.json";

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
      body?: string;
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
  /** Non-fatal diagnostics (e.g. baseline staleness, fallback notices). */
  warning?: (message: string) => void;
  info?: (message: string) => void;
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

/** Changed file paths from a unified diff (the `+++ b/<path>` headers). */
export function changedFilesFromDiff(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) files.push(line.slice("+++ b/".length).trim());
  }
  return files;
}

/**
 * Layer one or more domain packs onto the resolved config: union the pack
 * councils into `config.councils` and merge their `roleGuidance` (existing
 * config guidance wins). Providers and github settings are untouched — packs
 * shape WHAT the council reviews for, not which providers run. `packInput` is a
 * comma-separated list of pack ids, or "auto" to detect from the changed files.
 */
export function applyPacks(config: QuorateConfig, packInput: string | undefined, changedFiles: string[]): QuorateConfig {
  const raw = (packInput ?? "").trim();
  if (!raw) return config;

  const ids =
    raw.toLowerCase() === "auto"
      ? detectPacks({ files: changedFiles })
      : raw.split(",").map((id) => id.trim()).filter(Boolean);

  const packs = ids.map((id) => {
    const pack = PACKS[id];
    if (!pack) throw new Error(`Unknown pack "${id}". Available: ${PACK_IDS.join(", ")}.`);
    return pack;
  });
  if (packs.length === 0) return config;

  const councils = [...config.councils];
  for (const council of packs.flatMap((p) => p.councils)) {
    if (!councils.includes(council)) councils.push(council);
  }
  const roleGuidance: Record<string, string> = {};
  for (const pack of packs) {
    for (const [role, text] of Object.entries(pack.roleGuidance)) {
      if (!(role in roleGuidance)) roleGuidance[role] = text;
    }
  }
  return {
    ...config,
    councils,
    roleGuidance: { ...roleGuidance, ...config.roleGuidance }
  };
}

export function applyOverrides(
  config: QuorateConfig,
  inputs: {
    providers?: string;
    failOn?: string;
    runnerMode?: string;
    inlineComments?: string;
    inlineCommentLimit?: string;
    /** GitHub's RUNNER_ENVIRONMENT ("github-hosted" | "self-hosted"); informs `auto`. */
    runnerEnvironment?: string;
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
  const configuredRunnerMode =
    (runnerMode as "auto" | "cli" | "api" | undefined) ?? config.github.runnerMode;
  // `auto` is runner-aware: GitHub-hosted runners have no authenticated local
  // agent CLIs, so cli providers can never succeed there — keep api + heuristic
  // only. An explicit runner-mode (`cli`/`api`) is always honored, so workflows
  // that preinstall and authenticate a CLI can opt in with runner-mode: cli.
  const effectiveRunnerMode =
    configuredRunnerMode === "auto" && inputs.runnerEnvironment === "github-hosted"
      ? "api"
      : configuredRunnerMode;

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

async function buildActionPullRequestContext(
  client: Octokit,
  input: {
    owner: string;
    repo: string;
    pullNumber: number;
    pullRequest: NonNullable<ActionContext["payload"]["pull_request"]>;
  }
): Promise<string> {
  let commits: Array<{ sha?: string; message?: string }> = [];
  const listCommits = (client.rest.pulls as { listCommits?: unknown }).listCommits;
  if (listCommits) {
    try {
      const paginate = client.paginate as unknown as <T>(endpoint: unknown, parameters: Record<string, unknown>) => Promise<T[]>;
      const rows = await paginate<{ sha?: string; commit?: { message?: string } }>(listCommits, {
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullNumber,
        per_page: 100
      });
      commits = rows.map((row) => ({ sha: row.sha, message: row.commit?.message }));
    } catch {
      commits = [];
    }
  }

  return buildPullRequestContext({
    number: input.pullNumber,
    title: input.pullRequest.title,
    body: input.pullRequest.body,
    url: input.pullRequest.html_url,
    commits
  });
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
 * Load the committed baseline from the pull request's BASE ref (trusted), never
 * the head — otherwise a PR could add its own new findings to the baseline and
 * weaken the gate that reviews it. Returns null when no baseline is committed.
 */
export async function loadBaseBaseline(
  client: Octokit,
  params: { owner: string; repo: string; ref: string; path: string }
): Promise<BaselineStore | null> {
  try {
    const res = await client.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      ref: params.ref
    });
    const data = res.data;
    if (!Array.isArray(data) && data.type === "file" && typeof (data as { content?: string }).content === "string") {
      const file = data as { content: string; encoding?: string };
      const decoded = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8").toString("utf8");
      return parseBaseline(decoded);
    }
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status !== 404) throw error;
  }
  return null;
}

/**
 * Load a committed suppression store from the BASE ref (trusted), never the PR
 * head — a PR must not be able to suppress its own new findings. Returns null
 * when no store is committed.
 */
export async function loadBaseSuppressionStore(
  client: Octokit,
  params: { owner: string; repo: string; ref: string; path: string }
): Promise<SuppressionStore | null> {
  try {
    const res = await client.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      ref: params.ref
    });
    const data = res.data;
    if (!Array.isArray(data) && data.type === "file" && typeof (data as { content?: string }).content === "string") {
      const file = data as { content: string; encoding?: string };
      const decoded = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8").toString("utf8");
      return parseSuppressionStore(decoded);
    }
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status !== 404) throw error;
  }
  return null;
}

/**
 * Load a standalone VerdictGate policy from the BASE ref (trusted), never the PR
 * head — a pull request must not be able to weaken the gate that reviews it.
 * Returns null when no policy is committed.
 */
export async function loadBasePolicy(
  client: Octokit,
  params: { owner: string; repo: string; ref: string; path: string }
): Promise<QuoratePolicy | null> {
  try {
    const res = await client.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      ref: params.ref
    });
    const data = res.data;
    if (!Array.isArray(data) && data.type === "file" && typeof (data as { content?: string }).content === "string") {
      const file = data as { content: string; encoding?: string };
      const decoded = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8").toString("utf8");
      return parsePolicyYaml(decoded);
    }
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status !== 404) throw error;
  }
  return null;
}

export async function loadBaseCustomPacks(
  client: Octokit,
  params: { owner: string; repo: string; ref: string; path?: string }
): Promise<CustomPackDefinition[]> {
  const root = params.path ?? ".quorate/packs";
  let entries: Array<{ type?: string; path?: string; name?: string }>;
  try {
    const res = await client.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      path: root,
      ref: params.ref
    });
    entries = Array.isArray(res.data) ? res.data as Array<{ type?: string; path?: string; name?: string }> : [];
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status === 404) return [];
    throw error;
  }

  const packPaths = entries.flatMap((entry) => {
    const path = entry.path ?? `${root}/${entry.name ?? ""}`;
    return entry.type === "file" && /\.ya?ml$/i.test(path) ? [path] : [];
  });

  const definitions = await Promise.all(packPaths.map(async (path) => {
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
      return parseCustomPackYaml(decoded, path);
    }
    return undefined;
  }));
  return definitions.filter((definition): definition is CustomPackDefinition => definition !== undefined);
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
  const loadedBaseConfig = await loadBaseConfig(client, { owner, repo, ref: baseRef, candidates });
  const customPackDefinitions = await loadBaseCustomPacks(client, { owner, repo, ref: baseRef });
  const baseConfig = applyOverrides(applyCustomPackDefinitions(loadedBaseConfig, customPackDefinitions), {
    providers: input("providers"),
    failOn: input("fail-on"),
    runnerMode: input("runner-mode"),
    inlineComments: input("inline-comments"),
    inlineCommentLimit: input("inline-comment-limit"),
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT
  });
  const diff = await buildPullRequestDiff(client, { owner, repo, pullNumber });
  // Layer domain pack(s) — explicit list or "auto" detected from the PR's files.
  const config = applyPacks(baseConfig, input("pack"), changedFilesFromDiff(diff));
  const prContext = parseBoolean(input("include-pr-context"), false)
    ? await buildActionPullRequestContext(client, { owner, repo, pullNumber, pullRequest })
    : undefined;
  const budget = analyzeReviewBudget({
    diff,
    config,
    request: {
      mode: "review",
      subject: `PR #${pullNumber}: ${pullRequest.title ?? "Untitled pull request"}`,
      repoPath: process.cwd(),
      pullRequest: {
        number: pullNumber,
        title: pullRequest.title,
        url: pullRequest.html_url
      },
      context: prContext
    }
  });
  if (!budget.ok || budget.diff.trim().length === 0) {
    const budgetReason =
      budget.diff.trim().length === 0
        ? "No reviewable changes remain after generated-file filtering."
        : "Quorate stopped before provider execution because the configured review budget was exceeded.";
    const body = [
      "<!-- quorate-report -->",
      "# Quorate Report",
      "",
      "Verdict: **FAIL**",
      "",
      budgetReason,
      "",
      "```",
      formatBudgetSummary(budget.summary),
      "```"
    ].join("\n");
    deps.setOutput("verdict", "fail");
    deps.setOutput("findings", "0");
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
    deps.setFailed(budget.diff.trim().length === 0 ? "No reviewable changes remain after filtering." : "Quorate review budget exceeded.");
    return;
  }
  const rawReport = await runCouncil(
    {
      mode: "review",
      subject: `PR #${pullNumber}: ${pullRequest.title ?? "Untitled pull request"}`,
      diff: budget.diff,
      repoPath: process.cwd(),
      context: prContext,
      budget: budget.summary,
      pullRequest: {
        number: pullNumber,
        title: pullRequest.title,
        url: pullRequest.html_url
      }
    },
    config
  );

  // Optional baseline: gate only on findings absent from the committed baseline,
  // read from the BASE ref so a PR cannot baseline away its own new findings. A
  // malformed/oversized base baseline must NOT brick the gate for every PR — on
  // any error we warn and fall back to gating on all findings (fail-secure).
  let report: CouncilReport = rawReport;
  if (parseBoolean(input("baseline"), false)) {
    const baselinePath = input("baseline-path") ?? DEFAULT_BASELINE_PATH;
    try {
      const baseline = await loadBaseBaseline(client, { owner, repo, ref: baseRef, path: baselinePath });
      if (!baseline) {
        deps.info?.(`No baseline at ${baselinePath} on the base ref — gating on all findings.`);
      } else {
        if (isBaselineStale(baseline)) {
          deps.warning?.(
            `Quorate baseline is past its ${baseline.expiresAfterDays}-day expiry (generated ${baseline.generatedAt}). Refresh with \`quorate baseline --update\`.`
          );
        }
        report = applyBaseline(rawReport, baseline);
        if (report.metadata.baselinedFindings) {
          deps.info?.(`Suppressed ${report.metadata.baselinedFindings} finding(s) matching the committed baseline.`);
        }
      }
    } catch (error: unknown) {
      deps.warning?.(
        `Could not apply the committed baseline (${error instanceof Error ? error.message : String(error)}) — gating on all findings.`
      );
      report = rawReport;
    }
  }

  // Committed suppression store (always-on when present): accept-risk entries
  // tag matching findings `suppressed` (visible but ungated). Read from the BASE
  // ref so a PR cannot suppress its own new findings; a malformed store warns
  // and falls back to gating on all findings (fail-secure).
  const suppressPath = input("suppress-path") ?? DEFAULT_SUPPRESSION_PATH;
  try {
    const store = await loadBaseSuppressionStore(client, { owner, repo, ref: baseRef, path: suppressPath });
    if (store) {
      const expired = listExpired(store);
      if (expired.length > 0) {
        deps.warning?.(`${expired.length} committed suppression(s) have expired and no longer apply.`);
      }
      report = applySuppressions(report, store);
      if (report.metadata.suppressedFindings) {
        deps.info?.(`Suppressed ${report.metadata.suppressedFindings} finding(s) via the committed store.`);
      }
    }
  } catch (error: unknown) {
    deps.warning?.(
      `Could not apply the suppression store (${error instanceof Error ? error.message : String(error)}) — gating on all findings.`
    );
  }

  const summary = summarizeDiff(budget.diff);
  const includeReviewGraph = parseBoolean(input("reviewgraph"), false);
  const body = renderMarkdownReport(report, { includeMarker: true, summary, includeReviewGraph });

  deps.setOutput("verdict", report.verdict);
  deps.setOutput("findings", String(report.findings.length));
  deps.summary.addRaw(body);
  await deps.summary.write();

  // Optional SARIF artifact for GitHub Code Scanning. A composite action cannot
  // call github/codeql-action/upload-sarif itself, so we write the file and
  // expose its path as an output for a downstream upload-sarif step to consume.
  const sarifFile = input("sarif-file");
  if (sarifFile) {
    try {
      const target = resolve(process.cwd(), sarifFile);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, renderSarif(report, { toolVersion: pkg.version }), "utf8");
      deps.setOutput("sarif-path", target);
      deps.info?.(`Wrote SARIF report to ${sarifFile} (set sarif-path output).`);
    } catch (error: unknown) {
      deps.warning?.(
        `Could not write SARIF to ${sarifFile} (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }

  const reviewGraphFile = input("reviewgraph-file");
  if (reviewGraphFile) {
    try {
      const target = resolve(process.cwd(), reviewGraphFile);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, renderReviewGraph(report), "utf8");
      deps.setOutput("reviewgraph-path", target);
      deps.info?.(`Wrote ReviewGraph report to ${reviewGraphFile} (set reviewgraph-path output).`);
    } catch (error: unknown) {
      deps.warning?.(
        `Could not write ReviewGraph to ${reviewGraphFile} (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }

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

  // Resolve the merge policy: a standalone .quorate/policy.yml from the BASE ref
  // wins, else the legacy github config. A MALFORMED committed policy is a broken
  // gate contract — fail CLOSED: the review still runs (the comment is useful) but
  // the check is failed, because the intended strictness (required roles, provider
  // floor, agreement gate) is unknown and must not silently relax to the weaker
  // github-config default. (Contrast with the baseline, where fail-open is strictly
  // safer because it gates on MORE findings.)
  const failOnOverride = input("fail-on") as Severity | "never" | undefined;
  let gatePolicy: QuoratePolicy;
  let policyLoadFailed = false;
  try {
    const policyPath = input("policy-path") ?? DEFAULT_POLICY_PATH;
    const basePolicy = await loadBasePolicy(client, { owner, repo, ref: baseRef, path: policyPath });
    gatePolicy = resolvePolicy(config, { policy: basePolicy ?? undefined, failOn: failOnOverride });
    if (basePolicy) deps.info?.(`Loaded VerdictGate policy from ${policyPath} (base ref).`);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    deps.warning?.(
      `Could not load the committed merge policy (${reason}). The check will fail — the policy's intended strictness is unknown and must not silently relax. Fix the policy file on the base branch.`
    );
    // Still derive a gate so the review/comment runs, but force the check to fail below.
    gatePolicy = resolvePolicy(config, { failOn: failOnOverride });
    policyLoadFailed = true;
  }

  if (!policyLoadFailed && !gatePolicy.enabled) {
    deps.warning?.(
      "VerdictGate merge blocking is disabled by policy (merge_gate.enabled: false) — no verdict can fail this check."
    );
  }
  if (policyLoadFailed) {
    deps.setFailed(
      "Quorate could not load the committed policy file — the merge gate's strictness is unknown. Fix the policy on the base branch."
    );
  } else if (shouldFailForPolicy(report, gatePolicy)) {
    deps.setFailed(`Quorate verdict ${report.verdict} is blocked by the merge policy (fail-on ${gatePolicy.failOn}).`);
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
    env: process.env,
    warning: (message) => core.warning(message),
    info: (message) => core.info(message)
  });
}

// Only auto-run the action entrypoint inside a real GitHub Actions runner.
// Importing these helpers elsewhere (the GitHub App, tests) must NOT execute it.
if (!process.env.VITEST && process.env.GITHUB_ACTIONS === "true") {
  run().catch((error: unknown) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
  });
}
