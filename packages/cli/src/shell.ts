import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  renderMarkdownReport,
  runCouncil,
  type QuorateConfig,
  type CouncilMode,
  type CouncilReport
} from "@quorate/core";
import { readDiff } from "./diff.js";
import {
  splitList,
  validateProviderSelection,
  withProviderSelection,
  withRoleSelection,
  resolveUseProviders,
  availableProviderIds,
  isRunnableProvider,
  providerRunPreflight,
  providerSnapshots,
  configuredActiveProviders,
  activeProviderSet,
  type ProviderSnapshot,
  type ShellState
} from "./session.js";

export { providerSnapshots, validateProviderSelection };
export type { ProviderSnapshot, ShellState };

export type ParsedShellCommand =
  | { kind: "empty" }
  | { kind: "exit" }
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "providers" }
  | { kind: "doctor" }
  | { kind: "use"; providers: string[] }
  | { kind: "enable"; providers: string[] }
  | { kind: "disable"; providers: string[] }
  | { kind: "roles"; roles: string[] }
  | { kind: "mode"; mode: CouncilMode }
  | { kind: "diff"; path: string }
  | { kind: "git"; base?: string; head?: string }
  | { kind: "pr"; number: string }
  | { kind: "review"; subject?: string }
  | { kind: "plan"; prompt: string }
  | { kind: "last" }
  | { kind: "rerun" }
  | { kind: "history" }
  | { kind: "json"; path: string }
  | { kind: "markdown"; path: string }
  | { kind: "clear" }
  | { kind: "unknown"; name: string };

export interface ShellIo {
  write(message: string): void;
}

export interface ShellCommandResult {
  exit: boolean;
}

export interface ShellStateSnapshot {
  cwd: string;
  mode: CouncilMode;
  diffLabel?: string;
  activeProviders?: string[];
  activeRoles?: string[];
  lastReport?: {
    verdict: CouncilReport["verdict"];
    findings: number;
    summary: string;
  };
  transcriptCount: number;
}

export function parseShellCommand(line: string, currentMode: CouncilMode = "review"): ParsedShellCommand {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "empty" };

  if (!trimmed.startsWith("/")) {
    if (currentMode === "review") return { kind: "review", subject: trimmed };
    return { kind: "plan", prompt: trimmed };
  }

  const [rawName = "", ...rest] = trimmed.slice(1).split(/\s+/);
  const name = rawName.toLowerCase();
  const value = rest.join(" ").trim();

  switch (name) {
    case "q":
    case "quit":
    case "exit":
      return { kind: "exit" };
    case "?":
    case "help":
      return { kind: "help" };
    case "status":
      return { kind: "status" };
    case "providers":
      return { kind: "providers" };
    case "doctor":
      return { kind: "doctor" };
    case "use":
      return { kind: "use", providers: splitList(value) };
    case "enable":
      return { kind: "enable", providers: splitList(value) };
    case "disable":
      return { kind: "disable", providers: splitList(value) };
    case "roles":
      return { kind: "roles", roles: splitList(value) };
    case "mode":
      if (value === "review" || value === "plan") return { kind: "mode", mode: value };
      return { kind: "unknown", name: rawName };
    case "diff":
      return value ? { kind: "diff", path: value } : { kind: "unknown", name: rawName };
    case "git": {
      const [base, head] = rest;
      return { kind: "git", base, head };
    }
    case "pr":
      return value ? { kind: "pr", number: value } : { kind: "unknown", name: rawName };
    case "review":
      return { kind: "review", subject: value || undefined };
    case "ask":
    case "plan":
      return value ? { kind: "plan", prompt: value } : { kind: "unknown", name: rawName };
    case "last":
      return { kind: "last" };
    case "rerun":
      return { kind: "rerun" };
    case "history":
      return { kind: "history" };
    case "json":
      return value ? { kind: "json", path: value } : { kind: "unknown", name: rawName };
    case "markdown":
    case "md":
      return value ? { kind: "markdown", path: value } : { kind: "unknown", name: rawName };
    case "clear":
    case "reset":
      return { kind: "clear" };
    default:
      return { kind: "unknown", name: rawName };
  }
}

function shellConfig(state: ShellState): QuorateConfig {
  return withRoleSelection(withProviderSelection(state.config, state.activeProviders), state.activeRoles);
}

function providerStatus(state: ShellState): string {
  const rows = providerSnapshots(state).map((provider) =>
    `${provider.active ? "*" : " "} ${provider.id.padEnd(10)} ${provider.available ? "available" : "missing"} ${provider.runnable ? "runnable" : "needs-profile"} ${provider.command ?? ""}`
  );

  return ["Providers (* active):", "  provider   local      profile       command", ...rows].join("\n");
}

function providerIds(state: ShellState): Set<string> {
  return new Set(state.config.providers.map((provider) => provider.id));
}

function roleIds(state: ShellState): Set<string> {
  return new Set(state.config.councils);
}

function unknownValues(values: string[], allowed: Set<string>): string[] {
  return values.filter((value) => !allowed.has(value));
}

export function shellHelp(): string {
  return [
    "Quorate shell commands:",
    "  /help                 Show this help",
    "  /providers            List providers and local availability",
    "  /doctor               Alias for /providers",
    "  /use ids              Enable providers for this session, comma-separated",
    "  /use default          Return to config provider defaults",
    "  /use available        Enable detected providers with runnable headless profiles",
    "  /enable ids           Add providers to the active session set",
    "  /disable ids          Remove providers from the active session set",
    "  /roles ids            Limit council roles, comma-separated",
    "  /mode review|plan     Set how bare text is interpreted",
    "  /diff path            Load a unified diff file",
    "  /git [base] [head]    Load git diff from the current repo",
    "  /pr number            Load a pull request diff with gh",
    "  /review [subject]     Review the loaded/current diff",
    "  /plan text            Ask the council to evaluate a plan",
    "  /last                 Show the last report",
    "  /rerun                Run the last request again",
    "  /history              Show recent shell commands",
    "  /json path            Save the last report as JSON",
    "  /markdown path        Save the last report as Markdown",
    "  /clear                Clear loaded diff and last report",
    "  /reset                Alias for /clear",
    "  /exit                 Leave the shell",
    "",
    "Bare text runs /review in review mode and /plan in plan mode."
  ].join("\n");
}

function statusText(state: ShellState): string {
  const providerText =
    state.activeProviders?.length === 0
      ? "heuristic fallback"
      : state.activeProviders?.join(", ") ?? "config defaults";

  return [
    `Mode: ${state.mode}`,
    `Cwd: ${state.cwd}`,
    `Diff: ${state.diffLabel ?? "not loaded"}`,
    `Providers: ${providerText}`,
    `Roles: ${state.activeRoles?.join(", ") ?? "config defaults"}`,
    `Last report: ${state.lastReport ? `${state.lastReport.verdict} (${state.lastReport.findings.length} findings)` : "none"}`
  ].join("\n");
}

function record(state: ShellState, inputLine: string, outputText: string): void {
  state.transcript.push({
    input: inputLine,
    output: outputText,
    timestamp: new Date().toISOString()
  });
}

export function createShellState(options: {
  cwd: string;
  config: QuorateConfig;
  providers?: string;
  mode?: CouncilMode;
}): ShellState {
  return {
    cwd: options.cwd,
    config: options.config,
    mode: options.mode ?? "review",
    activeProviders: options.providers ? splitList(options.providers) : undefined,
    transcript: []
  };
}

export function getShellStateSnapshot(state: ShellState): ShellStateSnapshot {
  return {
    cwd: state.cwd,
    mode: state.mode,
    diffLabel: state.diffLabel,
    activeProviders: state.activeProviders,
    activeRoles: state.activeRoles,
    lastReport: state.lastReport
      ? {
          verdict: state.lastReport.verdict,
          findings: state.lastReport.findings.length,
          summary: state.lastReport.summary
        }
      : undefined,
    transcriptCount: state.transcript.length
  };
}

export async function runShellCommand(
  state: ShellState,
  line: string
): Promise<{ exit: boolean; output: string; state: ShellStateSnapshot }> {
  let outputText = "";
  const result = await handleShellLine(state, line, {
    write: (message) => {
      outputText += message;
    }
  });

  return {
    exit: result.exit,
    output: outputText.trimEnd(),
    state: getShellStateSnapshot(state)
  };
}

export async function handleShellLine(
  state: ShellState,
  line: string,
  io: ShellIo = { write: (message) => output.write(message) }
): Promise<ShellCommandResult> {
  const command = parseShellCommand(line, state.mode);
  let out = "";

  const runWithPreflight = async (
    mode: CouncilMode,
    subject: string,
    diff?: string
  ): Promise<CouncilReport | undefined> => {
    const config = shellConfig(state);
    const errors = providerRunPreflight(config);
    if (errors.length > 0) {
      out = `Provider preflight failed:\n${errors.map((error) => `- ${error}`).join("\n")}`;
      return undefined;
    }

    return runCouncil(
      {
        mode,
        subject,
        diff,
        repoPath: state.cwd
      },
      config
    );
  };

  try {
    switch (command.kind) {
    case "empty":
      return { exit: false };
    case "exit":
      out = "Leaving Quorate shell.";
      io.write(`${out}\n`);
      record(state, line, out);
      return { exit: true };
    case "help":
      out = shellHelp();
      break;
    case "status":
      out = statusText(state);
      break;
    case "providers":
      out = providerStatus(state);
      break;
    case "doctor":
      out = providerStatus(state);
      break;
    case "use":
    {
      const nextProviders = resolveUseProviders(state, command.providers);
      const unknown = nextProviders ? unknownValues(nextProviders, providerIds(state)) : [];
      if (unknown.length > 0) {
        out = `Unknown provider id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`;
        break;
      }
      state.activeProviders = nextProviders;
      out = state.activeProviders
        ? `Active providers: ${state.activeProviders.join(", ")}`
        : "Using providers from config.";
      break;
    }
    case "enable": {
      const unknown = unknownValues(command.providers, providerIds(state));
      if (unknown.length > 0) {
        out = `Unknown provider id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`;
        break;
      }
      const next = activeProviderSet(state);
      for (const provider of command.providers) next.add(provider);
      state.activeProviders = [...next];
      out = `Active providers: ${state.activeProviders.join(", ")}`;
      break;
    }
    case "disable": {
      const unknown = unknownValues(command.providers, providerIds(state));
      if (unknown.length > 0) {
        out = `Unknown provider id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`;
        break;
      }
      const next = activeProviderSet(state);
      for (const provider of command.providers) next.delete(provider);
      state.activeProviders = next.size > 0 ? [...next] : [];
      out =
        state.activeProviders.length > 0
          ? `Active providers: ${state.activeProviders.join(", ")}`
          : "No providers active; runCouncil will use its heuristic fallback.";
      break;
    }
    case "roles":
    {
      const unknown = unknownValues(command.roles, roleIds(state));
      if (unknown.length > 0) {
        out = `Unknown role${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`;
        break;
      }
      state.activeRoles = command.roles.length > 0 ? command.roles : undefined;
      out = state.activeRoles ? `Active roles: ${state.activeRoles.join(", ")}` : "Using roles from config.";
      break;
    }
    case "mode":
      state.mode = command.mode;
      out = `Mode set to ${state.mode}.`;
      break;
    case "diff":
      state.diff = readDiff({ diff: command.path }, state.cwd);
      state.diffLabel = command.path;
      out = `Loaded diff from ${command.path}.`;
      break;
    case "git":
      state.diff = readDiff({ base: command.base, head: command.head }, state.cwd);
      state.diffLabel = command.base && command.head ? `${command.base}...${command.head}` : command.base ?? "git working tree";
      out = `Loaded diff from ${state.diffLabel}.`;
      break;
    case "pr":
      state.diff = readDiff({ pr: command.number }, state.cwd);
      state.diffLabel = `PR #${command.number}`;
      out = `Loaded diff from PR #${command.number}.`;
      break;
    case "review": {
      const diff = state.diff ?? readDiff({}, state.cwd);
      const subject = command.subject ?? "Interactive code review";
      state.lastRequest = {
        mode: "review",
        subject,
        diff
      };
      state.lastReport = await runWithPreflight("review", subject, diff);
      if (!state.lastReport) break;
      out = renderMarkdownReport(state.lastReport);
      break;
    }
    case "plan":
      state.lastRequest = {
        mode: "plan",
        subject: command.prompt
      };
      state.lastReport = await runWithPreflight("plan", command.prompt);
      if (!state.lastReport) break;
      out = renderMarkdownReport(state.lastReport);
      break;
    case "last":
      out = state.lastReport ? renderMarkdownReport(state.lastReport) : "No report yet.";
      break;
    case "rerun":
      if (!state.lastRequest) {
        out = "No request to rerun yet.";
        break;
      }
      state.lastReport = await runWithPreflight(
        state.lastRequest.mode,
        state.lastRequest.subject,
        state.lastRequest.diff
      );
      if (!state.lastReport) break;
      out = renderMarkdownReport(state.lastReport);
      break;
    case "history": {
      const recent = state.transcript.slice(-10);
      out =
        recent.length > 0
          ? recent.map((entry, index) => `${index + 1}. ${entry.timestamp} ${entry.input}`).join("\n")
          : "No shell history yet.";
      break;
    }
    case "json":
      if (!state.lastReport) {
        out = "No report to save yet.";
        break;
      }
      writeFileSync(resolve(state.cwd, command.path), `${JSON.stringify(state.lastReport, null, 2)}\n`, "utf8");
      out = `Saved report JSON to ${command.path}.`;
      break;
    case "markdown":
      if (!state.lastReport) {
        out = "No report to save yet.";
        break;
      }
      writeFileSync(resolve(state.cwd, command.path), renderMarkdownReport(state.lastReport), "utf8");
      out = `Saved report Markdown to ${command.path}.`;
      break;
    case "clear":
      state.diff = undefined;
      state.diffLabel = undefined;
      state.lastReport = undefined;
      state.lastRequest = undefined;
      out = "Cleared loaded diff and last report.";
      break;
    case "unknown":
      out = `Unknown command: /${command.name}. Use /help.`;
      break;
    }
  } catch (error) {
    out = `Error: ${error instanceof Error ? error.message : String(error)}`;
  }

  io.write(`${out}\n`);
  record(state, line, out);
  return { exit: false };
}

export async function startShell(options: {
  cwd: string;
  config: QuorateConfig;
  providers?: string;
  mode?: CouncilMode;
}): Promise<void> {
  const unknownProviders = validateProviderSelection(options.config, options.providers);
  if (unknownProviders.length > 0) {
    throw new Error(`Unknown provider id${unknownProviders.length === 1 ? "" : "s"}: ${unknownProviders.join(", ")}`);
  }

  const state = createShellState(options);
  output.write("Quorate shell. Use /help for commands, /exit to leave.\n");
  output.write("Real CLI providers run only after you enable them with /use or config.\n");

  const rl = createInterface({ input, output });

  try {
    for await (const line of rl) {
      output.write(promptFor(state));
      const result = await handleShellLine(state, line);
      if (result.exit) break;
    }
  } finally {
    rl.close();
  }
}

function promptFor(state: ShellState): string {
  const activeProviders = state.activeProviders?.join(",") ?? "config";
  const diffState = state.diffLabel ? "diff" : "none";
  return `council:${state.mode}:${activeProviders}:diff-${diffState}> `;
}
