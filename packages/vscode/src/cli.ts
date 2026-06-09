import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
  error?: string;
  summary?: string;
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
  args?: string[];
}

/** Per-provider runnability for the Council view. */
export type RunState = "ready" | "not-installed" | "needs-args" | "needs-key";

export function providerRunState(
  p: ProviderConfig,
  detected: Map<string, { available: boolean }>
): RunState {
  if (p.type === "mock") return "ready";
  if (p.type === "api") return p.model ? "ready" : "needs-key";
  if (!detected.get(p.id)?.available) return "not-installed";
  if ((p.args?.length ?? 0) === 0) return "needs-args";
  return "ready";
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
  result?: { status: string; findings: Finding[]; durationMs?: number; error?: string };
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function workspaceCwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** The git repo root for `cwd` (diff paths are relative to it), or `cwd` itself. */
export function gitRoot(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("git", ["rev-parse", "--show-toplevel"], { cwd, shell: false });
    let out = "";
    child.on("error", () => resolve(cwd));
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (code) => resolve(code === 0 && out.trim() ? out.trim() : cwd));
  });
}

/**
 * Resolve a finding's (usually repo-root-relative) file path to one that exists.
 * Tries the given bases, then walks UP the directory tree from the workspace
 * folder — the git repo root is always an ancestor — so it works even when the
 * opened folder is a sub-directory of the repo and `git` isn't on the editor PATH.
 */
export function resolveFindingPath(file: string, bases: string[]): string {
  if (path.isAbsolute(file)) return file;
  const tried = new Set<string>();
  const candidateBases = [...bases];
  let dir = bases[bases.length - 1];
  for (let i = 0; i < 8 && dir; i++) {
    candidateBases.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const base of candidateBases) {
    if (!base || tried.has(base)) continue;
    tried.add(base);
    const candidate = path.join(base, file);
    if (existsSync(candidate)) return candidate;
  }
  return path.join(bases[0] ?? "", file);
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
