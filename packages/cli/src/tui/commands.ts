import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isEmptyReviewDiff,
  renderMarkdownReport,
  type CouncilMode,
  type CouncilReport,
  type CouncilRequest
} from "@quorate/core";
import { readDiff } from "../diff.js";
import {
  splitList,
  resolveUseProviders,
  availableProviderIds,
  configuredActiveProviders,
  activeProviderSet,
  providerSnapshots as providerSnapshotsImpl,
  type ShellState
} from "../session.js";
import type { ShellContext } from "./context.js";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  summary: string;
  argHint?: string;
  run(ctx: ShellContext, args: string): Promise<void> | void;
}

function asShellState(ctx: ShellContext): ShellState {
  const state = ctx.getState();
  return {
    cwd: state.cwd,
    config: state.config,
    mode: state.mode,
    diff: state.diff,
    diffLabel: state.diffLabel,
    activeProviders: state.activeProviders,
    activeRoles: state.activeRoles,
    transcript: []
  };
}

function providerIdSet(ctx: ShellContext): Set<string> {
  return new Set(ctx.getState().config.providers.map((provider) => provider.id));
}

function roleIdSet(ctx: ShellContext): Set<string> {
  return new Set(ctx.getState().config.councils);
}

function unknownValues(values: string[], allowed: Set<string>): string[] {
  return values.filter((value) => !allowed.has(value));
}

async function runReviewWithReport(
  ctx: ShellContext,
  mode: CouncilMode,
  subject: string,
  diff?: string
): Promise<void> {
  const state = ctx.getState();
  if (isEmptyReviewDiff(mode, diff)) {
    text(ctx, "No changes to review. Load a diff first with /git, /diff <file>, or /pr <number>.");
    return;
  }
  const request: CouncilRequest = { mode, subject, diff, repoPath: state.cwd };
  ctx.dispatch({ type: "setLastRequest", request });
  const report = await ctx.runReview(request);
  ctx.dispatch({ type: "setLastReport", report });
  ctx.emit({ id: cellId(), kind: "findings", report });
}

let cellCounter = 0;
function cellId(): string {
  cellCounter += 1;
  return `cell-${cellCounter}`;
}

function text(ctx: ShellContext, message: string): void {
  ctx.emit({ id: cellId(), kind: "text", text: message });
}

function helpText(): string {
  return [
    "Quorate shell commands:",
    "  /help                 Show this help",
    "  /providers            List providers and local availability",
    "  /doctor               Alias for /providers",
    "  /status               Show current session state",
    "  /use ids              Enable providers (default, available, heuristic, or ids)",
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
    "  /exit                 Leave the shell",
    "",
    "Bare text runs /review in review mode and /plan in plan mode."
  ].join("\n");
}

function statusText(ctx: ShellContext): string {
  const state = ctx.getState();
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

export const commandRegistry: SlashCommand[] = [
  {
    name: "providers",
    aliases: ["doctor"],
    summary: "List providers and local availability",
    run(ctx) {
      ctx.emit({ id: cellId(), kind: "providerStatus", rows: providerSnapshotsFor(ctx) });
    }
  },
  {
    name: "doctor",
    summary: "Alias for /providers",
    run(ctx) {
      ctx.emit({ id: cellId(), kind: "providerStatus", rows: providerSnapshotsFor(ctx) });
    }
  },
  {
    name: "status",
    summary: "Show current session state",
    run(ctx) {
      text(ctx, statusText(ctx));
    }
  },
  {
    name: "use",
    summary: "Use providers: default, available, heuristic, or ids",
    argHint: "<ids|default|available|heuristic>",
    run(ctx, args) {
      const requested = splitList(args);
      const next = resolveUseProviders(asShellState(ctx), requested);
      const unknown = next ? unknownValues(next, providerIdSet(ctx)) : [];
      if (unknown.length > 0) {
        text(ctx, `Unknown provider id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
        return;
      }
      ctx.dispatch({ type: "setProviders", providers: next });
      text(ctx, next ? `Active providers: ${next.join(", ")}` : "Using providers from config.");
    }
  },
  {
    name: "enable",
    summary: "Add providers to this session",
    argHint: "<ids>",
    run(ctx, args) {
      const providers = splitList(args);
      const unknown = unknownValues(providers, providerIdSet(ctx));
      if (unknown.length > 0) {
        text(ctx, `Unknown provider id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
        return;
      }
      const next = activeProviderSet(asShellState(ctx));
      for (const provider of providers) next.add(provider);
      const list = [...next];
      ctx.dispatch({ type: "setProviders", providers: list });
      text(ctx, `Active providers: ${list.join(", ")}`);
    }
  },
  {
    name: "disable",
    summary: "Remove providers from this session",
    argHint: "<ids>",
    run(ctx, args) {
      const providers = splitList(args);
      const unknown = unknownValues(providers, providerIdSet(ctx));
      if (unknown.length > 0) {
        text(ctx, `Unknown provider id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
        return;
      }
      const next = activeProviderSet(asShellState(ctx));
      for (const provider of providers) next.delete(provider);
      const list = next.size > 0 ? [...next] : [];
      ctx.dispatch({ type: "setProviders", providers: list });
      text(
        ctx,
        list.length > 0
          ? `Active providers: ${list.join(", ")}`
          : "No providers active; runCouncil will use its heuristic fallback."
      );
    }
  },
  {
    name: "roles",
    summary: "Limit council roles",
    argHint: "<ids>",
    run(ctx, args) {
      const roles = splitList(args);
      const unknown = unknownValues(roles, roleIdSet(ctx));
      if (unknown.length > 0) {
        text(ctx, `Unknown role${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
        return;
      }
      const next = roles.length > 0 ? roles : undefined;
      ctx.dispatch({ type: "setRoles", roles: next });
      text(ctx, next ? `Active roles: ${next.join(", ")}` : "Using roles from config.");
    }
  },
  {
    name: "mode",
    summary: "Set mode: review or plan",
    argHint: "review|plan",
    run(ctx, args) {
      const value = args.trim();
      if (value !== "review" && value !== "plan") {
        text(ctx, "Unknown command: /mode. Use /help.");
        return;
      }
      ctx.dispatch({ type: "setMode", mode: value });
      text(ctx, `Mode set to ${value}.`);
    }
  },
  {
    name: "diff",
    summary: "Load a unified diff file",
    argHint: "<path>",
    run(ctx, args) {
      const path = args.trim();
      if (!path) {
        text(ctx, "Unknown command: /diff. Use /help.");
        return;
      }
      const state = ctx.getState();
      const diff = readDiff({ diff: path }, state.cwd);
      ctx.dispatch({ type: "setDiff", diff, diffLabel: path });
      text(ctx, `Loaded diff from ${path}.`);
    }
  },
  {
    name: "git",
    summary: "Load git diff from this repo",
    argHint: "[base] [head]",
    run(ctx, args) {
      const [base, head] = splitWords(args);
      const state = ctx.getState();
      const diff = readDiff({ base, head }, state.cwd);
      const label = base && head ? `${base}...${head}` : base ?? "git working tree";
      ctx.dispatch({ type: "setDiff", diff, diffLabel: label });
      text(ctx, `Loaded diff from ${label}.`);
    }
  },
  {
    name: "pr",
    summary: "Load a PR diff with gh",
    argHint: "<number>",
    run(ctx, args) {
      const number = args.trim();
      if (!number) {
        text(ctx, "Unknown command: /pr. Use /help.");
        return;
      }
      const state = ctx.getState();
      const diff = readDiff({ pr: number }, state.cwd);
      ctx.dispatch({ type: "setDiff", diff, diffLabel: `PR #${number}` });
      text(ctx, `Loaded diff from PR #${number}.`);
    }
  },
  {
    name: "review",
    summary: "Review the loaded/current diff",
    argHint: "[subject]",
    async run(ctx, args) {
      const state = ctx.getState();
      const diff = state.diff ?? readDiff({}, state.cwd);
      const subject = args.trim() || "Interactive code review";
      await runReviewWithReport(ctx, "review", subject, diff);
    }
  },
  {
    name: "plan",
    aliases: ["ask"],
    summary: "Evaluate a plan prompt",
    argHint: "<text>",
    async run(ctx, args) {
      const prompt = args.trim();
      if (!prompt) {
        text(ctx, "Unknown command: /plan. Use /help.");
        return;
      }
      await runReviewWithReport(ctx, "plan", prompt, undefined);
    }
  },
  {
    name: "last",
    summary: "Show the last report",
    run(ctx) {
      const report = ctx.getState().lastReport;
      if (!report) {
        text(ctx, "No report yet.");
        return;
      }
      ctx.emit({ id: cellId(), kind: "findings", report });
    }
  },
  {
    name: "rerun",
    summary: "Run the last request again",
    async run(ctx) {
      const request = ctx.getState().lastRequest;
      if (!request) {
        text(ctx, "No request to rerun yet.");
        return;
      }
      await runReviewWithReport(ctx, request.mode, request.subject, request.diff);
    }
  },
  {
    name: "history",
    summary: "Show recent shell commands",
    run(ctx) {
      text(ctx, "No shell history yet.");
    }
  },
  {
    name: "json",
    summary: "Save last report as JSON",
    argHint: "<path>",
    run(ctx, args) {
      const path = args.trim();
      const state = ctx.getState();
      if (!path) {
        text(ctx, "Unknown command: /json. Use /help.");
        return;
      }
      if (!state.lastReport) {
        text(ctx, "No report to save yet.");
        return;
      }
      writeFileSync(resolve(state.cwd, path), `${JSON.stringify(state.lastReport, null, 2)}\n`, "utf8");
      text(ctx, `Saved report JSON to ${path}.`);
    }
  },
  {
    name: "markdown",
    aliases: ["md"],
    summary: "Save last report as Markdown",
    argHint: "<path>",
    run(ctx, args) {
      const path = args.trim();
      const state = ctx.getState();
      if (!path) {
        text(ctx, "Unknown command: /markdown. Use /help.");
        return;
      }
      if (!state.lastReport) {
        text(ctx, "No report to save yet.");
        return;
      }
      writeFileSync(resolve(state.cwd, path), renderMarkdownReport(state.lastReport), "utf8");
      text(ctx, `Saved report Markdown to ${path}.`);
    }
  },
  {
    name: "clear",
    aliases: ["reset"],
    summary: "Clear loaded diff and last report",
    run(ctx) {
      ctx.dispatch({ type: "clear" });
      text(ctx, "Cleared loaded diff and last report.");
    }
  },
  {
    name: "help",
    aliases: ["?"],
    summary: "Show shell commands",
    run(ctx) {
      text(ctx, helpText());
    }
  },
  {
    name: "exit",
    aliases: ["q", "quit"],
    summary: "Leave the shell",
    run(ctx) {
      text(ctx, "Leaving Quorate shell.");
    }
  }
];

function splitWords(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean);
}

function providerSnapshotsFor(ctx: ShellContext) {
  return providerSnapshotsImpl(asShellState(ctx));
}

const aliasMap: Map<string, SlashCommand> = (() => {
  const map = new Map<string, SlashCommand>();
  for (const command of commandRegistry) {
    map.set(command.name, command);
    for (const alias of command.aliases ?? []) {
      if (!map.has(alias)) map.set(alias, command);
    }
  }
  return map;
})();

export function resolveCommand(name: string): SlashCommand | undefined {
  return aliasMap.get(name.toLowerCase());
}

export async function parseAndRun(ctx: ShellContext, line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  if (!trimmed.startsWith("/")) {
    const mode = ctx.getState().mode;
    const command = resolveCommand(mode === "review" ? "review" : "plan");
    if (command) await command.run(ctx, trimmed);
    return;
  }

  const [rawName = "", ...rest] = trimmed.slice(1).split(/\s+/);
  const command = resolveCommand(rawName);
  if (!command) {
    ctx.emit({ id: cellId(), kind: "text", text: `Unknown command: /${rawName}. Use /help.` });
    return;
  }
  await command.run(ctx, rest.join(" ").trim());
}
