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
  splitWords,
  resolveUseProviders,
  activeProviderSet,
  closestMatch,
  suggestionSuffix,
  providerSnapshots as providerSnapshotsImpl,
  statusText as buildStatusText,
  type ShellState
} from "../session.js";
import type { ShellContext } from "./context.js";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  summary: string;
  argHint?: string;
  /** Kept in the registry (e.g. for snapshot parity) but hidden from the
   *  palette and "did you mean" suggestions to avoid duplicate rows. */
  hidden?: boolean;
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

/** Emit a diff summary card (or a plain note when the diff is empty). */
function emitDiff(ctx: ShellContext, label: string, diff: string): void {
  if (!diff || diff.trim().length === 0) {
    text(ctx, `No changes found in ${label}.`);
    return;
  }
  ctx.emit({ id: cellId(), kind: "diff", label, diff });
}

export const commandRegistry: SlashCommand[] = [
  {
    name: "providers",
    aliases: ["doctor"],
    summary: "List providers and local availability",
    run: runProviders
  },
  {
    // Kept as a registry name (the command list snapshot asserts it) but shares the
    // single `runProviders` implementation rather than duplicating its body. Hidden
    // from the palette/suggestions since `/providers` already exposes `doctor` as an
    // alias — listing both would render a duplicate row.
    name: "doctor",
    summary: "Alias for /providers",
    hidden: true,
    run: runProviders
  },
  {
    name: "status",
    summary: "Show current session state",
    run(ctx) {
      text(ctx, buildStatusText(ctx.getState()));
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
        text(
          ctx,
          `Unknown provider id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}${suggestionSuffix(unknown, providerIdSet(ctx))}`
        );
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
        text(
          ctx,
          `Unknown provider id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}${suggestionSuffix(unknown, providerIdSet(ctx))}`
        );
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
        text(
          ctx,
          `Unknown provider id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}${suggestionSuffix(unknown, providerIdSet(ctx))}`
        );
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
        text(
          ctx,
          `Unknown role${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}${suggestionSuffix(unknown, roleIdSet(ctx))}`
        );
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
      emitDiff(ctx, path, diff);
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
      emitDiff(ctx, label, diff);
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
      emitDiff(ctx, `PR #${number}`, diff);
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
      const transcript = ctx.getState().transcript ?? [];
      const recent = transcript.slice(-10);
      text(
        ctx,
        recent.length > 0
          ? recent.map((entry, index) => `${index + 1}. ${entry.at} ${entry.input}`).join("\n")
          : "No shell history yet."
      );
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
    name: "skills",
    aliases: ["councils"],
    summary: "Show the council roles and their routing",
    run(ctx) {
      ctx.emit({ id: cellId(), kind: "skills", roles: skillsData(ctx) });
    }
  },
  {
    name: "plugins",
    aliases: ["agents"],
    summary: "Browse the agent CLIs Quorate can drive",
    run(ctx) {
      ctx.emit({ id: cellId(), kind: "plugins", items: pluginsData(ctx) });
    }
  },
  {
    name: "provider",
    summary: "Show one provider's safety config",
    argHint: "<id>",
    run(ctx, args) {
      const id = args.trim();
      const config = ctx.getState().config;
      const provider = config.providers.find((candidate) => candidate.id === id);
      if (!provider) {
        const ids = config.providers.map((candidate) => candidate.id);
        text(ctx, `Unknown provider id: ${id || "(none)"}${suggestionSuffix(id ? [id] : [], ids)}`);
        return;
      }
      const snapshot = providerSnapshotsFor(ctx).find((row) => row.id === id);
      ctx.emit({
        id: cellId(),
        kind: "providerDetail",
        provider,
        available: snapshot?.available ?? false,
        enabled: provider.enabled !== false
      });
    }
  },
  {
    name: "settings",
    aliases: ["config"],
    summary: "Show current configuration (.quorate.yml)",
    run(ctx) {
      ctx.emit({ id: cellId(), kind: "settings", config: ctx.getState().config });
    }
  },
  {
    name: "theme",
    summary: "Show the palette and theming",
    run(ctx) {
      ctx.emit({ id: cellId(), kind: "theme" });
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
      ctx.emit({ id: cellId(), kind: "help" });
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

function providerSnapshotsFor(ctx: ShellContext) {
  return providerSnapshotsImpl(asShellState(ctx));
}

function runProviders(ctx: ShellContext): void {
  ctx.emit({ id: cellId(), kind: "providerStatus", rows: providerSnapshotsFor(ctx) });
}

/** Council roles with the providers configured to cover each — the /skills view. */
function skillsData(ctx: ShellContext): Array<{ role: string; providers: string[] }> {
  const config = ctx.getState().config;
  return config.councils.map((role) => ({
    role,
    providers: config.providers
      .filter((provider) => (provider.roles ?? []).includes(role))
      .map((provider) => provider.id)
  }));
}

/** The agent roster with availability status — the /plugins view. */
function pluginsData(ctx: ShellContext): Array<{ id: string; name: string; status: string; roles: string[] }> {
  const byId = new Map(ctx.getState().config.providers.map((provider) => [provider.id, provider]));
  return providerSnapshotsFor(ctx)
    .filter((row) => row.id !== "heuristic")
    .map((row) => {
      const provider = byId.get(row.id);
      const status = !row.available ? "install" : row.active ? "enabled" : row.runnable ? "installed" : "available";
      return { id: row.id, name: provider?.installHint ?? row.id, status, roles: provider?.roles ?? [] };
    });
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

/** Every visible command name and alias, de-duplicated — the candidate set for
 *  "did you mean" hints. */
export function commandNames(): string[] {
  const names = new Set<string>();
  for (const command of commandRegistry) {
    if (command.hidden) continue;
    names.add(command.name);
    for (const alias of command.aliases ?? []) names.add(alias);
  }
  return [...names];
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
    const suggestion = closestMatch(rawName, commandNames());
    const hint = suggestion ? ` Did you mean /${suggestion}?` : "";
    ctx.emit({ id: cellId(), kind: "text", text: `Unknown command: /${rawName}.${hint} Use /help.` });
    return;
  }
  await command.run(ctx, rest.join(" ").trim());
}
