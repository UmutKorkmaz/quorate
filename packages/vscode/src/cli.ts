import { spawn } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

export const MIN_CLI = "0.6.0";

/** Shapes shared with @quorate/core (local type-only mirrors). */
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

export interface ProviderConfig {
  id: string;
  type: "mock" | "cli" | "api";
  enabled?: boolean;
  roles?: string[];
  model?: string;
  command?: string;
  apiKeyEnv?: string;
}

export interface DoctorReport {
  detected: Array<{ id: string; command?: string; path?: string; available: boolean; installHint?: string }>;
  config: ProviderConfig[];
}

/** A streamed NDJSON progress event (provider/started, provider/done, …). */
export interface StreamEvent {
  type: string;
  providerId?: string;
  role?: string;
  result?: { status: string; findings: Finding[]; durationMs?: number };
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function workspaceCwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function probeVersion(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ["--version"], { shell: false });
    let out = "";
    child.on("error", () => resolve(null));
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", () => {
      const m = out.match(/\d+\.\d+\.\d+/);
      resolve(m ? m[0] : null);
    });
  });
}

let cachedCli: { path: string; version: string | null } | undefined;

/**
 * Resolve the quorate binary. Honors an explicit `quorate.cliPath`; otherwise
 * prefers a >= MIN_CLI binary, falling back to `~/.local/bin` / `~/.hermes` so a
 * stale binary first on a GUI editor's PATH doesn't win.
 */
export async function resolveCli(force = false): Promise<{ path: string; version: string | null }> {
  if (cachedCli && !force) return cachedCli;
  const configured = vscode.workspace.getConfiguration("quorate").get<string>("cliPath", "quorate");
  const home = os.homedir();
  const candidates = path.isAbsolute(configured)
    ? [configured]
    : [configured, path.join(home, ".local/bin/quorate"), path.join(home, ".hermes/node/bin/quorate")];

  let firstWorking: { path: string; version: string | null } | undefined;
  for (const candidate of candidates) {
    const version = await probeVersion(candidate);
    if (version === null) continue;
    firstWorking ??= { path: candidate, version };
    if (cmpVersion(version, MIN_CLI) >= 0) {
      cachedCli = { path: candidate, version };
      return cachedCli;
    }
  }
  cachedCli = firstWorking ?? { path: configured, version: null };
  return cachedCli;
}

export async function runCli(
  args: string[],
  opts: { token?: vscode.CancellationToken; env?: NodeJS.ProcessEnv } = {}
): Promise<SpawnResult> {
  const { path: cli } = await resolveCli();
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { cwd: workspaceCwd(), shell: false, env: opts.env });
    let stdout = "";
    let stderr = "";
    opts.token?.onCancellationRequested(() => child.kill());
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export async function runJson<T>(args: string[]): Promise<T | undefined> {
  try {
    const { stdout } = await runCli([...args, "--json"]);
    try {
      return JSON.parse(stdout.trim()) as T;
    } catch {
      const last = stdout.split("\n").map((l) => l.trim()).filter(Boolean).pop();
      return last ? (JSON.parse(last) as T) : undefined;
    }
  } catch {
    return undefined;
  }
}

export interface ReviewOutcome {
  report?: CouncilReport;
  error?: string;
  stale?: boolean;
}

/** Run `review … --json`, streaming progress events and resolving the final report. */
export async function runReviewStreaming(
  reviewArgs: string[],
  onEvent: (e: StreamEvent) => void,
  token: vscode.CancellationToken,
  env?: NodeJS.ProcessEnv
): Promise<ReviewOutcome> {
  const { path: cli } = await resolveCli();
  return new Promise((resolve) => {
    const child = spawn(cli, ["review", ...reviewArgs, "--json"], { cwd: workspaceCwd(), shell: false, env });
    let buffer = "";
    let stderr = "";
    let report: CouncilReport | undefined;

    token.onCancellationRequested(() => child.kill());
    child.on("error", (err) => resolve({ error: `Could not run "${cli}" — ${err.message}` }));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.stdout.on("data", (c: Buffer) => {
      buffer += c.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        report = consumeLine(line, onEvent) ?? report;
      }
    });
    child.on("close", () => {
      report = consumeLine(buffer.trim(), onEvent) ?? report;
      if (report) {
        resolve({ report });
        return;
      }
      const tail = stderr.trim().split("\n").filter(Boolean).pop() ?? "No report produced.";
      // A help-dump on stderr means a stale CLI rejected --json.
      const stale = /Options:|Usage:|--output|--write-json/.test(stderr) && !stderr.includes("No changes");
      resolve({ error: tail, stale });
    });
  });
}

function consumeLine(line: string, onEvent: (e: StreamEvent) => void): CouncilReport | undefined {
  if (!line) return undefined;
  try {
    const obj = JSON.parse(line) as unknown;
    if (isCouncilReport(obj)) return obj;
    if (typeof obj === "object" && obj !== null && typeof (obj as StreamEvent).type === "string") {
      onEvent(obj as StreamEvent);
    }
  } catch {
    /* non-JSON line */
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
