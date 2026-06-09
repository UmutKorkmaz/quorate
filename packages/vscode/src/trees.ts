import * as path from "node:path";
import * as vscode from "vscode";
import type { CouncilReport, DoctorReport, Finding, ProviderConfig, Severity } from "./cli";

const SEVERITY_ICON: Record<Severity, string> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "info",
  info: "info"
};

// ─────────────────────────── Council tree ───────────────────────────

type CouncilNode =
  | { kind: "diffSource" }
  | { kind: "provider"; provider: ProviderConfig }
  | { kind: "role"; role: string; assigned: boolean }
  | { kind: "add" };

export class CouncilTree implements vscode.TreeDataProvider<CouncilNode> {
  private readonly emitter = new vscode.EventEmitter<CouncilNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private providers: ProviderConfig[] = [];
  private enabled: Set<string> | null = null; // null = config default
  private diffLabel = "Working tree";

  setData(providers: ProviderConfig[], enabled: Set<string> | null, diffLabel: string): void {
    this.providers = providers;
    this.enabled = enabled;
    this.diffLabel = diffLabel;
    this.emitter.fire(undefined);
  }

  private isEnabled(p: ProviderConfig): boolean {
    return this.enabled ? this.enabled.has(p.id) : p.enabled !== false;
  }

  getTreeItem(node: CouncilNode): vscode.TreeItem {
    if (node.kind === "diffSource") {
      const item = new vscode.TreeItem(`Reviewing: ${this.diffLabel}`);
      item.iconPath = new vscode.ThemeIcon("git-compare");
      item.command = { command: "quorate.pickDiffSource", title: "Change Diff Source" };
      item.contextValue = "diffSource";
      return item;
    }
    if (node.kind === "add") {
      const item = new vscode.TreeItem("Add provider…");
      item.iconPath = new vscode.ThemeIcon("add");
      item.command = { command: "quorate.addProvider", title: "Add Provider" };
      return item;
    }
    if (node.kind === "role") {
      const item = new vscode.TreeItem(node.role);
      item.iconPath = new vscode.ThemeIcon(node.assigned ? "pass-filled" : "circle-large-outline");
      item.description = node.assigned ? "" : "unassigned";
      return item;
    }
    const p = node.provider;
    const item = new vscode.TreeItem(
      p.id,
      (p.roles?.length ?? 0) > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    item.description = p.type === "api" ? `api · ${p.model ?? "?"}` : p.type === "cli" ? `cli · ${p.command ?? p.id}` : "built-in";
    item.iconPath = new vscode.ThemeIcon(p.type === "mock" ? "law" : p.type === "api" ? "cloud" : "terminal");
    item.checkboxState = this.isEnabled(p)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    item.contextValue = p.type === "mock" ? "providerHeuristic" : p.type === "api" ? "providerApi" : "provider";
    item.tooltip = p.apiKeyEnv ? `Needs $${p.apiKeyEnv} in the environment` : undefined;
    return item;
  }

  getChildren(node?: CouncilNode): CouncilNode[] {
    if (!node) {
      return [
        { kind: "diffSource" },
        ...this.providers.map((provider) => ({ kind: "provider" as const, provider })),
        { kind: "add" }
      ];
    }
    if (node.kind === "provider") {
      const roles = node.provider.roles ?? [];
      return roles.map((role) => ({ kind: "role" as const, role, assigned: true }));
    }
    return [];
  }

  providerForId(id: string): ProviderConfig | undefined {
    return this.providers.find((p) => p.id === id);
  }

  /** Provider ids enabled by the current config (enabled !== false). */
  defaultEnabledIds(): string[] {
    return this.providers.filter((p) => p.enabled !== false).map((p) => p.id);
  }

  /** Apply an explicit enabled-set override (null restores config default). */
  updateEnabled(enabled: Set<string> | null): void {
    this.enabled = enabled;
    this.emitter.fire(undefined);
  }
}

// ─────────────────────────── Results tree ───────────────────────────

type ResultNode =
  | { kind: "verdict" }
  | { kind: "summary" }
  | { kind: "fileGroup"; file: string; findings: Finding[] }
  | { kind: "finding"; finding: Finding }
  | { kind: "providersGroup" }
  | { kind: "providerRun"; text: string; ok: boolean }
  | { kind: "liveHeader" }
  | { kind: "live"; key: string };

interface LiveProvider {
  role: string;
  status: "running" | "done" | "error";
  count: number;
}

export class ResultsTree implements vscode.TreeDataProvider<ResultNode> {
  private readonly emitter = new vscode.EventEmitter<ResultNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private report?: CouncilReport;
  private running = false;
  private readonly live = new Map<string, LiveProvider>();

  beginRun(): void {
    this.running = true;
    this.report = undefined;
    this.live.clear();
    this.emitter.fire(undefined);
  }

  applyEvent(event: { type: string; providerId?: string; role?: string; result?: { status: string; findings: unknown[] } }): void {
    if (!event.providerId || !event.role) return;
    const key = `${event.providerId}:${event.role}`;
    if (event.type === "provider/started") {
      this.live.set(key, { role: event.role, status: "running", count: 0 });
    } else if (event.type === "provider/done") {
      const ok = event.result?.status === "ok";
      this.live.set(key, { role: event.role, status: ok ? "done" : "error", count: event.result?.findings.length ?? 0 });
    } else {
      return;
    }
    this.emitter.fire(undefined);
  }

  setReport(report: CouncilReport | undefined): void {
    this.running = false;
    this.report = report;
    this.emitter.fire(undefined);
  }

  getTreeItem(node: ResultNode): vscode.TreeItem {
    if (node.kind === "liveHeader") {
      const item = new vscode.TreeItem("Convening the council…");
      item.iconPath = new vscode.ThemeIcon("sync~spin");
      return item;
    }
    if (node.kind === "live") {
      const lp = this.live.get(node.key)!;
      const item = new vscode.TreeItem(node.key);
      item.iconPath = new vscode.ThemeIcon(
        lp.status === "running" ? "sync~spin" : lp.status === "done" ? "pass" : "error"
      );
      item.description = lp.status === "running" ? "reviewing…" : lp.status === "done" ? `${lp.count} finding${lp.count === 1 ? "" : "s"}` : "failed";
      return item;
    }
    const r = this.report!;
    if (node.kind === "verdict") {
      const v = r.verdict;
      const item = new vscode.TreeItem(`${v.toUpperCase()}${r.metadata.degraded ? " — DEGRADED" : ""}`);
      item.iconPath = new vscode.ThemeIcon(v === "fail" ? "error" : v === "warn" ? "warning" : "pass");
      item.description = `· ${r.findings.length} finding${r.findings.length === 1 ? "" : "s"} · ${r.providerResults.length} reviewers`;
      return item;
    }
    if (node.kind === "summary") {
      const item = new vscode.TreeItem(r.summary);
      item.iconPath = new vscode.ThemeIcon("note");
      item.tooltip = r.summary;
      return item;
    }
    if (node.kind === "providersGroup") {
      const item = new vscode.TreeItem("Reviewers", vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon("organization");
      return item;
    }
    if (node.kind === "providerRun") {
      const item = new vscode.TreeItem(node.text);
      item.iconPath = new vscode.ThemeIcon(node.ok ? "pass" : "error");
      return item;
    }
    if (node.kind === "fileGroup") {
      const item = new vscode.TreeItem(node.file, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = vscode.ThemeIcon.File;
      item.resourceUri = vscode.Uri.file(node.file);
      item.description = `${node.findings.length}`;
      return item;
    }
    // finding
    const f = node.finding;
    const item = new vscode.TreeItem(f.title);
    item.iconPath = new vscode.ThemeIcon(SEVERITY_ICON[f.severity]);
    const agreed = f.agreedBy?.length ? ` · agreed by ${f.agreedBy.join(", ")}` : "";
    item.description = `${f.severity}${f.role ? ` · ${f.role}` : ""}${agreed}`;
    item.tooltip = new vscode.MarkdownString(`**${f.severity.toUpperCase()}** ${f.body}${f.suggestion ? `\n\n_Suggestion:_ ${f.suggestion}` : ""}`);
    if (f.file) {
      item.command = {
        command: "quorate.openFinding",
        title: "Open Finding",
        arguments: [f.file, f.line ?? 1]
      };
    }
    return item;
  }

  getChildren(node?: ResultNode): ResultNode[] {
    if (!node) {
      if (this.running) {
        return [{ kind: "liveHeader" }, ...[...this.live.keys()].map((key) => ({ kind: "live" as const, key }))];
      }
      const report = this.report;
      if (!report) return [];
      const groups = groupByFile(report.findings).map(([file, findings]) => ({ kind: "fileGroup" as const, file, findings }));
      return [{ kind: "verdict" }, { kind: "summary" }, ...groups, { kind: "providersGroup" }];
    }
    const r = this.report;
    if (!r) return [];
    if (node.kind === "fileGroup") {
      return node.findings.map((finding) => ({ kind: "finding" as const, finding }));
    }
    if (node.kind === "providersGroup") {
      return r.providerResults.map((pr) => ({
        kind: "providerRun" as const,
        ok: pr.status === "ok",
        text: `${pr.providerId}:${pr.role} · ${pr.status}${pr.findings ? ` · ${pr.findings.length}` : ""}`
      }));
    }
    return [];
  }
}

function groupByFile(findings: Finding[]): Array<[string, Finding[]]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.file ?? "General";
    const list = map.get(key) ?? [];
    list.push(f);
    map.set(key, list);
  }
  return [...map.entries()];
}

// ─────────────────────────── Status tree ───────────────────────────

type StatusNode = { label: string; icon: string; description?: string; tooltip?: string };

export class StatusTree implements vscode.TreeDataProvider<StatusNode> {
  private readonly emitter = new vscode.EventEmitter<StatusNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private nodes: StatusNode[] = [];

  setDoctor(doctor: DoctorReport | undefined, cliVersion: string | null): void {
    const nodes: StatusNode[] = [];
    nodes.push({
      label: `quorate CLI ${cliVersion ?? "not found"}`,
      icon: cliVersion ? "pass" : "error",
      description: cliVersion ? "" : "npm i -g quorate"
    });
    const detected = doctor?.detected ?? [];
    const available = detected.filter((d) => d.available);
    nodes.push({
      label: `Detected agents on PATH: ${available.length}`,
      icon: available.length > 0 ? "pass" : "warning",
      tooltip: available.map((d) => d.id).join(", ")
    });
    for (const p of doctor?.config ?? []) {
      nodes.push({
        label: p.id,
        icon: p.type === "mock" ? "law" : p.type === "api" ? "cloud" : "terminal",
        description: `${p.type}${p.roles?.length ? ` · ${p.roles.join("/")}` : ""}`
      });
    }
    this.nodes = nodes;
    this.emitter.fire(undefined);
  }

  getTreeItem(node: StatusNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label);
    item.iconPath = new vscode.ThemeIcon(node.icon);
    item.description = node.description;
    item.tooltip = node.tooltip;
    return item;
  }

  getChildren(): StatusNode[] {
    return this.nodes;
  }
}

export function findingDiagnostics(report: CouncilReport, cwd: string): Map<string, vscode.Diagnostic[]> {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  const sevMap: Record<Severity, vscode.DiagnosticSeverity> = {
    critical: vscode.DiagnosticSeverity.Error,
    high: vscode.DiagnosticSeverity.Error,
    medium: vscode.DiagnosticSeverity.Warning,
    low: vscode.DiagnosticSeverity.Information,
    info: vscode.DiagnosticSeverity.Hint
  };
  for (const f of report.findings) {
    if (!f.file) continue;
    const line = Math.max(0, (f.line ?? 1) - 1);
    const diag = new vscode.Diagnostic(
      new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
      `${f.severity.toUpperCase()} — ${f.body || f.title}`,
      sevMap[f.severity]
    );
    diag.source = "quorate";
    const target = path.isAbsolute(f.file) ? f.file : path.join(cwd, f.file);
    const list = byFile.get(target) ?? [];
    list.push(diag);
    byFile.set(target, list);
  }
  return byFile;
}
