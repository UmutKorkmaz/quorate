import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExecutable } from "./providers.js";
import type { CouncilRequest, Finding, ProviderConfig, ProviderResult, Severity } from "./types.js";

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputTruncated: boolean;
  aborted: boolean;
}

function buildPrompt(provider: ProviderConfig, role: string, request: CouncilRequest): string {
  const header = [
    `You are the ${role} member of Quorate.`,
    `Mode: ${request.mode}`,
    `Subject: ${request.subject}`,
    "Return concise findings as Markdown bullets. Use this finding format when possible:",
    "- [severity] Title (path/to/file.ts:12): concrete evidence and recommendation",
    "Use severity values: critical, high, medium, low, info."
  ].join("\n");

  const diffSection = request.diff ? `\n\nDiff:\n${request.diff}` : "";
  return `${header}\n\nProvider: ${provider.id}${diffSection}`;
}

async function runCommand(
  command: string,
  args: string[],
  input: string | undefined,
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
    killGraceMs: number;
    maxOutputBytes: number;
    onChunk?: (stream: "stdout" | "stderr", text: string) => void;
    signal?: AbortSignal;
  }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputTruncated = false;
    let outputBytes = 0;
    let killTimer: NodeJS.Timeout | undefined;
    let aborted = false;
    let abortKillTimer: NodeJS.Timeout | undefined;

    const appendOutput = (target: "stdout" | "stderr", chunk: string) => {
      const bytes = Buffer.byteLength(chunk);
      outputBytes += bytes;
      if (outputBytes > options.maxOutputBytes) {
        outputTruncated = true;
        const remaining = Math.max(options.maxOutputBytes - (outputBytes - bytes), 0);
        const allowed = remaining > 0 ? chunk.slice(0, remaining) : "";
        if (target === "stdout") stdout += allowed;
        else stderr += allowed;
        if (allowed.length > 0) options.onChunk?.(target, allowed);
        killProcess("SIGTERM");
        return;
      }
      if (target === "stdout") stdout += chunk;
      else stderr += chunk;
      options.onChunk?.(target, chunk);
    };

    const killProcess = (signal: NodeJS.Signals) => {
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall back to direct child kill below.
        }
      }
      child.kill(signal);
    };

    const onAbort = () => {
      aborted = true;
      killProcess("SIGTERM");
      abortKillTimer = setTimeout(() => killProcess("SIGKILL"), options.killGraceMs);
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort);
      }
    }

    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (abortKillTimer) clearTimeout(abortKillTimer);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcess("SIGTERM");
      killTimer = setTimeout(() => killProcess("SIGKILL"), options.killGraceMs);
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      appendOutput("stdout", chunk);
    });
    child.stderr.on("data", (chunk) => {
      appendOutput("stderr", chunk);
    });

    child.on("error", (error) => {
      cleanup();
      resolve({
        stdout,
        stderr: `${stderr}${error.message}`,
        exitCode: null,
        signal: null,
        timedOut,
        outputTruncated,
        aborted
      });
    });

    child.on("close", (exitCode, signal) => {
      cleanup();
      resolve({ stdout, stderr, exitCode, signal, timedOut, outputTruncated, aborted });
    });

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Long-form dangerous flags (lowercased) plus bare unsafe tokens. This replaces
 * the old anchored-regex array: it is matched against the POST-substitution,
 * normalized arg tokens produced by `normalizeArgForPolicy`, so `--resume=foo`,
 * `--RESUME`, and `{subject}`-injected tokens are all caught. Bare short flags
 * `-c`/`-r` are intentionally absent (overloaded across providers; a single
 * provider may ban a short alias via its `headlessAllowlist`).
 */
export const DANGEROUS_LONG_FLAGS: string[] = [
  "--continue",
  "--resume",
  "--resume-session",
  "--fork-session",
  "--session",
  "--session-id",
  "--dangerously",
  "--allow-dangerously",
  "--yolo",
  "--experimental-yolo",
  "--afk",
  "bypasspermissions",
  "yolo"
];

/**
 * Normalizes a single POST-substitution arg into lowercased policy tokens.
 *
 * - Strips any `=value` suffix (so `--resume=foo` checks as `--resume`).
 * - Lowercases everything (so `--RESUME` and `--Session-Id` are caught).
 * - Long flags (`--x`) return a single token `["--x"]`.
 * - A single-dash token with at least one cluster char is treated as a short-flag bundle:
 *   it returns the leading `-X` prefix plus each character of the cluster
 *   (so `-rfoo` → `["-r","r","f","o","o"]`, catching `-r` aliases and glued values).
 * - `-`, `--`, and bare positional values return themselves lowercased.
 *
 * Pure and exported so the table-driven policy tests can exercise it directly.
 */
export function normalizeArgForPolicy(arg: string): string[] {
  const beforeValue = arg.split("=", 1)[0];
  const lowered = beforeValue.toLowerCase();

  if (lowered === "-" || lowered === "--") {
    return [lowered];
  }

  if (lowered.startsWith("--")) {
    return [lowered];
  }

  if (lowered.startsWith("-") && lowered.length > 1) {
    const cluster = lowered.slice(1);
    return [`-${cluster[0]}`, ...cluster.split("")];
  }

  return [lowered];
}

export function validateCliProvider(
  provider: ProviderConfig,
  args: string[],
  prompt: string
): string | undefined {
  if (args.length === 0) {
    return `CLI provider ${provider.id} has no headless args configured. Refusing to start an interactive provider command.`;
  }

  const allowlist = provider.headlessAllowlist;
  if (allowlist && allowlist.length > 0) {
    const allowedTokens = new Set(allowlist.flatMap((flag) => normalizeArgForPolicy(flag)));
    for (const arg of args) {
      const tokens = normalizeArgForPolicy(arg);
      const isFlag = tokens.some((token) => token.startsWith("-") && token !== "-" && token !== "--");
      if (!isFlag) continue; // positional values / substituted file paths are not flags
      const permitted = tokens.every((token) => !token.startsWith("-") || allowedTokens.has(token));
      if (!permitted) {
        return `CLI provider ${provider.id} uses argument ${arg} which is not in the headless allowlist.`;
      }
    }
  } else if (!provider.allowDangerousArgs) {
    const dangerous = args.find((arg) =>
      normalizeArgForPolicy(arg).some((token) => DANGEROUS_LONG_FLAGS.includes(token))
    );
    if (dangerous) {
      return `CLI provider ${provider.id} uses dangerous argument ${dangerous}. Set allowDangerousArgs only if you fully trust this profile.`;
    }
  }

  const maxInputBytes = provider.maxInputBytes ?? 250_000;
  if (Buffer.byteLength(prompt) > maxInputBytes) {
    return `CLI provider ${provider.id} prompt is too large (${Buffer.byteLength(prompt)} bytes > ${maxInputBytes}).`;
  }

  return undefined;
}

const defaultEnvAllowlist = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "TERM"
];

function providerEnvironment(provider: ProviderConfig): NodeJS.ProcessEnv {
  if (provider.inheritEnv) {
    return { ...process.env, ...(provider.env ?? {}) };
  }

  const env: NodeJS.ProcessEnv = {};
  for (const key of provider.envAllowlist ?? defaultEnvAllowlist) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }

  return { ...env, ...(provider.env ?? {}) };
}

export function parseFindingsFromText(output: string, providerId: string, role: string): Finding[] {
  const findings: Finding[] = [];
  // Title is greedy up to the first ":" (body separator) or "(" (file ref); a
  // non-greedy title collapses to a single character because the trailing
  // groups are all optional (the cause of the "F | ocus" mis-split).
  const pattern =
    /^\s*(?:[-*]\s*)?\[(critical|high|medium|low|info)\]\s*([^:(]+)(?:\s*\(([^():]+)(?::(\d+))?\))?\s*:?\s*(.*)$/i;

  for (const line of output.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (!match) continue;

    findings.push({
      severity: match[1].toLowerCase() as Severity,
      title: match[2].trim(),
      file: match[3],
      line: match[4] ? Number(match[4]) : undefined,
      body: match[5]?.trim() || "Provider reported this finding.",
      providerId,
      role
    });
  }

  return findings;
}

function firstMeaningfulLine(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "Provider returned output.";
}

export async function runCliProvider(
  provider: ProviderConfig,
  role: string,
  request: CouncilRequest,
  hooks?: {
    onChunk?: (stream: "stdout" | "stderr", text: string) => void;
    signal?: AbortSignal;
  }
): Promise<ProviderResult> {
  const startedAt = Date.now();
  const command = provider.command ?? provider.id;
  const executable = findExecutable(command);

  if (!executable) {
    return {
      providerId: provider.id,
      role,
      providerType: provider.type,
      status: "error",
      summary: `Command not found: ${command}`,
      findings: [],
      error: `Command not found on PATH: ${command}`,
      durationMs: Date.now() - startedAt
    };
  }

  const prompt = buildPrompt(provider, role, request);
  const timeoutMs = Math.min(provider.timeoutMs ?? 120_000, 300_000);
  const killGraceMs = provider.killGraceMs ?? 5_000;
  const inputMode = provider.inputMode ?? (provider.stdin === false ? "none" : "stdin");
  const tempDir = await mkdtemp(join(tmpdir(), "quorate-"));

  try {
    const promptFile = join(tempDir, "prompt.md");
    const diffFile = join(tempDir, "diff.patch");
    await writeFile(promptFile, prompt, "utf8");
    await writeFile(diffFile, request.diff ?? "", "utf8");

    const args = (provider.args ?? []).map((arg) =>
      arg
        .replaceAll("{promptFile}", promptFile)
        .replaceAll("{diffFile}", diffFile)
        .replaceAll("{role}", role)
        .replaceAll("{subject}", request.subject)
    );
    const validationError = validateCliProvider(provider, args, prompt);
    if (validationError) {
      return {
        providerId: provider.id,
        role,
        providerType: provider.type,
        status: "error",
        summary: validationError,
        findings: [],
        error: validationError,
        durationMs: Date.now() - startedAt
      };
    }

    const stdinInput =
      inputMode === "stdin" || inputMode === "prompt-file" ? prompt : undefined;

    const result = await runCommand(
      executable,
      args,
      stdinInput,
      {
        cwd: request.repoPath,
        env: providerEnvironment(provider),
        timeoutMs,
        killGraceMs,
        maxOutputBytes: provider.maxOutputBytes ?? 1_000_000,
        onChunk: hooks?.onChunk,
        signal: hooks?.signal
      }
    );

    if (result.aborted) {
      const combinedSoFar = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      return {
        providerId: provider.id,
        role,
        providerType: provider.type,
        status: "interrupted",
        summary: "Provider run interrupted.",
        findings: [],
        rawOutput: combinedSoFar || undefined,
        durationMs: Date.now() - startedAt
      };
    }

    const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const findings = parseFindingsFromText(combinedOutput, provider.id, role);

    if (result.timedOut || result.exitCode !== 0) {
      return {
        providerId: provider.id,
        role,
        providerType: provider.type,
        status: "error",
        summary: result.timedOut
          ? `Provider timed out after ${timeoutMs}ms.`
          : result.outputTruncated
            ? `Provider output exceeded ${provider.maxOutputBytes ?? 1_000_000} bytes.`
          : `Provider exited with code ${result.exitCode ?? "unknown"}.`,
        findings,
        rawOutput: combinedOutput,
        error: combinedOutput || result.signal || "Provider failed.",
        durationMs: Date.now() - startedAt
      };
    }

    return {
      providerId: provider.id,
      role,
      providerType: provider.type,
      status: "ok",
      summary: firstMeaningfulLine(combinedOutput),
      findings,
      rawOutput: combinedOutput,
      durationMs: Date.now() - startedAt
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
