import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  fetchProviderModels,
  isEmptyReviewDiff,
  renderMarkdownReport,
  type CouncilMode,
  type CouncilReport,
  type CouncilRequest
} from "@quorate/core";
import {
  discoverCustomCommands,
  renderCustomPrompt,
  workspaceCommandsTrusted,
  type CustomCommandDefinition
} from "../custom-commands.js";
import { formatDoctorReport } from "../doctor.js";
import { listLiveRuns } from "../live-spool.js";
import { readDiff } from "../diff.js";
import { projectMemoryInspectLines } from "../project-memory.js";
import { parseSupplyChainShellArgs, scanSupplyChain } from "../supply-chain-command.js";
import {
  splitList,
  splitWords,
  resolveUseProviders,
  activeProviderSet,
  closestMatch,
  suggestionSuffix,
  providerSnapshots as providerSnapshotsImpl,
  statusText as buildStatusText,
  inspectText,
  setupText,
  type ShellState
} from "../session.js";
import {
  compareCouncilReports,
  compareSessionSummaries,
  createSessionId,
  formatSessionLine,
  listSessions,
  loadCouncilReport,
  loadSession,
  saveSession,
  sessionFromState,
  type PersistedSession
} from "../sessions.js";
import type { ShellContext } from "./context.js";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  summary: string;
  argHint?: string;
  /** Workspace command loaded from `.quorate/commands/*.md`. */
  custom?: boolean;
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
    projectMemory: state.projectMemory,
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

function resolveReviewDiff(ctx: ShellContext): { diff?: string; label?: string } {
  const state = ctx.getState();
  if (state.diff !== undefined) {
    return { diff: state.diff, label: state.diffLabel };
  }
  const diff = readDiff({}, state.cwd);
  if (isEmptyReviewDiff("review", diff)) {
    return { diff };
  }
  const label = "git working tree";
  ctx.dispatch({ type: "setDiff", diff, diffLabel: label });
  emitDiff(ctx, label, diff);
  return { diff, label };
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
  if (mode === "review") {
    persistSession(ctx);
  }
}

function persistSession(ctx: ShellContext): void {
  const state = ctx.getState();
  const id = state.sessionId ?? createSessionId();
  const name = state.sessionName ?? state.diffLabel ?? `Session ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  if (!state.sessionId || state.sessionName !== name) {
    ctx.dispatch({ type: "setSessionMeta", id, name });
  }
  const snapshot = sessionFromState({ ...state, sessionId: id, sessionName: name });
  saveSession(state.cwd, snapshot);
  if (state.lastReport) {
    const reportDir = resolve(state.cwd, ".quorate");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(resolve(reportDir, "last-report.json"), `${JSON.stringify(state.lastReport, null, 2)}\n`, "utf8");
  }
}

function restorePersistedSession(ctx: ShellContext, session: PersistedSession): void {
  ctx.dispatch({ type: "setSessionMeta", id: session.id, name: session.name });
  ctx.dispatch({ type: "setMode", mode: session.mode });
  if (session.activeProviders !== undefined) {
    ctx.dispatch({ type: "setProviders", providers: session.activeProviders });
  }
  if (session.activeRoles !== undefined) {
    ctx.dispatch({ type: "setRoles", roles: session.activeRoles });
  }
  if (session.diffLabel) {
    ctx.dispatch({ type: "setDiff", diff: undefined, diffLabel: session.diffLabel });
  }
  const recap = session.lastReportSummary
    ? `Resumed "${session.name}" — last verdict: ${session.lastReportSummary.verdict.toUpperCase()}${session.lastReportSummary.degraded ? " (degraded)" : ""} — ${session.lastReportSummary.summary}`
    : `Resumed "${session.name}".`;
  text(ctx, recap);
  if (session.diffLabel) {
    text(ctx, `Diff label was "${session.diffLabel}" — reload with /git, /diff, or /pr before reviewing.`);
  }
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

export const baseCommandRegistry: SlashCommand[] = [
  {
    name: "providers",
    summary: "List providers and local availability",
    run: runProviders
  },
  {
    name: "monitor",
    summary: "Show live council runs on this machine (full dashboard: quorate monitor)",
    run: runMonitorSnapshot
  },
  {
    name: "doctor",
    summary: "Council readiness verdict (environment + providers)",
    run: runDoctor
  },
  {
    name: "inspect",
    summary: "Config path, agents, roles, spawn status, and project memory",
    run(ctx) {
      text(ctx, inspectText(asShellState(ctx)));
    }
  },
  {
    name: "setup",
    summary: "Guided setup wizard (/git → /use → /review)",
    run(ctx) {
      text(ctx, setupText(asShellState(ctx)));
    }
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
    name: "route",
    summary: "View & reassign role→provider routing for this session",
    argHint: "[role provider...|reset]",
    run(ctx, args) {
      const tokens = splitWords(args);
      if (tokens.length === 0) {
        ctx.emit({ id: cellId(), kind: "route", rows: routeRows(ctx) });
        return;
      }
      if (tokens[0] === "reset") {
        const role = tokens[1];
        const overrides = ctx.getState().roleOverrides;
        if (!overrides || (role && !overrides[role])) {
          text(ctx, "Already using config routing.");
          return;
        }
        ctx.dispatch({ type: "clearRoute", role });
        ctx.emit({ id: cellId(), kind: "route", rows: routeRows(ctx) });
        text(
          ctx,
          role ? `Routing for ${role} restored.` : "Routing restored to config defaults (.quorate.yml)."
        );
        return;
      }
      const [role, ...provs] = tokens;
      if (!roleIdSet(ctx).has(role)) {
        text(ctx, `Unknown role: ${role}${suggestionSuffix([role], roleIdSet(ctx))}`);
        return;
      }
      if (provs.length === 0) {
        text(ctx, `Usage: /route ${role} <provider...> (or /route reset ${role}).`);
        return;
      }
      const unknown = unknownValues(provs, providerIdSet(ctx));
      if (unknown.length > 0) {
        text(
          ctx,
          `Unknown provider id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}${suggestionSuffix(unknown, providerIdSet(ctx))}`
        );
        return;
      }
      ctx.dispatch({ type: "setRoute", role, providers: provs });
      ctx.emit({ id: cellId(), kind: "route", rows: routeRows(ctx) });
      text(
        ctx,
        `${role} now routes to ${provs.join(", ")} this session — /route reset to undo · persist by setting roles: on those providers in .quorate.yml.`
      );
    }
  },
  {
    name: "fix",
    summary: "Delegate a finding to a write-mode agent (snapshotted + revertible)",
    argHint: "[finding#]",
    run(ctx, args) {
      const report = ctx.getState().lastReport;
      const findings = (report?.findings ?? []).filter((finding) => finding.file);
      if (findings.length === 0) {
        text(ctx, "No fixable findings — run /review first (findings need a file location).");
        return;
      }
      const n = Number(splitWords(args)[0]);
      if (Number.isInteger(n) && n >= 1 && n <= findings.length) {
        const finding = findings[n - 1];
        text(
          ctx,
          [
            `#${n} [${finding.severity}] ${finding.file}${finding.line ? `:${finding.line}` : ""} — ${finding.title}`,
            "",
            "The fixing agent needs your real terminal (it runs interactively). Exit the shell and run:",
            `  quorate fix --finding ${n}`,
            "It snapshots first; undo any fix with `quorate fix --revert`."
          ].join("\n")
        );
        return;
      }
      text(
        ctx,
        [
          `Fixable findings (${findings.length}):`,
          ...findings.map(
            (finding, i) =>
              `  ${i + 1}. [${finding.severity}] ${finding.file}${finding.line ? `:${finding.line}` : ""} — ${finding.title}`
          ),
          "",
          "Run `quorate fix --finding <n>` in your terminal (interactive, snapshotted, revertible)."
        ].join("\n")
      );
    }
  },
  {
    name: "merge",
    summary: "Pick a master agent that merges duplicate findings (or off)",
    argHint: "<provider|off>",
    run(ctx, args) {
      const value = splitWords(args)[0];
      const state = ctx.getState();
      if (!value) {
        const current = state.config.merge?.provider;
        const candidates = state.config.providers
          .filter((p) => p.type !== "mock")
          .map((p) => p.id)
          .join(", ");
        text(
          ctx,
          current
            ? `Master merge agent: ${current}. Change with /merge <provider>, disable with /merge off.`
            : `No master merge agent — duplicates are merged by built-in clustering only.\nPick one with /merge <provider> (candidates: ${candidates || "none"}).`
        );
        return;
      }
      if (value === "off") {
        ctx.dispatch({ type: "setMerge", providerId: undefined });
        text(ctx, "Master merge disabled — using built-in clustering only.");
        return;
      }
      const provider = state.config.providers.find((p) => p.id === value);
      if (!provider) {
        text(ctx, `Unknown provider: ${value}${suggestionSuffix([value], providerIdSet(ctx))}`);
        return;
      }
      if (provider.type === "mock") {
        text(ctx, "The heuristic can't merge findings — pick a cli or api provider.");
        return;
      }
      ctx.dispatch({ type: "setMerge", providerId: provider.id });
      text(
        ctx,
        `${provider.id} is now the master merge agent (this session) — persist with \`merge:\n  provider: ${provider.id}\` in .quorate.yml.`
      );
    }
  },
  {
    name: "models",
    summary: "List an api provider's live models, or switch its model",
    argHint: "<provider> [model]",
    async run(ctx, args) {
      const [providerId, ...rest] = splitWords(args);
      const state = ctx.getState();
      const apiProviders = state.config.providers.filter((p) => p.type === "api");
      if (!providerId) {
        if (apiProviders.length === 0) {
          text(ctx, "No api providers configured — add one with `quorate provider add <id> --preset <name>`.");
          return;
        }
        text(
          ctx,
          ["api providers:", ...apiProviders.map((p) => `  ${p.id} — ${p.model}`), "Usage: /models <provider> [model]"].join("\n")
        );
        return;
      }
      const provider = apiProviders.find((p) => p.id === providerId);
      if (!provider) {
        text(ctx, `No api provider "${providerId}".${apiProviders.length ? ` Try: ${apiProviders.map((p) => p.id).join(", ")}` : ""}`);
        return;
      }
      const requested = rest.join(" ").trim();
      const apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
      const models = await fetchProviderModels(provider.baseUrl, apiKey);
      if (requested) {
        // Session-level switch; persisting stays explicit via provider set-model.
        if (models.length > 0 && !models.includes(requested)) {
          text(ctx, `"${requested}" is not in the live list (${models.length} models) — switching anyway.`);
        }
        ctx.dispatch({ type: "setProviderModel", providerId, model: requested });
        text(
          ctx,
          `${providerId} model: ${provider.model} → ${requested} (this session) — persist with \`quorate provider set-model ${providerId} ${requested}\`.`
        );
        return;
      }
      if (models.length === 0) {
        const hint = provider.apiKeyEnv && !apiKey ? ` Set ${provider.apiKeyEnv} to authenticate.` : "";
        text(ctx, `No models returned from ${provider.baseUrl}/models.${hint}`);
        return;
      }
      const shown = models.slice(0, 30);
      text(
        ctx,
        [
          `${models.length} models at ${provider.baseUrl}:`,
          ...shown.map((m) => (m === provider.model ? `* ${m}` : `  ${m}`)),
          models.length > shown.length ? `… and ${models.length - shown.length} more` : "",
          `Switch with /models ${providerId} <model>`
        ]
          .filter(Boolean)
          .join("\n")
      );
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
      const { diff } = resolveReviewDiff(ctx);
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
    name: "supply-chain",
    aliases: ["supplychain"],
    summary: "Run deterministic dependency and release-pipeline checks",
    argHint: "[scan] [--base <ref> | --diff <path> | --pr <n>] [--gate]",
    run(ctx, args) {
      const options = parseSupplyChainShellArgs(args);
      const result = scanSupplyChain(options, {
        cwd: ctx.getState().cwd,
        config: ctx.getState().config
      });
      if (!result) {
        text(ctx, "No changes to scan. Pass --diff, --base/--head, or --pr.");
        return;
      }
      ctx.dispatch({ type: "setLastRequest", request: undefined });
      ctx.dispatch({ type: "setLastReport", report: result.report });
      if (options.json) text(ctx, JSON.stringify(result.report, null, 2));
      else ctx.emit({ id: cellId(), kind: "findings", report: result.report });
      if (options.gate) text(ctx, `SupplyChainGate policy: ${result.gateFailed ? "FAIL" : "PASS"}.`);
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
    name: "logs",
    aliases: ["agent"],
    summary: "Review each agent's full output after a run",
    argHint: "[provider|provider:role]",
    run(ctx, args) {
      const report = ctx.getState().lastReport;
      if (!report) {
        text(ctx, "No report yet. Run /review or /plan first.");
        return;
      }
      const results = report.providerResults;
      const arg = args.trim();
      if (!arg) {
        ctx.emit({ id: cellId(), kind: "logs", variant: "overview", lanes: results });
        return;
      }
      const [p, r] = arg.split(":");
      if (r) {
        const hit = results.find((x) => x.providerId === p && x.role === r);
        if (hit) {
          ctx.emit({ id: cellId(), kind: "logs", variant: "detail", result: hit });
          return;
        }
      } else {
        const forProvider = results.filter((x) => x.providerId === p);
        if (forProvider.length === 1) {
          ctx.emit({ id: cellId(), kind: "logs", variant: "detail", result: forProvider[0] });
          return;
        }
        if (forProvider.length > 1) {
          ctx.emit({ id: cellId(), kind: "logs", variant: "overview", lanes: forProvider });
          text(ctx, `${p} covers ${forProvider.length} roles — try /logs ${p}:${forProvider[0].role}`);
          return;
        }
      }
      const keys = results.map((x) => `${x.providerId}:${x.role}`);
      const ids = [...new Set(results.map((x) => x.providerId))];
      text(ctx, `No run for "${arg}".${suggestionSuffix([arg], new Set([...keys, ...ids]))}`);
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
    name: "resume",
    summary: "Resume a saved session",
    argHint: "[id]",
    run(ctx, args) {
      const id = args.trim();
      const cwd = ctx.getState().cwd;
      if (!id) {
        const sessions = listSessions(cwd);
        if (sessions.length === 0) {
          text(ctx, "No saved sessions for this repo.");
          return;
        }
        text(ctx, sessions.map((session) => formatSessionLine(session)).join("\n"));
        return;
      }
      const session = loadSession(cwd, id) ?? listSessions(cwd).find((entry) => entry.id.startsWith(id));
      if (!session) {
        text(ctx, `No saved session with id "${id}". Use /resume to list sessions.`);
        return;
      }
      restorePersistedSession(ctx, session);
    }
  },
  {
    name: "rename",
    summary: "Rename the current saved session",
    argHint: "<name>",
    run(ctx, args) {
      const name = args.trim();
      if (!name) {
        text(ctx, "Unknown command: /rename. Use /help.");
        return;
      }
      const state = ctx.getState();
      const id = state.sessionId ?? createSessionId();
      ctx.dispatch({ type: "setSessionMeta", id, name });
      const snapshot = sessionFromState({ ...ctx.getState(), sessionId: id, sessionName: name });
      saveSession(state.cwd, snapshot);
      text(ctx, `Session renamed to "${name}".`);
    }
  },
  {
    name: "compare",
    summary: "Compare two saved sessions or report JSON files",
    argHint: "<left> <right>",
    run(ctx, args) {
      const [leftRef = "", rightRef = ""] = splitWords(args);
      if (!leftRef || !rightRef) {
        text(ctx, "Usage: /compare <session-id|report.json> <session-id|report.json>");
        return;
      }
      text(ctx, compareCommandText(ctx.getState().cwd, leftRef, rightRef));
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

/** A one-shot registry snapshot; the live dashboard is `quorate monitor` (own screen). */
function runMonitorSnapshot(ctx: ShellContext): void {
  const runs = listLiveRuns();
  if (runs.length === 0) {
    text(ctx, "No live runs. Start one with /review here or `quorate review` in another terminal.");
    return;
  }
  const lines = runs.slice(0, 10).map((run) => {
    const started = run.startedAt.replace("T", " ").slice(0, 19);
    return `  ${run.status.padEnd(8)} ${run.repo.padEnd(18)} ${run.mode.padEnd(7)} ${run.planned.length} lanes  ${started}  ${run.subject}`;
  });
  text(ctx, [`Live runs (${runs.length}):`, ...lines, "", "Full dashboard: quorate monitor"].join("\n"));
}

function runDoctor(ctx: ShellContext): void {
  text(ctx, formatDoctorReport(asShellState(ctx)));
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

/** The override-aware role→provider table for the /route view: each council role
 *  with the providers that cover it (the session override when one is active, the
 *  config routing otherwise) and a flag marking overridden rows. /skills stays the
 *  config view; /route is the session view. */
function routeRows(
  ctx: ShellContext
): Array<{ role: string; providers: string[]; overridden: boolean }> {
  const state = ctx.getState();
  const config = state.config;
  const overrides = state.roleOverrides ?? {};
  return config.councils.map((role) => {
    const overridden = role in overrides;
    const providers = overridden
      ? overrides[role]
      : config.providers
          .filter((provider) => (provider.roles ?? []).includes(role))
          .map((provider) => provider.id);
    return { role, providers, overridden };
  });
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

/** Built-in commands only — stable for unit tests. */
export const commandRegistry = baseCommandRegistry;

function builtinNames(registry: SlashCommand[]): Set<string> {
  const names = new Set<string>();
  for (const command of registry) {
    names.add(command.name.toLowerCase());
    for (const alias of command.aliases ?? []) names.add(alias.toLowerCase());
  }
  return names;
}

function customCommandToSlash(definition: CustomCommandDefinition): SlashCommand {
  return {
    name: definition.name,
    summary: definition.description,
    argHint: definition.argHint,
    custom: true,
    async run(ctx, args) {
      const state = ctx.getState();
      const prompt = renderCustomPrompt(definition.body, args);
      const mode = definition.mode ?? state.mode;
      if (mode === "plan") {
        await runReviewWithReport(ctx, "plan", prompt, undefined);
        return;
      }
      const { diff } = resolveReviewDiff(ctx);
      await runReviewWithReport(ctx, "review", prompt, diff);
    }
  };
}

/**
 * Merge built-in commands with `.quorate/commands/*.md` (built-ins win on name
 * conflicts). Repo-authored commands are only loaded when the workspace is
 * trusted (QUORATE_TRUST_WORKSPACE) — otherwise an untrusted repo could inject
 * runnable commands and council prompts.
 */
export function buildCommandRegistry(
  cwd: string,
  trusted: boolean = workspaceCommandsTrusted()
): SlashCommand[] {
  const reserved = builtinNames(baseCommandRegistry);
  const custom = discoverCustomCommands(cwd, trusted)
    .filter((definition) => !reserved.has(definition.name.toLowerCase()))
    .map(customCommandToSlash);
  return [...baseCommandRegistry, ...custom];
}

function buildAliasMap(registry: SlashCommand[]): Map<string, SlashCommand> {
  const map = new Map<string, SlashCommand>();
  for (const command of registry) {
    map.set(command.name.toLowerCase(), command);
    for (const alias of command.aliases ?? []) {
      if (!map.has(alias.toLowerCase())) map.set(alias.toLowerCase(), command);
    }
  }
  return map;
}

export function resolveCommand(name: string, registry: SlashCommand[] = baseCommandRegistry): SlashCommand | undefined {
  return buildAliasMap(registry).get(name.toLowerCase());
}

/** Every visible command name and alias, de-duplicated — the candidate set for
 *  "did you mean" hints. */
export function commandNames(registry: SlashCommand[] = baseCommandRegistry): string[] {
  const names = new Set<string>();
  for (const command of registry) {
    if (command.hidden) continue;
    names.add(command.name);
    for (const alias of command.aliases ?? []) names.add(alias);
  }
  return [...names];
}

function commandSearchTerms(command: SlashCommand): string[] {
  return [command.name, ...(command.aliases ?? [])];
}

/** Score how well `term` matches `query` (higher is better, -1 = no match). */
export function scoreCommandMatch(term: string, query: string): number {
  if (!query) return 0;
  const normalizedTerm = term.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  if (normalizedTerm.startsWith(normalizedQuery)) {
    return 100 - (normalizedTerm.length - normalizedQuery.length);
  }
  const index = normalizedTerm.indexOf(normalizedQuery);
  if (index >= 0) {
    return 50 - index;
  }
  let termIndex = 0;
  let score = 0;
  for (const char of normalizedQuery) {
    const found = normalizedTerm.indexOf(char, termIndex);
    if (found === -1) return -1;
    score += found === termIndex ? 2 : 1;
    termIndex = found + 1;
  }
  return 10 + score;
}

function resolveCompareTarget(
  cwd: string,
  ref: string
): { label: string; session?: PersistedSession; report?: CouncilReport } | undefined {
  const reportPath = resolve(cwd, ref);
  // Constrain report loading to within the repo: a user-supplied ref must not
  // read arbitrary JSON outside cwd (e.g. /compare ../../../etc/secrets.json).
  const rel = relative(cwd, reportPath);
  const withinRepo = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  const report = ref.endsWith(".json") && withinRepo ? loadCouncilReport(reportPath) : undefined;
  if (report) {
    return { label: ref, report };
  }

  const session =
    loadSession(cwd, ref) ?? listSessions(cwd).find((entry) => entry.id.startsWith(ref));
  if (session) {
    return { label: `${session.name} (${session.id.slice(0, 8)})`, session };
  }
  return undefined;
}

function compareCommandText(cwd: string, leftRef: string, rightRef: string): string {
  const left = resolveCompareTarget(cwd, leftRef);
  const right = resolveCompareTarget(cwd, rightRef);
  if (!left) return `Could not resolve left target "${leftRef}".`;
  if (!right) return `Could not resolve right target "${rightRef}".`;

  if (left.report && right.report) {
    return compareCouncilReports(left.report, right.report, { left: left.label, right: right.label });
  }

  return compareSessionSummaries(
    { label: left.label, summary: left.session?.lastReportSummary },
    { label: right.label, summary: right.session?.lastReportSummary }
  );
}

interface CommandMatchRank {
  tier: number;
  score: number;
  index: number;
}

/** Lower tier wins; within a tier, higher score wins; ties keep registry order. */
function commandMatchRank(command: SlashCommand, query: string, index: number): CommandMatchRank | null {
  if (!query) return { tier: 0, score: 0, index };
  const normalizedQuery = query.toLowerCase();
  const normalizedName = command.name.toLowerCase();
  if (normalizedName.startsWith(normalizedQuery)) {
    return { tier: 0, score: normalizedName.length, index };
  }
  const nameScore = scoreCommandMatch(command.name, query);
  if (nameScore >= 0) {
    return { tier: 1, score: nameScore, index };
  }
  const aliasScore = Math.max(
    -1,
    ...(command.aliases ?? []).map((alias) => scoreCommandMatch(alias, query))
  );
  if (aliasScore >= 0) {
    return { tier: 2, score: aliasScore, index };
  }
  return null;
}

/** Fuzzy/substring palette matches, best-first. Empty query lists every visible command. */
export function matchCommands(query: string, cwd?: string): SlashCommand[] {
  const registry = cwd ? buildCommandRegistry(cwd) : baseCommandRegistry;
  const scored = registry
    .map((command, index) => {
      if (command.hidden) return null;
      const rank = commandMatchRank(command, query, index);
      return rank ? { command, rank } : null;
    })
    .filter((entry): entry is { command: SlashCommand; rank: CommandMatchRank } => entry !== null)
    .sort((left, right) => {
      if (left.rank.tier !== right.rank.tier) return left.rank.tier - right.rank.tier;
      if (left.rank.score !== right.rank.score) return right.rank.score - left.rank.score;
      return left.rank.index - right.rank.index;
    });
  return scored.map((entry) => entry.command);
}

/** True when Enter on a palette row should run immediately (no trailing args needed). */
export function commandCompletesWithoutArgs(command: SlashCommand): boolean {
  if (!command.argHint) return true;
  return command.argHint.includes("[");
}

export async function parseAndRun(ctx: ShellContext, line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  const registry = buildCommandRegistry(ctx.getState().cwd);

  if (!trimmed.startsWith("/")) {
    const mode = ctx.getState().mode;
    const command = resolveCommand(mode === "review" ? "review" : "plan", registry);
    if (command) await command.run(ctx, trimmed);
    return;
  }

  const [rawName = "", ...rest] = trimmed.slice(1).split(/\s+/);
  const command = resolveCommand(rawName, registry);
  if (!command) {
    const suggestion = closestMatch(rawName, commandNames(registry));
    const hint = suggestion ? ` Did you mean /${suggestion}?` : "";
    ctx.emit({ id: cellId(), kind: "text", text: `Unknown command: /${rawName}.${hint} Use /help.` });
    return;
  }
  await command.run(ctx, rest.join(" ").trim());
}
