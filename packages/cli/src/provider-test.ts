import {
  fetchProviderModels,
  findExecutable,
  formatSpawnArgv,
  isLocalBaseUrl,
  type ProviderConfig
} from "@quorate/core";

export interface ProviderTestResult {
  providerId: string;
  type: ProviderConfig["type"];
  status: "ok" | "warn" | "error";
  checks: Array<{ name: string; status: "ok" | "warn" | "error"; detail: string }>;
  models?: string[];
}

function worstStatus(checks: ProviderTestResult["checks"]): ProviderTestResult["status"] {
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
}

export async function testProvider(provider: ProviderConfig): Promise<ProviderTestResult> {
  const checks: ProviderTestResult["checks"] = [];
  let models: string[] | undefined;

  if (provider.type === "mock") {
    checks.push({ name: "provider", status: "ok", detail: "Built-in heuristic provider is available." });
    return { providerId: provider.id, type: provider.type, status: "ok", checks };
  }

  if (provider.type === "cli") {
    const command = provider.command ?? provider.id;
    const executable = findExecutable(command);
    checks.push(
      executable
        ? { name: "executable", status: "ok", detail: `${command} -> ${executable}` }
        : { name: "executable", status: "error", detail: `${command} was not found on PATH.` }
    );
    checks.push(
      provider.args && provider.args.length > 0
        ? { name: "headless args", status: "ok", detail: formatSpawnArgv(provider, provider.roles?.[0] ?? "maintainer", { mode: "review", subject: "Provider test", diff: "", repoPath: process.cwd() }) }
        : { name: "headless args", status: "error", detail: "No headless args configured; provider may open an interactive session." }
    );
    return { providerId: provider.id, type: provider.type, status: worstStatus(checks), checks };
  }

  if (!provider.model) {
    checks.push({ name: "model", status: "error", detail: "No model configured." });
  } else {
    checks.push({ name: "model", status: "ok", detail: provider.model });
  }

  const token = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
  if (provider.apiKeyEnv && !token && !isLocalBaseUrl(provider.baseUrl ?? "")) {
    checks.push({ name: "api key", status: "warn", detail: `${provider.apiKeyEnv} is not set.` });
  } else if (provider.apiKeyEnv) {
    checks.push({ name: "api key", status: token ? "ok" : "ok", detail: token ? `${provider.apiKeyEnv} is set.` : `${provider.apiKeyEnv} not required for local endpoint.` });
  }

  models = await fetchProviderModels(provider.baseUrl, token);
  checks.push(
    models.length > 0
      ? { name: "models", status: "ok", detail: `${models.length} model(s) returned from ${provider.baseUrl ?? "default endpoint"}/models.` }
      : { name: "models", status: "warn", detail: `No models returned from ${provider.baseUrl ?? "default endpoint"}/models.` }
  );

  return { providerId: provider.id, type: provider.type, status: worstStatus(checks), checks, models };
}

export function formatProviderTestResult(result: ProviderTestResult): string {
  const lines = [`Provider ${result.providerId}: ${result.status.toUpperCase()}`];
  for (const check of result.checks) {
    lines.push(`  ${check.status.toUpperCase().padEnd(5)} ${check.name}: ${check.detail}`);
  }
  if (result.models && result.models.length > 0) {
    lines.push(`  Models: ${result.models.slice(0, 10).join(", ")}${result.models.length > 10 ? " ..." : ""}`);
  }
  return lines.join("\n");
}
