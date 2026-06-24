import { buildReviewPrompt } from "./prompt.js";
import type {
  CouncilRequest,
  ProviderConfig,
  QuorateBudgetConfig,
  QuorateConfig,
  ReviewBudgetSummary
} from "./types.js";

interface DiffBlock {
  path: string;
  lines: string[];
}

const GENERATED_PATH_RE =
  /(^|\/)(dist|build|coverage|generated|vendor)\//i;
const GENERATED_FILE_RE =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock|poetry\.lock)$|\.min\.(?:js|css)$|(?:^|\/).*\.generated\.[^.]+$/i;

function isGeneratedPath(path: string): boolean {
  return GENERATED_PATH_RE.test(path) || GENERATED_FILE_RE.test(path);
}

function pathFromDiffGit(line: string): string | undefined {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  return match?.[2];
}

function splitDiffBlocks(diff: string): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let current: DiffBlock | undefined;
  let pendingPath: string | undefined;

  const open = (path: string, firstLine: string): void => {
    current = { path, lines: [firstLine] };
    blocks.push(current);
  };

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      pendingPath = pathFromDiffGit(line);
      open(pendingPath ?? "", line);
      continue;
    }
    if (line.startsWith("+++ b/")) {
      const path = line.slice("+++ b/".length).trim();
      if (current) current.path = path;
      else open(path, line);
      pendingPath = undefined;
    } else if (!current && pendingPath) {
      open(pendingPath, line);
      pendingPath = undefined;
    } else if (current) {
      current.lines.push(line);
    } else {
      open("", line);
    }
  }

  return blocks.filter((block) => block.lines.some((line) => line.trim().length > 0));
}

function diffLineCounts(diff: string): { files: Set<string>; added: number; removed: number } {
  const files = new Set<string>();
  let pendingPath: string | undefined;

  let added = 0;
  let removed = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      pendingPath = pathFromDiffGit(line);
    } else if (line.startsWith("+++ b/")) {
      const path = line.slice("+++ b/".length).trim();
      if (path && path !== "/dev/null") files.add(path);
      pendingPath = undefined;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
      if (pendingPath) files.add(pendingPath);
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
      if (pendingPath) files.add(pendingPath);
    }
  }

  return { files, added, removed };
}

function enabledProviderLanes(config: QuorateConfig): Array<{ provider: ProviderConfig; role: string }> {
  const enabled = config.providers.filter((provider) => provider.enabled !== false);
  const providers = enabled.length > 0 ? enabled : config.providers.filter((provider) => provider.id === "heuristic");
  const lanes: Array<{ provider: ProviderConfig; role: string }> = [];
  for (const provider of providers) {
    const roles = provider.roles && provider.roles.length > 0 ? provider.roles : [config.councils[0] ?? "maintainer"];
    for (const role of roles) lanes.push({ provider, role });
  }
  return lanes;
}

function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

export interface ReviewBudgetAnalysis {
  diff: string;
  summary: ReviewBudgetSummary;
  ok: boolean;
}

export function analyzeReviewBudget(input: {
  diff: string;
  config: QuorateConfig;
  request: Omit<CouncilRequest, "diff" | "budget">;
}): ReviewBudgetAnalysis {
  const budget: QuorateBudgetConfig = input.config.budget ?? {};
  const blocks = splitDiffBlocks(input.diff);
  const skippedGeneratedFiles = budget.skipGenerated
    ? blocks.filter((block) => block.path && isGeneratedPath(block.path)).map((block) => block.path)
    : [];
  const skipped = new Set(skippedGeneratedFiles);
  const reviewedDiff =
    budget.skipGenerated && skipped.size > 0
      ? blocks.filter((block) => !skipped.has(block.path)).map((block) => block.lines.join("\n")).join("\n")
      : input.diff;

  const counts = diffLineCounts(reviewedDiff);
  const providerEstimates = enabledProviderLanes(input.config).map(({ provider, role }) => {
    const prompt = buildReviewPrompt(provider, role, { ...input.request, diff: reviewedDiff });
    const promptBytes = Buffer.byteLength(prompt, "utf8");
    const inputTokens = estimateTokens(promptBytes);
    const price = provider.cost?.inputUsdPer1M;
    return {
      providerId: provider.id,
      role,
      inputTokens,
      ...(price !== undefined ? { inputCostUsd: (inputTokens / 1_000_000) * price } : {})
    };
  });

  const promptBytes = providerEstimates.reduce((sum, row) => sum + row.inputTokens * 4, 0);
  const estimatedInputTokens = providerEstimates.reduce((sum, row) => sum + row.inputTokens, 0);
  const priced = providerEstimates.filter((row) => row.inputCostUsd !== undefined);
  const estimatedInputCostUsd =
    priced.length > 0
      ? priced.reduce((sum, row) => sum + (row.inputCostUsd ?? 0), 0)
      : undefined;

  const changedFiles = counts.files.size;
  const changedLines = counts.added + counts.removed;
  const exceeded: string[] = [];
  if (budget.maxFiles !== undefined && changedFiles > budget.maxFiles) {
    exceeded.push(`changed files ${changedFiles} > budget.maxFiles ${budget.maxFiles}`);
  }
  if (budget.maxChangedLines !== undefined && changedLines > budget.maxChangedLines) {
    exceeded.push(`changed lines ${changedLines} > budget.maxChangedLines ${budget.maxChangedLines}`);
  }
  if (
    budget.maxCostUsd !== undefined &&
    estimatedInputCostUsd !== undefined &&
    estimatedInputCostUsd > budget.maxCostUsd
  ) {
    exceeded.push(
      `estimated input cost $${estimatedInputCostUsd.toFixed(4)} > budget.maxCostUsd $${budget.maxCostUsd.toFixed(4)}`
    );
  }

  const summary: ReviewBudgetSummary = {
    changedFiles,
    changedLines,
    addedLines: counts.added,
    removedLines: counts.removed,
    skippedGeneratedFiles,
    promptBytes,
    estimatedInputTokens,
    ...(estimatedInputCostUsd !== undefined ? { estimatedInputCostUsd } : {}),
    providerEstimates,
    exceeded
  };

  return { diff: reviewedDiff, summary, ok: exceeded.length === 0 };
}

export function formatBudgetSummary(summary: ReviewBudgetSummary): string {
  const lines = [
    `Budget: ${summary.changedFiles} file(s), ${summary.changedLines} changed line(s), ${summary.estimatedInputTokens} estimated input token(s).`
  ];
  if (summary.estimatedInputCostUsd !== undefined) {
    lines.push(`Estimated priced input cost: $${summary.estimatedInputCostUsd.toFixed(4)}.`);
  }
  if (summary.skippedGeneratedFiles.length > 0) {
    lines.push(`Skipped generated files: ${summary.skippedGeneratedFiles.join(", ")}.`);
  }
  if (summary.exceeded.length > 0) {
    lines.push("Budget exceeded:");
    for (const item of summary.exceeded) lines.push(`  - ${item}`);
  }
  return lines.join("\n");
}
