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
}

export interface GithubConfig {
  commentMode: "update" | "new" | "off";
  failOn: Severity | "never";
  runnerMode: "auto" | "cli" | "api";
  failOnDegraded?: boolean;
}

export interface QuorateConfig {
  councils: string[];
  providers: ProviderConfig[];
  github: GithubConfig;
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
    };

export interface RunCouncilOptions {
  onEvent?: (event: CouncilEvent) => void;
  signal?: AbortSignal;
}
