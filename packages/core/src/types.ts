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

export interface QuorateConfig {
  councils: string[];
  providers: ProviderConfig[];
  github: GithubConfig;
  /** Optional master agent that semantically merges duplicate findings. */
  merge?: { provider: string };
  /** Per-role reviewer guidance appended to that role's prompt (packs fill this). */
  roleGuidance?: Record<string, string>;
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
  repoPath?: string;
  pullRequest?: {
    number: number;
    title?: string;
    url?: string;
  };
  /** Per-role reviewer guidance (from config/pack), injected into prompts. */
  roleGuidance?: Record<string, string>;
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
