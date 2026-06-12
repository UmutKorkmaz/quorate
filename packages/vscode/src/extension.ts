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
import { FindingDecorations, findingHover } from "./decorations";
import { VerdictPanel } from "./verdict-panel";

interface Preset {
  name: string;
  model: string;
  baseUrl: string;
  local?: boolean;
  keyEnv?: string;
  roles?: string[];
}
interface PackCatalogItem {
  id: string;
  description?: string;
  councils?: string[];
  classes?: number;
}
interface UrlClassification {
  baseUrl?: string;
  local?: boolean;
}

const DEFAULT_ROLES = ["architect", "security", "qa", "performance", "maintainer"];
// Compatibility fallback for old or missing CLIs; the live CLI catalog is used
// whenever available.
const FALLBACK_PRESETS: Preset[] = [
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
  { name: "gemini", model: "gemini-2.0-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", local: false, keyEnv: "GEMINI_API_KEY" },
  { name: "zai", model: "glm-5.1", baseUrl: "https://api.z.ai/api/coding/paas/v4", local: false, keyEnv: "ZAI_API_KEY" }
];
const FALLBACK_PACKS: PackCatalogItem[] = [
  { id: "solana", description: "Solana / Anchor security review council" },
  { id: "evm", description: "EVM / Solidity security review council" },
  { id: "iac", description: "Infrastructure-as-Code security review council" },
  { id: "llm", description: "AI / LLM application security review council" },
  { id: "move", description: "Move smart-contract security review council" },
  { id: "ci", description: "CI/CD and supply-chain security review council" },
  { id: "fintech", description: "Fintech / PCI-DSS payment security review council" },
  { id: "web", description: "Web & API security review council" },
  { id: "healthcare", description: "Healthcare / HIPAA security review council" },
  { id: "mobile", description: "Mobile app security review council" },
  { id: "accessibility", description: "Web/app accessibility review council" },
  { id: "data-sql", description: "Data engineering and SQL pipeline safety review council" },
  { id: "k8s", description: "Kubernetes workload hardening review council" },
  { id: "privacy", description: "Data-protection and privacy lifecycle review council" },
  { id: "mlops", description: "ML training and model-lifecycle safety review council" },
  { id: "embedded", description: "Embedded C/C++ firmware safety review council" },
  { id: "performance", description: "Performance, scalability and reliability review council" },
  { id: "graphql", description: "GraphQL API security and design review council" }
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter((entry): entry is string => Boolean(entry)) : [];
}

function uniqueStrings(values: string[], fallback: string[] = []): string[] {
  const out = [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
  return out.length ? out : fallback;
}

function normalizePreset(value: unknown, nameHint?: string): Preset | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const name = asString(raw.name) ?? asString(raw.id) ?? nameHint;
  const model = asString(raw.model);
  const baseUrl = asString(raw.baseUrl) ?? asString(raw.baseURL) ?? asString(raw.url);
  if (!name || !model || !baseUrl) return undefined;
  const keyEnv = asString(raw.keyEnv) ?? asString(raw.apiKeyEnv);
  return {
    name,
    model,
    baseUrl,
    keyEnv,
    local: typeof raw.local === "boolean" ? raw.local : false,
    roles: stringList(raw.roles)
  };
}

function normalizePresetCatalog(value: unknown): Preset[] {
  if (Array.isArray(value)) return value.map((entry) => normalizePreset(entry)).filter((entry): entry is Preset => Boolean(entry));
  const raw = asRecord(value);
  if (!raw) return [];
  if (Array.isArray(raw.presets)) return normalizePresetCatalog(raw.presets);
  return Object.entries(raw)
    .map(([name, entry]) => normalizePreset(entry, name))
    .filter((entry): entry is Preset => Boolean(entry));
}

function normalizePack(value: unknown, idHint?: string): PackCatalogItem | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const id = asString(raw.id) ?? idHint;
  if (!id) return undefined;
  return {
    id,
    description: asString(raw.description),
    councils: stringList(raw.councils),
    classes: typeof raw.classes === "number" ? raw.classes : undefined
  };
}

function normalizePackCatalog(value: unknown): PackCatalogItem[] {
  if (Array.isArray(value)) return value.map((entry) => normalizePack(entry)).filter((entry): entry is PackCatalogItem => Boolean(entry));
  const raw = asRecord(value);
  if (!raw) return [];
  if (Array.isArray(raw.packs)) return normalizePackCatalog(raw.packs);
  return Object.entries(raw)
    .map(([id, entry]) => normalizePack(entry, id))
    .filter((entry): entry is PackCatalogItem => Boolean(entry));
}

function envNameFromId(id: string): string {
  const normalized = id.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${normalized || "CUSTOM"}_API_KEY`;
}

function parseJsonOutput<T>(stdout: string): T | undefined {
  try {
    return JSON.parse(stdout.trim()) as T;
  } catch {
    const last = stdout.split("\n").map((line) => line.trim()).filter(Boolean).pop();
    if (!last) return undefined;
    try {
      return JSON.parse(last) as T;
    } catch {
      return undefined;
    }
  }
}

function normalizeModelList(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value.map(asString).filter((entry): entry is string => Boolean(entry))).sort();
  const raw = asRecord(value);
  if (!raw) return [];
  const models = stringList(raw.models);
  if (models.length) return models.sort();
  if (Array.isArray(raw.data)) {
    return uniqueStrings(
      raw.data.map((entry) => {
        const item = asRecord(entry);
        return item ? asString(item.id) ?? asString(item.name) : undefined;
      }).filter((entry): entry is string => Boolean(entry))
    ).sort();
  }
  return [];
}

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
const secretKey = (env: string): string => `quorate.key.${env}`;

function messageTail(stderr: string, fallback = "unknown error"): string {
  const tail = stderr.trim().split("\n").filter(Boolean).pop() ?? fallback;
  return tail
    .replace(/\b(?:sk|sk-ant|AIza|pk_|key-|tkn_|ghp_|github_pat_|glpat-|xox[baprs]-|hf_)[A-Za-z0-9._-]{8,}\b/g, "[redacted]")
    .replace(/\b[A-Z_][A-Z0-9_]*=(["'])?[^"'\s]+(["'])?/g, (match) => {
      const name = match.split("=")[0];
      return /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name) ? `${name}=[redacted]` : match;
    });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const council = new CouncilTree();
  const results = new ResultsTree();
  const statusTree = new StatusTree();
  const diagnostics = vscode.languages.createDiagnosticCollection("quorate");
  const decorations = new FindingDecorations(context.extensionUri);
  context.subscriptions.push({ dispose: () => decorations.dispose() });
  // Re-apply gutter decorations whenever the set of visible editors changes.
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((e) => decorations.applyTo(e)))
  );

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

  let providerPresetCache: Preset[] | undefined;
  let packCatalogCache: PackCatalogItem[] | undefined;
  let councilRoleCache: string[] | undefined;

  async function listProviders(): Promise<ProviderConfig[]> {
    return (await runJson<ProviderConfig[]>(["providers"])) ?? [];
  }

  async function runJsonWithEnv<T>(args: string[], env?: NodeJS.ProcessEnv): Promise<T | undefined> {
    try {
      const { stdout } = await runCli([...args, "--json"], { env });
      return parseJsonOutput<T>(stdout);
    } catch {
      return undefined;
    }
  }

  async function listProviderPresets(): Promise<Preset[]> {
    if (providerPresetCache) return providerPresetCache;
    const fromJson = normalizePresetCatalog(await runJson<unknown>(["provider", "presets"]));
    providerPresetCache = fromJson.length ? fromJson : FALLBACK_PRESETS;
    return providerPresetCache;
  }

  async function listPacks(): Promise<PackCatalogItem[]> {
    if (packCatalogCache) return packCatalogCache;
    const fromJson = normalizePackCatalog(await runJson<unknown>(["packs"]));
    packCatalogCache = fromJson.length ? fromJson : FALLBACK_PACKS;
    return packCatalogCache;
  }

  async function listCouncilRoles(): Promise<string[]> {
    if (councilRoleCache) return councilRoleCache;
    councilRoleCache = uniqueStrings(stringList(await runJson<unknown>(["roles"])), DEFAULT_ROLES);
    return councilRoleCache;
  }

  async function isLocalProviderBaseUrl(baseUrl: string): Promise<boolean> {
    return (await runJson<UrlClassification>(["provider", "classify-url", baseUrl]))?.local ?? false;
  }

  async function reload(): Promise<void> {
    providerPresetCache = undefined;
    packCatalogCache = undefined;
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
    councilRoleCache = uniqueStrings((doctor?.config as { councils?: string[] } | undefined)?.councils ?? [], DEFAULT_ROLES);
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

  async function promptForSecret(keyEnv: string, title: string): Promise<string | undefined> {
    const existing = process.env[keyEnv] || (await context.secrets.get(secretKey(keyEnv))) || undefined;
    if (existing) return existing;
    const entered = await vscode.window.showInputBox({
      title,
      password: true,
      prompt: "Stored in the OS keychain and injected at review time. Leave blank to use your shell environment."
    });
    if (entered) {
      await context.secrets.store(secretKey(keyEnv), entered);
      return entered;
    }
    return undefined;
  }

  async function modelsForPreset(preset: Preset, apiKey?: string): Promise<string[]> {
    const fromHttp = await fetchModels(preset.baseUrl, apiKey);
    if (fromHttp.length) return fromHttp;
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (preset.keyEnv && apiKey) env[preset.keyEnv] = apiKey;
    return normalizeModelList(await runJsonWithEnv<unknown>(["provider", "models", preset.name], env));
  }

  async function pickModel(title: string, fallback: string, models: string[]): Promise<string | undefined> {
    if (models.length) {
      const pick = await vscode.window.showQuickPick(
        [...models.map((model) => ({ label: model, custom: false })), { label: "$(edit) Enter a custom model…", custom: true }],
        { title: `${title} — ${models.length} available`, matchOnDescription: true }
      );
      if (!pick) return undefined;
      return pick.custom ? vscode.window.showInputBox({ title, value: fallback }) : pick.label;
    }
    return vscode.window.showInputBox({
      title,
      value: fallback,
      prompt: "Couldn't list models automatically. Type the model name."
    });
  }

  async function pickRoles(preferred: string[] = []): Promise<string[] | undefined> {
    const roles = await listCouncilRoles();
    if (!roles.length) return undefined;
    const roleSet = new Set(roles);
    const preferredInConfig = preferred.filter((role) => roleSet.has(role));
    const defaults = new Set(preferredInConfig.length ? preferredInConfig : [roles[0]]);
    const picked = await vscode.window.showQuickPick(
      roles.map((role, index) => ({ label: role, picked: defaults.size ? defaults.has(role) : index === 0 })),
      { title: "Roles for this provider", canPickMany: true }
    );
    return picked?.map((role) => role.label);
  }

  let lastReport: CouncilReport | undefined;

  /** Findings the CLI's `fix --finding <n>` can target, in its exact 1-based order. */
  function fixableFindings(): CouncilReport["findings"] {
    return (lastReport?.findings ?? []).filter((f) => f.file);
  }

  /** Open (or reuse) the Quorate Fix terminal and run the interactive fix flow. */
  async function openFixTerminal(findingIndex?: number): Promise<void> {
    const { path: cli } = await resolveCli();
    const existing = vscode.window.terminals.find((t) => t.name === "Quorate Fix" && t.exitStatus === undefined);
    const terminal = existing ?? vscode.window.createTerminal({ name: "Quorate Fix" });
    terminal.show();
    const quoted = cli.includes(" ") ? `"${cli}"` : cli;
    terminal.sendText(`${quoted} fix${findingIndex ? ` --finding ${findingIndex}` : " --list"}`);
  }

  function applyReport(report: CouncilReport, bases: string[]): void {
    lastReport = report;
    results.setReport(report);
    diagnostics.clear();
    for (const [file, diags] of findingDiagnostics(report, bases)) diagnostics.set(vscode.Uri.file(file), diags);
    decorations.setReport(report, bases);
    decorations.refresh();
    const v = report.verdict;
    const counts = report.findings.length;
    statusBar.text =
      (v === "fail" ? "$(error) Quorate FAIL" : v === "warn" ? "$(warning) Quorate WARN" : "$(check) Quorate PASS") +
      (counts ? ` · ${counts}` : "");
    statusBar.command = "quorate.openVerdict";
    VerdictPanel.instance.show(report, context.extensionUri);
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
    const presets = await listProviderPresets();
    const items: Array<vscode.QuickPickItem & { itemType?: "custom" | "preset"; preset?: Preset }> = [
      {
        label: "$(edit) Custom OpenAI-compatible provider…",
        detail: "Choose any provider id, model, base URL, API-key env var, and optional stored token.",
        itemType: "custom"
      },
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      ...presets.map((preset) => ({
        label: `${preset.local ? "$(vm)" : "$(cloud)"} ${preset.name}`,
        description: preset.model,
        detail: preset.keyEnv ? `${preset.baseUrl} · uses $${preset.keyEnv}` : preset.baseUrl,
        itemType: "preset" as const,
        preset
      }))
    ];
    const picked = await vscode.window.showQuickPick(items, { title: "Add provider", matchOnDetail: true });
    if (!picked) return;
    if (picked.itemType === "custom") {
      await addCustomProviderFlow();
      return;
    }
    const preset = picked.preset;
    if (!preset) return;

    const id = await vscode.window.showInputBox({ title: "Provider id", value: preset.name });
    if (!id) return;

    // Resolve a key (env or keychain) so the model list can be fetched for hosted providers.
    let key: string | undefined;
    if (preset.keyEnv) {
      key = await promptForSecret(preset.keyEnv, `$${preset.keyEnv} (optional — to list models)`);
    }

    // Live model list (OpenAI-compatible /models), with a free-text fallback.
    const models = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Quorate — fetching ${preset.name} models…` },
      () => modelsForPreset(preset, key)
    );
    const model = await pickModel(`Model for ${id}`, preset.model, models);
    if (!model) return;

    const roles = await pickRoles(preset.roles);
    if (!roles) return;
    if (roles.length === 0) {
      void vscode.window.showWarningMessage("Quorate: pick at least one role (a provider with no roles never runs).");
      return;
    }

    const args = ["provider", "add", id, "--preset", preset.name, "--force", "--model", model, "--no-pick", "--roles", roles.join(",")];
    const { code, stderr } = await runCli(args);
    if (code !== 0) {
      void vscode.window.showErrorMessage(`Quorate: provider add failed — ${messageTail(stderr)}`);
      return;
    }
    const stillMissing =
      preset.keyEnv && !(process.env[preset.keyEnv] || (await context.secrets.get(secretKey(preset.keyEnv))));
    void vscode.window.showInformationMessage(
      `Quorate: added "${id}" (${model}).${stillMissing ? ` Set $${preset.keyEnv} to use it.` : ""}`
    );
  }

  async function addCustomProviderFlow(): Promise<void> {
    const id = await vscode.window.showInputBox({
      title: "Provider id",
      placeHolder: "my-provider",
      validateInput: (value) =>
        /^[a-z0-9][a-z0-9_-]*$/i.test(value.trim()) ? undefined : "Start with a letter or digit; use letters, digits, dashes, or underscores."
    });
    if (!id) return;

    const baseUrl = await vscode.window.showInputBox({
      title: "OpenAI-compatible base URL",
      placeHolder: "https://api.example.com/v1",
      validateInput: (value) => {
        try {
          const url = new URL(value.trim());
          return url.protocol === "http:" || url.protocol === "https:" ? undefined : "Use an http:// or https:// URL.";
        } catch {
          return "Enter a valid http:// or https:// URL.";
        }
      }
    });
    if (!baseUrl) return;
    const baseUrlIsLocal = await isLocalProviderBaseUrl(baseUrl);

    const apiKeyEnvInput = await vscode.window.showInputBox({
      title: "API key env var",
      value: baseUrlIsLocal ? "" : envNameFromId(id),
      prompt: "Leave blank for local providers or endpoints that do not require a bearer token.",
      validateInput: (value) => {
        const trimmed = value.trim();
        return !trimmed || /^[A-Z_][A-Z0-9_]*$/.test(trimmed) ? undefined : "Use an environment variable name like MY_PROVIDER_API_KEY.";
      }
    });
    if (apiKeyEnvInput === undefined) return;
    const apiKeyEnv = apiKeyEnvInput.trim() || undefined;
    const key = apiKeyEnv ? await promptForSecret(apiKeyEnv, `$${apiKeyEnv} token secret (optional)`) : undefined;

    const models = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Quorate — fetching ${id} models…` },
      () => fetchModels(baseUrl, key)
    );
    const model = await pickModel(`Model for ${id}`, "", models);
    if (!model) return;

    const roles = await pickRoles();
    if (!roles) return;
    if (roles.length === 0) {
      void vscode.window.showWarningMessage("Quorate: pick at least one role (a provider with no roles never runs).");
      return;
    }

    const args = ["provider", "add", id, "--type", "api", "--base-url", baseUrl, "--model", model, "--force", "--no-pick"];
    if (apiKeyEnv) args.push("--api-key-env", apiKeyEnv);
    if (roles.length) args.push("--roles", roles.join(","));
    const { code, stderr } = await runCli(args);
    if (code !== 0) {
      void vscode.window.showErrorMessage(`Quorate: provider add failed — ${messageTail(stderr)}`);
      return;
    }
    const stillMissing = apiKeyEnv && !(process.env[apiKeyEnv] || (await context.secrets.get(secretKey(apiKeyEnv))));
    void vscode.window.showInformationMessage(
      `Quorate: added "${id}" (${model}).${stillMissing ? ` Set $${apiKeyEnv} to use it.` : ""}`
    );
  }

  context.subscriptions.push(
    diagnostics,
    statusBar,
    councilView,
    { dispose: () => VerdictPanel.instance.dispose() },

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
    vscode.commands.registerCommand("quorate.openVerdict", () => {
      if (!lastReport) {
        void vscode.window.showInformationMessage("Quorate: no review results yet — run a review first.");
        return;
      }
      VerdictPanel.instance.show(lastReport, context.extensionUri);
    }),
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
      const roles = await listCouncilRoles();
      const providerRoles = new Set(provider.roles ?? []);
      const picked = await vscode.window.showQuickPick(
        roles.map((role) => ({ label: role, picked: providerRoles.has(role) })),
        { title: `Roles for ${provider.id}`, canPickMany: true }
      );
      if (!picked) return;
      const nextRoles = picked.map((p) => p.label).join(",");
      if (!nextRoles) {
        void vscode.window.showWarningMessage("Quorate: pick at least one role (a provider with no roles never runs).");
        return;
      }
      // set-roles edits ONLY the roles field — never round-trips the full
      // provider through `provider add` (which could mangle exotic cli args).
      const { code, stderr } = await runCli(["provider", "set-roles", provider.id, nextRoles]);
      if (code !== 0) {
        const reason = messageTail(stderr);
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

    // Insert an inline `// quorate-ignore` on a finding's line (the suppression
    // escape hatch the CLI honors). Uses the line's existing comment leader.
    vscode.commands.registerCommand("quorate.suppressFinding", async (uriStr: string, line: number) => {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriStr));
      const editor = await vscode.window.showTextDocument(doc);
      const text = doc.lineAt(line).text;
      if (/quorate-(ignore|disable)/.test(text)) return; // already suppressed
      const leader = /\.(py|rb|sh|yml|yaml|tf)$/.test(doc.fileName) ? "#" : "//";
      await editor.edit((b) => b.insert(new vscode.Position(line, doc.lineAt(line).text.length), `  ${leader} quorate-ignore`));
      const diags = diagnostics.get(doc.uri)?.filter((d) => d.range.start.line !== line) ?? [];
      diagnostics.set(doc.uri, diags);
    }),

    // Scaffold a domain pack: auto-detect the repo's stack, or pick packs.
    vscode.commands.registerCommand("quorate.setupPack", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showErrorMessage("Quorate: open a folder first.");
        return;
      }
      const AUTO = "$(wand) Auto-detect from this repo";
      const packs = await listPacks();
      const items: vscode.QuickPickItem[] = [
        { label: AUTO, detail: "quorate init --auto — scaffold the packs matching your files" },
        { label: "", kind: vscode.QuickPickItemKind.Separator },
        ...packs.map((pack) => ({
          label: pack.id,
          description: pack.classes ? `${pack.classes} classes` : "domain pack",
          detail: pack.description ?? (pack.councils?.length ? `Councils: ${pack.councils.join(", ")}` : undefined)
        }))
      ];
      const picked = await vscode.window.showQuickPick(items, {
        title: "Quorate — set up a domain pack",
        canPickMany: false,
        placeHolder: "Auto-detect, or pick a pack (re-run to add more)"
      });
      if (!picked) return;
      const configUri = vscode.Uri.joinPath(folder.uri, ".quorate.yml");
      let configExists = true;
      try {
        await vscode.workspace.fs.stat(configUri);
      } catch {
        configExists = false;
      }
      if (configExists) {
        const ok = await vscode.window.showWarningMessage(
          "Quorate: this overwrites the existing .quorate.yml. Continue?",
          { modal: true },
          "Overwrite"
        );
        if (ok !== "Overwrite") return;
      }
      const args = picked.label === AUTO ? ["init", "--auto", "--force"] : ["init", "--pack", picked.label, "--force"];
      const { code, stdout, stderr } = await runCli(args);
      if (code !== 0) {
        void vscode.window.showErrorMessage(`Quorate: ${messageTail(stderr, "pack setup failed")}`);
        return;
      }
      await reload();
      void vscode.window.showInformationMessage(`Quorate: ${stdout.trim().split("\n").pop() ?? "pack scaffolded."}`);
    }),

    // Fix a finding: from the lightbulb (number), a Results row (node), or the
    // palette (QuickPick). The agent runs interactively in the integrated
    // terminal — snapshotted by the CLI, revertible via quorate.revertFix.
    vscode.commands.registerCommand("quorate.fixFinding", async (arg?: number | { finding?: { file?: string } }) => {
      if (typeof arg === "number") {
        await openFixTerminal(arg);
        return;
      }
      const fixable = fixableFindings();
      if (arg && typeof arg === "object" && arg.finding) {
        const index = fixable.indexOf(arg.finding as CouncilReport["findings"][number]);
        await openFixTerminal(index >= 0 ? index + 1 : undefined);
        return;
      }
      if (fixable.length === 0) {
        await openFixTerminal(); // falls back to `quorate fix --list` in the terminal
        return;
      }
      const picked = await vscode.window.showQuickPick(
        fixable.map((f, i) => ({
          label: `$(wrench) ${f.title}`,
          description: `${f.severity} · ${f.file}${f.line ? `:${f.line}` : ""}`,
          index: i + 1
        })),
        { title: "Quorate — fix which finding?" }
      );
      if (picked) await openFixTerminal(picked.index);
    }),

    vscode.commands.registerCommand("quorate.revertFix", async () => {
      const confirmed = await vscode.window.showWarningMessage(
        "Revert the last Quorate fix? Tracked files return to their pre-fix state and agent-created files are removed.",
        { modal: true },
        "Revert"
      );
      if (confirmed !== "Revert") return;
      const { code, stdout, stderr } = await runCli(["fix", "--revert"]);
      if (code === 0) {
        void vscode.window.showInformationMessage(`Quorate: ${stdout.trim().split("\n").pop() ?? "fix reverted."}`);
        return;
      }
      const reason = messageTail(stderr);
      if (/changed since fix/i.test(stderr)) {
        const force = await vscode.window.showWarningMessage(`Quorate: ${reason}`, { modal: true }, "Force Revert");
        if (force === "Force Revert") {
          const retry = await runCli(["fix", "--revert", "--force"]);
          void (retry.code === 0
            ? vscode.window.showInformationMessage("Quorate: fix reverted (forced).")
            : vscode.window.showErrorMessage(`Quorate: ${messageTail(retry.stderr)}`));
        }
        return;
      }
      void vscode.window.showErrorMessage(`Quorate: ${reason}`);
    }),
    vscode.commands.registerCommand("quorate.clearFindings", () => {
      diagnostics.clear();
      decorations.clear();
      results.setReport(undefined);
      statusBar.text = "$(law) Quorate";
    }),

    // Rich hover on a finding line: severity, body, agreement, suggestion + Fix/Ignore.
    vscode.languages.registerHoverProvider(
      { scheme: "file" },
      {
        provideHover(document, position) {
          return findingHover(decorations.findingsAt(document.uri.fsPath, position.line), document.uri);
        }
      }
    ),
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
    }),

    // Lightbulb on any Quorate squiggle -> delegate the finding to an agent.
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      {
        provideCodeActions(doc, _range, ctx) {
          const actions: vscode.CodeAction[] = [];
          for (const diagnostic of ctx.diagnostics) {
            if (diagnostic.source !== "quorate") continue;
            if (typeof diagnostic.code === "number") {
              const fix = new vscode.CodeAction("Quorate: fix with an agent…", vscode.CodeActionKind.QuickFix);
              fix.diagnostics = [diagnostic];
              fix.command = { command: "quorate.fixFinding", title: "Fix with an agent", arguments: [diagnostic.code] };
              actions.push(fix);
            }
            // Suppress: append an inline `// quorate-ignore` to the finding's line.
            const suppress = new vscode.CodeAction(
              "Quorate: ignore this finding (// quorate-ignore)",
              vscode.CodeActionKind.QuickFix
            );
            suppress.diagnostics = [diagnostic];
            suppress.command = {
              command: "quorate.suppressFinding",
              title: "Ignore this finding",
              arguments: [doc.uri.toString(), diagnostic.range.start.line]
            };
            actions.push(suppress);
          }
          return actions;
        }
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );

  await reload();
}

export function deactivate(): void {
  /* disposables handled via context.subscriptions */
}
