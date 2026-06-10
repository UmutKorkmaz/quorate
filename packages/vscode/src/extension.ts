import * as vscode from "vscode";
import {
  cmpVersion,
  gitRoot,
  MIN_CLI,
  resolveCli,
  resolveFindingPath,
  runCli,
  runJson,
  runReviewStreaming,
  type CouncilReport,
  type DoctorReport,
  type ProviderConfig
} from "./cli";
import { diffSourceLabel, pickDiffSource, toReviewArgs, type DiffSource } from "./diff";
import { CouncilTree, findingDiagnostics, ResultsTree, StatusTree } from "./trees";

interface Preset {
  name: string;
  model: string;
  baseUrl: string;
  local: boolean;
  keyEnv?: string;
}
const PRESETS: Preset[] = [
  { name: "ollama", model: "qwen2.5-coder:7b", baseUrl: "http://localhost:11434/v1", local: true },
  { name: "lmstudio", model: "qwen2.5-coder-7b", baseUrl: "http://localhost:1234/v1", local: true },
  { name: "vllm", model: "Qwen/Qwen2.5-Coder-7B-Instruct", baseUrl: "http://localhost:8000/v1", local: true, keyEnv: "VLLM_API_KEY" },
  { name: "llamacpp", model: "local", baseUrl: "http://localhost:8080/v1", local: true },
  { name: "hf-router", model: "Qwen/Qwen2.5-Coder-32B-Instruct:fastest", baseUrl: "https://router.huggingface.co/v1", local: false, keyEnv: "HF_TOKEN" },
  { name: "openrouter", model: "anthropic/claude-sonnet-4.6", baseUrl: "https://openrouter.ai/api/v1", local: false, keyEnv: "OPENROUTER_API_KEY" },
  { name: "openai", model: "gpt-4o", baseUrl: "https://api.openai.com/v1", local: false, keyEnv: "OPENAI_API_KEY" },
  { name: "tgi", model: "tgi", baseUrl: "http://localhost:8080/v1", local: true },
  { name: "litellm", model: "gpt-4o", baseUrl: "http://localhost:4000/v1", local: true, keyEnv: "LITELLM_API_KEY" },
  { name: "together", model: "Qwen/Qwen2.5-Coder-32B-Instruct", baseUrl: "https://api.together.ai/v1", local: false, keyEnv: "TOGETHER_API_KEY" },
  { name: "groq", model: "llama-3.3-70b-versatile", baseUrl: "https://api.groq.com/openai/v1", local: false, keyEnv: "GROQ_API_KEY" },
  { name: "fireworks", model: "accounts/fireworks/models/qwen2p5-coder-32b-instruct", baseUrl: "https://api.fireworks.ai/inference/v1", local: false, keyEnv: "FIREWORKS_API_KEY" },
  { name: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com", local: false, keyEnv: "DEEPSEEK_API_KEY" },
  { name: "mistral", model: "codestral-latest", baseUrl: "https://api.mistral.ai/v1", local: false, keyEnv: "MISTRAL_API_KEY" },
  { name: "gemini", model: "gemini-2.0-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", local: false, keyEnv: "GEMINI_API_KEY" }
];

/** Fetch model ids from an OpenAI-compatible `{baseUrl}/models` (or Ollama's /api/tags). */
async function fetchModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; name?: string }> };
    const ids = Array.isArray(json.data)
      ? json.data.map((m) => m.id)
      : Array.isArray(json.models)
        ? json.models.map((m) => m.id ?? m.name)
        : [];
    return ids.filter((x): x is string => typeof x === "string").sort();
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
const ROLES = ["architect", "security", "qa", "performance", "maintainer"];
const secretKey = (env: string): string => `quorate.key.${env}`;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const council = new CouncilTree();
  const results = new ResultsTree();
  const statusTree = new StatusTree();
  const diagnostics = vscode.languages.createDiagnosticCollection("quorate");

  vscode.window.registerTreeDataProvider("quorate.results", results);
  vscode.window.registerTreeDataProvider("quorate.status", statusTree);
  const councilView = vscode.window.createTreeView("quorate.council", { treeDataProvider: council });

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = "$(law) Quorate";
  statusBar.command = "quorate.run";
  statusBar.tooltip = "Run the Quorate review council";
  statusBar.show();

  let diffSource: DiffSource = context.workspaceState.get<DiffSource>("quorate.diffSource") ?? { kind: "working" };
  let enabled: Set<string> | null = null;
  // Bases for resolving finding paths: git repo root first (diff paths are relative
  // to it), then the workspace folder. Set when a review runs.
  let reviewBases: string[] = [];
  // One OutputChannel per reviewer lane (claude:security, …) — the "get into the
  // terminal" view. Click a lane row in Results to open its live stream.
  const laneChannels = new Map<string, vscode.OutputChannel>();

  function laneChannel(key: string): vscode.OutputChannel {
    let channel = laneChannels.get(key);
    if (!channel) {
      channel = vscode.window.createOutputChannel(`Quorate · ${key}`);
      laneChannels.set(key, channel);
      context.subscriptions.push(channel);
    }
    return channel;
  }

  const setContext = (key: string, value: boolean): void => void vscode.commands.executeCommand("setContext", key, value);

  async function listProviders(): Promise<ProviderConfig[]> {
    return (await runJson<ProviderConfig[]>(["providers"])) ?? [];
  }

  async function reload(): Promise<void> {
    const { path: cliResolved, version } = await resolveCli(true);
    const ready = version !== null;
    setContext("quorate.cliReady", ready);
    setContext("quorate.hasWorkspace", !!vscode.workspace.workspaceFolders?.length);
    if (version && cmpVersion(version, MIN_CLI) < 0) {
      void vscode.window.showWarningMessage(
        `Quorate CLI ${version} (${cliResolved}) is older than ${MIN_CLI}. Run \`npm i -g quorate\`, or set quorate.cliPath to a 0.6.0 binary.`
      );
    }
    const providers = ready ? await listProviders() : [];
    setContext("quorate.hasConfig", providers.length > 0);
    const doctor = ready ? await runJson<DoctorReport>(["doctor"]) : undefined;
    const detected = new Map((doctor?.detected ?? []).map((d) => [d.id, { available: d.available }]));
    council.setData(providers, enabled, diffSourceLabel(diffSource), detected);
    statusTree.setDoctor(doctor, version);
  }

  /** process.env plus any keychain-stored API keys whose env var isn't already set. */
  async function buildEnv(): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const p of await listProviders()) {
      if (p.type === "api" && p.apiKeyEnv && !env[p.apiKeyEnv]) {
        const secret = await context.secrets.get(secretKey(p.apiKeyEnv));
        if (secret) env[p.apiKeyEnv] = secret;
      }
    }
    return env;
  }

  function applyReport(report: CouncilReport, bases: string[]): void {
    results.setReport(report);
    diagnostics.clear();
    for (const [file, diags] of findingDiagnostics(report, bases)) diagnostics.set(vscode.Uri.file(file), diags);
    const v = report.verdict;
    statusBar.text = v === "fail" ? "$(error) Quorate FAIL" : v === "warn" ? "$(warning) Quorate WARN" : "$(check) Quorate PASS";
  }

  async function runReviewCommand(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showErrorMessage("Quorate: open a folder before reviewing.");
      return;
    }
    const cwd = folder.uri.fsPath;
    reviewBases = [await gitRoot(cwd), cwd];
    let sourceArgs: string[];
    try {
      sourceArgs = await toReviewArgs(diffSource, cwd);
    } catch (err) {
      void vscode.window.showWarningMessage(`Quorate: ${(err as Error).message}`);
      return;
    }
    if (enabled) sourceArgs.push("--providers", [...enabled].join(","));
    const env = await buildEnv();

    diagnostics.clear();
    statusBar.text = "$(sync~spin) Quorate reviewing…";
    results.beginRun();
    void vscode.commands.executeCommand("quorate.results.focus");

    for (const channel of laneChannels.values()) channel.clear();

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Quorate — convening the council…", cancellable: true },
      async (_p, token) => {
        const outcome = await runReviewStreaming(
          sourceArgs,
          (e) => {
            results.applyEvent(e);
            if (!e.providerId || !e.role) return;
            const key = `${e.providerId}:${e.role}`;
            if (e.type === "provider/started") {
              laneChannel(key).appendLine(`── ${key} started ─────────────────────────`);
            } else if (e.type === "provider/chunk" && e.text) {
              laneChannel(key).append(e.text);
            } else if (e.type === "provider/done") {
              const status = e.result?.status ?? "done";
              laneChannel(key).appendLine(`\n── ${key} ${status} (${e.result?.findings.length ?? 0} findings) ──`);
            }
          },
          token,
          env
        );
        if (token.isCancellationRequested) {
          statusBar.text = "$(law) Quorate";
          results.setReport(undefined);
          return;
        }
        if (!outcome.report) {
          statusBar.text = "$(law) Quorate";
          results.setReport(undefined);
          const msg = outcome.stale
            ? "Your quorate CLI looks outdated — run `npm i -g quorate`, or set quorate.cliPath to a 0.6.0 binary (e.g. ~/.local/bin/quorate)."
            : outcome.error;
          void vscode.window.showWarningMessage(`Quorate: ${msg}`);
          return;
        }
        applyReport(outcome.report, reviewBases);
      }
    );
  }

  async function setKey(keyEnv?: string): Promise<void> {
    if (!keyEnv) {
      const envs = [...new Set((await listProviders()).filter((p) => p.type === "api" && p.apiKeyEnv).map((p) => p.apiKeyEnv!))];
      keyEnv = await vscode.window.showQuickPick(envs, { title: "Which API key env var?" });
    }
    if (!keyEnv) return;
    const value = await vscode.window.showInputBox({
      title: `Set ${keyEnv}`,
      password: true,
      prompt: "Stored in the OS keychain and injected at review time — never written to .quorate.yml."
    });
    if (value === undefined) return;
    if (value) await context.secrets.store(secretKey(keyEnv), value);
    else await context.secrets.delete(secretKey(keyEnv));
    void vscode.window.showInformationMessage(`Quorate: ${value ? "stored" : "cleared"} ${keyEnv}.`);
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

    // Resolve a key (env or keychain) so the model list can be fetched for hosted providers.
    let key: string | undefined;
    if (preset.keyEnv) {
      key = process.env[preset.keyEnv] || (await context.secrets.get(secretKey(preset.keyEnv))) || undefined;
      if (!key) {
        const entered = await vscode.window.showInputBox({
          title: `$${preset.keyEnv} (optional — to list models)`,
          password: true,
          prompt: "Stored in the OS keychain. Leave blank to type the model name instead."
        });
        if (entered) {
          key = entered;
          await context.secrets.store(secretKey(preset.keyEnv), entered);
        }
      }
    }

    // Live model list (OpenAI-compatible /models), with a free-text fallback.
    const models = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Quorate — fetching ${preset.name} models…` },
      () => fetchModels(preset.baseUrl, key)
    );
    let model: string | undefined;
    if (models.length) {
      const pick = await vscode.window.showQuickPick(
        [...models.map((m) => ({ label: m, custom: false })), { label: "$(edit) Enter a custom model…", custom: true }],
        { title: `Model for ${id} — ${models.length} available`, matchOnDescription: true }
      );
      if (!pick) return;
      model = pick.custom ? await vscode.window.showInputBox({ title: "Model", value: preset.model }) : pick.label;
    } else {
      model = await vscode.window.showInputBox({
        title: `Model for ${id}`,
        value: preset.model,
        prompt: `Couldn't reach ${preset.baseUrl}/models — type the model name`
      });
    }
    if (!model) return;

    const roles = await vscode.window.showQuickPick(
      ROLES.map((role) => ({ label: role, picked: ["qa", "maintainer"].includes(role) })),
      { title: "Roles for this provider", canPickMany: true }
    );
    if (!roles) return;

    const args = ["provider", "add", id, "--preset", preset.name, "--force", "--model", model];
    if (roles.length) args.push("--roles", roles.map((r) => r.label).join(","));
    const { code, stderr } = await runCli(args);
    if (code !== 0) {
      void vscode.window.showErrorMessage(`Quorate: provider add failed — ${stderr.trim().split("\n").pop()}`);
      return;
    }
    const stillMissing =
      preset.keyEnv && !(process.env[preset.keyEnv] || (await context.secrets.get(secretKey(preset.keyEnv))));
    void vscode.window.showInformationMessage(
      `Quorate: added "${id}" (${model}).${stillMissing ? ` Set $${preset.keyEnv} to use it.` : ""}`
    );
  }

  context.subscriptions.push(
    diagnostics,
    statusBar,
    councilView,

    councilView.onDidChangeCheckboxState((e) => {
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
    vscode.commands.registerCommand("quorate.refresh", () => reload()),
    vscode.commands.registerCommand("quorate.runDoctor", () => reload()),
    vscode.commands.registerCommand("quorate.addProvider", async () => {
      await addProviderFlow();
      await reload();
    }),
    vscode.commands.registerCommand("quorate.setKey", (node?: { provider?: ProviderConfig }) => setKey(node?.provider?.apiKeyEnv)),
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
      if (!roles) {
        void vscode.window.showWarningMessage("Quorate: pick at least one role (a provider with no roles never runs).");
        return;
      }
      // set-roles edits ONLY the roles field — never round-trips the full
      // provider through `provider add` (which could mangle exotic cli args).
      const { code, stderr } = await runCli(["provider", "set-roles", provider.id, roles]);
      if (code !== 0) {
        const reason = stderr.trim().split("\n").filter(Boolean).pop() ?? "unknown error";
        const message = /unknown command/i.test(stderr)
          ? "Quorate: editing roles needs quorate >= 0.7.2 — run `npm i -g quorate`."
          : `Quorate: updating roles failed — ${reason}`;
        void vscode.window.showErrorMessage(message);
        return;
      }
      await reload();
    }),
    vscode.commands.registerCommand("quorate.pickDiffSource", async () => {
      const next = await pickDiffSource(diffSource);
      if (!next) return;
      diffSource = next;
      await context.workspaceState.update("quorate.diffSource", diffSource);
      council.setData(await listProviders(), enabled, diffSourceLabel(diffSource));
    }),
    vscode.commands.registerCommand("quorate.openFinding", async (file: string, line: number) => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      const bases = reviewBases.length ? reviewBases : [cwd];
      const uri = vscode.Uri.file(resolveFindingPath(file, bases));
      const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }),
    vscode.commands.registerCommand("quorate.openLane", (key: string) => {
      laneChannel(key).show(true);
    }),
    vscode.commands.registerCommand("quorate.clearFindings", () => {
      diagnostics.clear();
      results.setReport(undefined);
      statusBar.text = "$(law) Quorate";
    }),
    vscode.commands.registerCommand("quorate.openConfig", async () => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!cwd) return;
      try {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(cwd, ".quorate.yml")));
      } catch {
        void vscode.commands.executeCommand("quorate.init");
      }
    }),
    vscode.commands.registerCommand("quorate.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", "quorate")),
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

  await reload();
}

export function deactivate(): void {
  /* disposables handled via context.subscriptions */
}
