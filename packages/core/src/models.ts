import type { ProviderConfig } from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const LIST_TIMEOUT_MS = 8_000;

/**
 * Lists model ids from an OpenAI-compatible endpoint's `GET {baseUrl}/models`.
 * Works for Ollama, LM Studio, vLLM, llama.cpp, TGI, LiteLLM, OpenAI, OpenRouter
 * (public), Groq, Together, Fireworks, DeepSeek, Mistral, the HF router, and the
 * Gemini OpenAI-compat layer. Returns [] when the endpoint is unreachable.
 */
export async function fetchProviderModels(
  baseUrl: string | undefined,
  apiKey?: string
): Promise<string[]> {
  const url = `${(baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/models`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) return [];
    const json = (await response.json()) as {
      data?: Array<{ id?: string }>;
      models?: Array<{ id?: string; name?: string }>;
    };
    const ids = Array.isArray(json.data)
      ? json.data.map((m) => m.id)
      : Array.isArray(json.models)
        ? json.models.map((m) => m.id ?? m.name)
        : [];
    return ids.filter((id): id is string => typeof id === "string").sort();
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Lists models for a configured api provider, reading its key from apiKeyEnv. */
export function fetchModelsForProvider(provider: Pick<ProviderConfig, "baseUrl" | "apiKeyEnv">): Promise<string[]> {
  const key = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
  return fetchProviderModels(provider.baseUrl, key);
}
