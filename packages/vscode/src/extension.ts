import * as path from "node:path";
import * as vscode from "vscode";
import { cliVersion, runCli, runJson, runReview, type CouncilReport, type DoctorReport, type ProviderConfig } from "./cli";
import { diffSourceLabel, pickDiffSource, toReviewArgs, type DiffSource } from "./diff";
import { CouncilTree, findingDiagnostics, ResultsTree, StatusTree } from "./trees";

const MIN_CLI = "0.6.0";

/** The 15 built-in api presets (mirrors @quorate/core PROVIDER_PRESETS). */
const PRESETS: Array<{ name: string; model: string; local: boolean; keyEnv?: string }> = [
  { name: "ollama", model: "qwen2.5-coder:7b", local: true },
  { name: "lmstudio", model: "qwen2.5-coder-7b", local: true },
  { name: "vllm", model: "Qwen/Qwen2.5-Coder-7B-Instruct", local: true, keyEnv: "VLLM_API_KEY" },
  { name: "llamacpp", model: "local", local: true },
  { name: "hf-router", model: "Qwen/Qwen2.5-Coder-32B-Instruct:fastest", local: false, keyEnv: "HF_TOKEN" },
  { name: "openrouter", model: "anthropic/claude-sonnet-4.6", local: false, keyEnv: "OPENROUTER_API_KEY" },
  { name: "openai", model: "gpt-4o", local: false, keyEnv: "OPENAI_API_KEY" },
  { name: "tgi", model: "tgi", local: true },
  { name: "litellm", model: "gpt-4o", local: true, keyEnv: "LITELLM_API_KEY" },
  { name: "together", model: "Qwen/Qwen2.5-Coder-32B-Instruct", local: false, keyEnv: "TOGETHER_API_KEY" },
  { name: "groq", model: "llama-3.3-70b-versatile", local: false, keyEnv: "GROQ_API_KEY" },
  { name: "fireworks", model: "accounts/fireworks/models/qwen2p5-coder-32b-instruct", local: false, keyEnv: "FIREWORKS_API_KEY" },
  { name: "deepseek", model: "deepseek-chat", local: false, keyEnv: "DEEPSEEK_API_KEY" },
  { name: "mistral", model: "codestral-latest", local: false, keyEnv: "MISTRAL_API_KEY" },
  { name: "gemini", model: "gemini-2.0-flash", local: false, keyEnv: "GEMINI_API_KEY" }
];
const ROLES = ["architect", "security", "qa", "performance", "maintainer"];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const council = new CouncilTree();
  const results = new ResultsTree();
  const statusTree = new StatusTree();
  const diagnostics = vscode.languages.createDiagnosticCollection("quorate");

  vscode.window.registerTreeDataProvider("quorate.council", council);
  vscode.window.registerTreeDataProvider("quorate.results", results);
  vscode.window.registerTreeDataProvider("quorate.status", statusTree);

  const councilView = vscode.window.createTreeView("quorate.council", { treeDataProvider: council });

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = "$(law) Quorate";
  statusBar.command = "quorate.run";
  statusBar.tooltip = "Run the Quorate review council";
  statusBar.show();

  // ── State (persisted per-workspace) ──────────────────────────────
  let diffSource: DiffSource = context.workspaceState.get<DiffSource>("quorate.diffSource") ?? { kind: "working" };
  let enabled: Set<string> | null = null; // null = config default

  async function reload(): Promise<void> {
    const version = await cliVersion();
    const ready = version !== null;
    void vscode.commands.executeCommand("setContext", "quorate.cliReady", ready);
    void vscode.commands.executeCommand("setContext", "quorate.hasWorkspace", !!vscode.workspace.workspaceFolders?.length);
    if (version && cmpVersion(version, MIN_CLI) < 0) {
      void vscode.window.showWarningMessage(`Quorate CLI ${version} is older than ${MIN_CLI}. Run \`npm i -g quorate\` to update.`);
    }
    const providers = ready ? (await runJson<ProviderConfig[]>(["providers"])) ?? [] : [];
    void vscode.commands.executeCommand("setContext", "quorate.hasConfig", providers.length > 0);
    council.setData(providers, enabled, diffSourceLabel(diffSource));
    const doctor = ready ? await runJson<DoctorReport>(["doctor"]) : undefined;
    statusTree.setDoctor(doctor, version);
  }

  // ── Commands ─────────────────────────────────────────────────────
  context.subscriptions.push(
    diagnostics,
    statusBar,
    councilView,

    councilView.onDidChangeCheckboxState((e) => {
      // Start from the current effective set (materialize the config default once).
      const set = new Set<string>(enabled ?? council.defaultEnabledIds());
      for (const [node, state] of e.items) {
        if (node.kind !== "provider") continue;
        if (state === vscode.TreeItemCheckboxState.Checked) set.add(node.provider.id);
        else set.delete(node.provider.id);
      }
      enabled = set;
      council.updateEnabled(enabled);
    }),

    vscode.commands.registerCommand("quorate.run", () => runReviewCommand()),

    vscode.commands.registerCommand("quorate.pickDiffSource", async () => {
      const next = await pickDiffSource(diffSource);
      if (!next) return;
      diffSource = next;
      await context.workspaceState.update("quorate.diffSource", diffSource);
      const providers = (await runJson<ProviderConfig[]>(["providers"])) ?? [];
      council.setData(providers, enabled, diffSourceLabel(diffSource));
    }),

    vscode.commands.registerCommand("quorate.addProvider", async () => {
      await addProviderFlow();
      await reload();
    }),

    vscode.commands.registerCommand("quorate.removeProvider", async (node?: { provider?: ProviderConfig }) => {
      const id = node?.provider?.id ?? (await vscode.window.showInputBox({ title: "Provider id to remove" }));
      if (!id) return;
      await runCli(["provider", "remove", id]);
      await reload();
    }),

    vscode.commands.registerCommand("quorate.editRoles", async (node?: { provider?: ProviderConfig }) => {
      const provider = node?.provider;
      if (!provider) return;
      const picked = await vscode.window.showQuickPick(
        ROLES.map((role) => ({ label: role, picked: provider.roles?.includes(role) ?? false })),
        { title: `Roles for ${provider.id}`, canPickMany: true }
      );
      if (!picked) return;
      const roles = picked.map((p) => p.label).join(",");
      const args = ["provider", "add", provider.id, "--force", "--roles", roles, "--type", provider.type];
      if (provider.model) args.push("--model", provider.model);
      await runCli(args);
      await reload();
    }),

    vscode.commands.registerCommand("quorate.openFinding", async (file: string, line: number) => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      const uri = vscode.Uri.file(path.isAbsolute(file) ? file : path.join(cwd, file));
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }),

    vscode.commands.registerCommand("quorate.refresh", () => reload()),
    vscode.commands.registerCommand("quorate.runDoctor", () => reload()),
    vscode.commands.registerCommand("quorate.clearFindings", () => {
      diagnostics.clear();
      results.setReport(undefined);
      statusBar.text = "$(law) Quorate";
    }),
    vscode.commands.registerCommand("quorate.openConfig", async () => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!cwd) return;
      const uri = vscode.Uri.joinPath(cwd, ".quorate.yml");
      try {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
      } catch {
        void vscode.commands.executeCommand("quorate.init");
      }
    }),
    vscode.commands.registerCommand("quorate.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "quorate")
    ),
    vscode.commands.registerCommand("quorate.init", async () => {
      await runCli(["init"]);
      await reload();
      void vscode.window.showInformationMessage("Quorate: wrote a starter .quorate.yml (real providers disabled).");
    }),
    vscode.commands.registerCommand("quorate.installCli", () => {
      const term = vscode.window.createTerminal("Install Quorate");
      term.show();
      term.sendText("npm i -g quorate");
    })
  );

  // ── The review command ───────────────────────────────────────────
  async function runReviewCommand(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showErrorMessage("Quorate: open a folder before reviewing.");
      return;
    }
    const cwd = folder.uri.fsPath;
    let sourceArgs: string[];
    try {
      sourceArgs = await toReviewArgs(diffSource, cwd);
    } catch (err) {
      void vscode.window.showWarningMessage(`Quorate: ${(err as Error).message}`);
      return;
    }
    if (enabled) sourceArgs.push("--providers", [...enabled].join(","));

    diagnostics.clear();
    statusBar.text = "$(sync~spin) Quorate reviewing…";

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Quorate — convening the council…", cancellable: true },
      async (_p, token) => {
        const outcome = await runReview(sourceArgs, token);
        if (token.isCancellationRequested) {
          statusBar.text = "$(law) Quorate";
          return;
        }
        if (!outcome.report) {
          statusBar.text = "$(law) Quorate";
          void vscode.window.showWarningMessage(`Quorate: ${outcome.error}`);
          return;
        }
        applyReport(outcome.report, cwd);
      }
    );
  }

  function applyReport(report: CouncilReport, cwd: string): void {
    results.setReport(report);
    diagnostics.clear();
    for (const [file, diags] of findingDiagnostics(report, cwd)) {
      diagnostics.set(vscode.Uri.file(file), diags);
    }
    const v = report.verdict;
    statusBar.text = v === "fail" ? "$(error) Quorate FAIL" : v === "warn" ? "$(warning) Quorate WARN" : "$(check) Quorate PASS";
    void vscode.commands.executeCommand("quorate.results.focus");
  }

  async function addProviderFlow(): Promise<void> {
    const items = PRESETS.map((p) => ({
      label: `${p.local ? "$(vm)" : "$(cloud)"} ${p.name}`,
      description: p.model,
      detail: p.keyEnv ? `needs $${p.keyEnv}` : "no key required",
      preset: p
    }));
    const picked = await vscode.window.showQuickPick(items, { title: "Add provider — pick a preset", matchOnDetail: true });
    if (!picked) return;
    const preset = picked.preset;

    const id = await vscode.window.showInputBox({ title: "Provider id", value: preset.name });
    if (!id) return;
    const model = await vscode.window.showInputBox({ title: "Model", value: preset.model });
    if (model === undefined) return;
    const roles = await vscode.window.showQuickPick(
      ROLES.map((role) => ({ label: role, picked: ["qa", "maintainer"].includes(role) })),
      { title: "Roles for this provider", canPickMany: true }
    );
    if (!roles) return;

    const args = ["provider", "add", id, "--preset", preset.name, "--force"];
    if (model) args.push("--model", model);
    if (roles.length) args.push("--roles", roles.map((r) => r.label).join(","));
    const { code, stderr } = await runCli(args);
    if (code !== 0) {
      void vscode.window.showErrorMessage(`Quorate: provider add failed — ${stderr.trim().split("\n").pop()}`);
      return;
    }
    const note = preset.keyEnv ? ` Set $${preset.keyEnv} in your environment to use it.` : "";
    void vscode.window.showInformationMessage(`Quorate: added provider "${id}".${note}`);
  }

  await reload();
}

export function deactivate(): void {
  /* disposables handled via context.subscriptions */
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}
