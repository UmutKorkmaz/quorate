import { spawn } from "node:child_process";
import * as vscode from "vscode";

/** Shapes shared with @quorate/core (kept as local type-only mirrors). */
export type Verdict = "pass" | "warn" | "fail";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Finding {
  severity: Severity;
  title: string;
  body: string;
  file?: string;
  line?: number;
  providerId?: string;
  role?: string;
  agreedBy?: string[];
  confidence?: number;
  suggestion?: string;
}

export interface ProviderResult {
  providerId: string;
  role: string;
  status: string;
  findings?: Finding[];
  durationMs?: number;
}

export interface CouncilReport {
  verdict: Verdict;
  summary: string;
  findings: Finding[];
  providerResults: ProviderResult[];
  metadata: { degraded: boolean };
}

/** A configured provider from `quorate providers --json`. */
export interface ProviderConfig {
  id: string;
  type: "mock" | "cli" | "api";
  enabled?: boolean;
  roles?: string[];
  model?: string;
  command?: string;
  apiKeyEnv?: string;
}

/** A detected agent + the configured roster from `quorate doctor --json`. */
export interface DoctorReport {
  detected: Array<{ id: string; command?: string; path?: string; available: boolean; installHint?: string }>;
  config: ProviderConfig[];
}

function cliPath(): string {
  return vscode.workspace.getConfiguration("quorate").get<string>("cliPath", "quorate");
}

function workspaceCwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run the quorate CLI, collecting stdout/stderr. Rejects only if it can't spawn. */
export function runCli(args: string[], token?: vscode.CancellationToken): Promise<SpawnResult> {
  const cwd = workspaceCwd();
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath(), args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    token?.onCancellationRequested(() => child.kill());
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** The installed CLI version, or null if quorate can't be run. */
export async function cliVersion(): Promise<string | null> {
  try {
    const { stdout } = await runCli(["--version"]);
    const match = stdout.match(/\d+\.\d+\.\d+/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

/** Run a `--json` command and parse the single JSON object/array it prints. */
export async function runJson<T>(args: string[]): Promise<T | undefined> {
  const { stdout } = await runCli([...args, "--json"]);
  // doctor/providers print one JSON document; review streams NDJSON (use runReview).
  try {
    return JSON.parse(stdout.trim()) as T;
  } catch {
    // Fall back to the last JSON-looking line.
    const last = stdout.split("\n").map((l) => l.trim()).filter(Boolean).pop();
    if (last) {
      try {
        return JSON.parse(last) as T;
      } catch {
        /* not json */
      }
    }
    return undefined;
  }
}

export interface ReviewOutcome {
  report?: CouncilReport;
  error?: string;
}

/** Run `quorate review … --json`, returning the final CouncilReport (NDJSON last line). */
export async function runReview(
  reviewArgs: string[],
  token: vscode.CancellationToken
): Promise<ReviewOutcome> {
  let result: SpawnResult;
  try {
    result = await runCli(["review", ...reviewArgs, "--json"], token);
  } catch (err) {
    return { error: `Could not run "${cliPath()}" — install it with \`npm i -g quorate\`. (${(err as Error).message})` };
  }
  const report = parseReport(result.stdout);
  if (report) return { report };
  const stderrTail = result.stderr.trim().split("\n").filter(Boolean).pop();
  return { error: stderrTail ?? "No report produced — check the diff source and that quorate is up to date." };
}

function parseReport(stdout: string): CouncilReport | undefined {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as unknown;
      if (isCouncilReport(parsed)) return parsed;
    } catch {
      /* not the report */
    }
  }
  return undefined;
}

function isCouncilReport(value: unknown): value is CouncilReport {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.verdict === "string" &&
    typeof c.summary === "string" &&
    Array.isArray(c.findings) &&
    Array.isArray(c.providerResults) &&
    typeof c.metadata === "object" &&
    c.metadata !== null
  );
}
