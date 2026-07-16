export const severities = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof severities)[number];

export const verdicts = ["pass", "warn", "fail"] as const;
export type Verdict = (typeof verdicts)[number];

export type CouncilMode = "review" | "plan";
export type ProviderType = "cli" | "api" | "mock";

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  command?: string;
  args?: string[];
  roles?: string[];
  enabled?: boolean;
  timeoutMs?: number;
  killGraceMs?: number;
  stdin?: boolean;
  inputMode?: "stdin" | "prompt-file" | "none";
  maxInputBytes?: number;
  maxOutputBytes?: number;
  allowDangerousArgs?: boolean;
  headlessAllowlist?: string[];
  inheritEnv?: boolean;
  envAllowlist?: string[];
  env?: Record<string, string>;
  installHint?: string;
  /** Base URL of an OpenAI-compatible HTTP endpoint (e.g. a `/v1` base). Used by `type: "api"` providers. */
  baseUrl?: string;
  /** Model identifier passed to the endpoint. Required for `type: "api"` providers. */
  model?: string;
  /** Name of the env var holding the bearer token. Optional — local runners need none. */
  apiKeyEnv?: string;
  /** Optional pricing hints used by review-budget estimates. Values are USD per 1M tokens. */
  cost?: {
    inputUsdPer1M?: number;
    outputUsdPer1M?: number;
  };
}

export interface GithubConfig {
  commentMode: "update" | "new" | "off";
  failOn: Severity | "never";
  runnerMode: "auto" | "cli" | "api";
  failOnDegraded?: boolean;
  inlineComments?: boolean;
  inlineCommentLimit?: number;
  gate?: { severity: Severity; minAgreement: number };
}

/**
 * Resolved VerdictGate policy — the single source of truth for whether a report
 * blocks merge. Built from a standalone `.quorate/policy.yml`, a `policy:` block
 * in `.quorate.yml`, or derived from {@link GithubConfig}. See policy.ts.
 */
export interface QuoratePolicy {
  enabled: boolean;
  blockOnVerdict: Verdict[];
  allowWarnMerge: boolean;
  failOn: Severity | "never";
  failOnDegraded: boolean;
  gate?: { severity: Severity; minAgreement: number };
  rolesRequired: string[];
  minRealProviders: number;
}

export interface QuorateBudgetConfig {
  /** Maximum number of changed files that may be reviewed in one run. */
  maxFiles?: number;
  /** Maximum number of added + removed diff lines that may be reviewed in one run. */
  maxChangedLines?: number;
  /** Maximum estimated input cost for priced providers. Requires provider cost hints. */
  maxCostUsd?: number;
  /** Drop generated/lockfile diff blocks before prompting providers. */
  skipGenerated?: boolean;
}

export interface SupplyChainRuleConfig {
  enabled?: boolean;
  severity?: Severity;
}

export interface SupplyChainGateConfig {
  /** Enables SupplyChainGate as an extra deterministic review lane. */
  enabled?: boolean;
  /** SupplyChainGate currently scans unified diffs only. */
  mode?: "diff";
  /** Ecosystems to inspect. Defaults to npm, GitHub Actions, and Docker. */
  ecosystems?: string[];
  /** Lockfile policy for manifest dependency changes. */
  lockfiles?: {
    requireFor?: string[];
    onMissing?: "off" | "warn" | "fail";
  };
  /** Per-rule enablement and severity overrides. */
  rules?: {
    dependencyWithoutLockfile?: SupplyChainRuleConfig;
    unpinnedActions?: SupplyChainRuleConfig;
    mutableBaseImage?: SupplyChainRuleConfig;
    npmPublishWithoutProvenance?: SupplyChainRuleConfig;
  };
  /** Trusted references that should not produce findings. */
  allowlist?: {
    actions?: string[];
    images?: string[];
    packages?: string[];
  };
}

export type WebacyRiskLevel = "low" | "medium" | "high";

export interface WebacyIntegrationConfig {
  /** Enables DD.xyz/Webacy-backed web3 due diligence. Defaults to false. */
  enabled: boolean;
  /** Environment variable that holds the Webacy API key. Defaults to WEBACY_API_KEY. */
  apiKeyEnv: string;
  /** Chains to query when an added indicator cannot be inferred more precisely. */
  chains: string[];
  /** Conditions that should become blocking findings. */
  failOn: {
    riskLevel?: WebacyRiskLevel;
    sanctioned?: boolean;
    maliciousUrl?: boolean;
  };
  /** Conditions that should become warning findings. */
  warnOn: {
    riskLevel?: WebacyRiskLevel;
  };
  /** Trusted indicators that should not be queried or reported. */
  allowlist: {
    addresses: string[];
    domains: string[];
    urls: string[];
  };
  /** Best-effort local cache for risk responses. */
  cache: {
    ttlHours: number;
  };
}

export interface QuorateIntegrationsConfig {
  webacy?: WebacyIntegrationConfig;
}

export interface ReviewBudgetProviderEstimate {
  providerId: string;
  role: string;
  inputTokens: number;
  inputCostUsd?: number;
}

export interface ReviewBudgetSummary {
  changedFiles: number;
  changedLines: number;
  addedLines: number;
  removedLines: number;
  skippedGeneratedFiles: string[];
  promptBytes: number;
  estimatedInputTokens: number;
  estimatedInputCostUsd?: number;
  providerEstimates: ReviewBudgetProviderEstimate[];
  exceeded: string[];
}

export interface CustomHeuristicRule {
  packId: string;
  title: string;
  severity: Severity;
  body: string;
  fileRe: RegExp | null;
  textRe: RegExp;
}

export interface QuorateConfig {
  councils: string[];
  providers: ProviderConfig[];
  github: GithubConfig;
  /** Optional review-budget guardrails. */
  budget?: QuorateBudgetConfig;
  /** Optional deterministic supply-chain review lane. */
  supplyChain?: SupplyChainGateConfig;
  /** Optional master agent that semantically merges duplicate findings. */
  merge?: { provider: string };
  /** Per-role reviewer guidance appended to that role's prompt (packs fill this). */
  roleGuidance?: Record<string, string>;
  /** Regex heuristics loaded from trusted custom packs. */
  customHeuristics?: CustomHeuristicRule[];
  /** Optional external evidence integrations. */
  integrations?: QuorateIntegrationsConfig;
}

export interface DetectedProvider {
  id: string;
  command: string;
  path?: string;
  available: boolean;
  installHint?: string;
  aliases?: string[];
}

export interface CouncilRequest {
  mode: CouncilMode;
  subject: string;
  diff?: string;
  /** Original unfiltered diff, used by deterministic lanes that need generated-file evidence such as lockfiles. */
  fullDiff?: string;
  repoPath?: string;
  /** Trusted base/worktree file inventory used by deterministic repository-aware checks. */
  repositoryFiles?: string[];
  pullRequest?: {
    number: number;
    title?: string;
    url?: string;
  };
  /** Per-role reviewer guidance (from config/pack), injected into prompts. */
  roleGuidance?: Record<string, string>;
  /** Read-only, untrusted pull-request context. Redacted and byte-capped before use. */
  context?: string;
  /** Budget summary computed before provider prompts are sent. */
  budget?: ReviewBudgetSummary;
  /** Regex heuristics loaded from trusted custom packs. */
  customHeuristics?: CustomHeuristicRule[];
}

export interface Finding {
  severity: Severity;
  title: string;
  body: string;
  file?: string;
  line?: number;
  providerId?: string;
  role?: string;
  suggestion?: string;
  /** Count of distinct providers that raised this (clustered) finding. */
  agreement?: number;
  /** Sorted, unique provider ids that raised this finding. */
  agreedBy?: string[];
  /** Confidence in the finding, 0..1, derived from agreement and severity. */
  confidence?: number;
  /**
   * Stable content-derived instance identity (severity + file + normalized
   * title), stamped by the council. Used for baseline matching, suppression,
   * and inline-comment markers. See `fingerprintFinding` in identity.ts.
   */
  fingerprint?: string;
  /**
   * Suppression state: `active` (default, ungated) or `suppressed` (matched a
   * committed suppression store — visible but never counted toward the verdict
   * or merge gate). See `applySuppressions` in suppression.ts.
   */
  status?: "active" | "suppressed";
}

export type ProviderRunStatus = "ok" | "error" | "skipped" | "interrupted";

export interface ProviderResult {
  providerId: string;
  role: string;
  providerType: ProviderType;
  status: ProviderRunStatus;
  summary: string;
  findings: Finding[];
  rawOutput?: string;
  error?: string;
  durationMs: number;
}

export interface CouncilReport {
  verdict: Verdict;
  summary: string;
  findings: Finding[];
  providerResults: ProviderResult[];
  metadata: {
    generatedAt: string;
    mode: CouncilMode;
    subject: string;
    providers: string[];
    requestedProviders: string[];
    ranProviders: string[];
    degraded: boolean;
    /** Set when a master agent successfully merged duplicate findings. */
    mergedBy?: string;
    /**
     * Stable content-derived identity of this run: same diff + providers +
     * councils always produce the same id. Foundation for review history,
     * flake comparison, and CI artifact correlation. See `computeReviewId`.
     */
    reviewId?: string;
    /**
     * Number of findings suppressed because they matched the committed
     * baseline. Set only when a baseline was applied. See `applyBaseline`.
     */
    baselinedFindings?: number;
    /**
     * Number of findings tagged `status: "suppressed"` by the committed
     * suppression store. Suppressed findings stay visible but never count
     * toward the verdict or merge gate. See `applySuppressions`.
     */
    suppressedFindings?: number;
    /** Optional review-budget summary for this run. */
    budget?: ReviewBudgetSummary;
  };
}

export type CouncilEvent =
  | {
      type: "council/started";
      councilRunId: string;
      mode: CouncilMode;
      subject: string;
      planned: Array<{ providerId: string; role: string; providerType: ProviderType }>;
      at: string;
    }
  | {
      type: "provider/started";
      councilRunId: string;
      providerId: string;
      role: string;
      providerType: ProviderType;
      at: string;
    }
  | {
      type: "provider/chunk";
      councilRunId: string;
      providerId: string;
      role: string;
      stream: "stdout" | "stderr";
      text: string;
    }
  | {
      type: "provider/done";
      councilRunId: string;
      providerId: string;
      role: string;
      result: ProviderResult;
    }
  | {
      type: "council/done";
      councilRunId: string;
      report: CouncilReport;
    }
  | {
      type: "verdict";
      councilRunId: string;
      report: CouncilReport;
    };

export interface RunCouncilOptions {
  onEvent?: (event: CouncilEvent) => void;
  signal?: AbortSignal;
}
