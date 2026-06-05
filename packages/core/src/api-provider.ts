import { parseFindings } from "./cli-provider.js";
import type { CouncilRequest, ProviderConfig, ProviderResult } from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

const REVIEWER_INSTRUCTIONS = [
  "You are a meticulous code reviewer.",
  "Report concrete findings in the requested format only. Do not add filler prose.",
  "Use severity values: critical, high, medium, low, info."
].join("\n");

/**
 * Builds the review prompt sent to the model. Mirrors the prompt the CLI path
 * uses (the CLI's `buildPrompt` is not exported, so it is replicated minimally
 * here without modifying cli-provider.ts).
 */
function buildPrompt(provider: ProviderConfig, role: string, request: CouncilRequest): string {
  const header = [
    `You are the ${role} member of Quorate.`,
    `Mode: ${request.mode}`,
    `Subject: ${request.subject}`,
    "Return concise findings as Markdown bullets. Use this finding format when possible:",
    "- [severity] Title (path/to/file.ts:12): concrete evidence and recommendation",
    "Use severity values: critical, high, medium, low, info.",
    "You MAY instead return a JSON array of findings in a fenced ```json block, where each item is",
    '{"severity","title","body","file?","line?","suggestion?"}.'
  ].join("\n");

  const diffSection = request.diff ? `\n\nDiff:\n${request.diff}` : "";
  return `${header}\n\nProvider: ${provider.id}${diffSection}`;
}

function firstMeaningfulLine(output: string): string {
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "Provider returned output."
  );
}

/**
 * Runs an OpenAI-compatible chat-completions endpoint as a Quorate provider.
 * Returns the same {@link ProviderResult} shape as `runCliProvider`, with
 * `providerType: "api"`.
 */
export async function runApiProvider(
  provider: ProviderConfig,
  role: string,
  request: CouncilRequest,
  hooks?: { signal?: AbortSignal }
): Promise<ProviderResult> {
  const startedAt = Date.now();

  const base: Omit<ProviderResult, "status" | "summary"> & { summary?: string } = {
    providerId: provider.id,
    role,
    providerType: "api",
    findings: [],
    durationMs: 0
  };

  const fail = (summary: string, error?: string, rawOutput?: string): ProviderResult => ({
    ...base,
    status: "error",
    summary,
    findings: [],
    error: error ?? summary,
    rawOutput,
    durationMs: Date.now() - startedAt
  });

  const model = provider.model;
  if (!model || model.trim() === "") {
    return fail(
      `API provider ${provider.id} has no model configured. Set the model in your config.`
    );
  }

  const baseUrl = (provider.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  const timeoutMs = Math.min(provider.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxOutputBytes = provider.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const prompt = buildPrompt(provider, role, request);

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.apiKeyEnv) {
    const token = process.env[provider.apiKeyEnv];
    if (token) headers.authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  let timedOut = false;
  let userAborted = hooks?.signal?.aborted ?? false;

  const onUserAbort = (): void => {
    userAborted = true;
    controller.abort();
  };
  if (hooks?.signal) {
    if (hooks.signal.aborted) controller.abort();
    else hooks.signal.addEventListener("abort", onUserAbort);
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: REVIEWER_INSTRUCTIONS },
          { role: "user", content: prompt }
        ],
        stream: false
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const trimmed = errorText.trim();
      return fail(
        `API provider ${provider.id} returned HTTP ${response.status}.`,
        trimmed || `HTTP ${response.status} ${response.statusText}`.trim(),
        trimmed || undefined
      );
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };

    const rawContent = json.choices?.[0]?.message?.content;
    let text = typeof rawContent === "string" ? rawContent : "";

    let outputTruncated = false;
    if (Buffer.byteLength(text) > maxOutputBytes) {
      outputTruncated = true;
      text = Buffer.from(text).subarray(0, maxOutputBytes).toString("utf8");
    }

    const findings = parseFindings(text, provider.id, role);

    return {
      ...base,
      status: "ok",
      summary: outputTruncated
        ? `Provider output truncated to ${maxOutputBytes} bytes.`
        : firstMeaningfulLine(text),
      findings,
      rawOutput: text || undefined,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    if (userAborted) {
      return {
        ...base,
        status: "interrupted",
        summary: "Provider run interrupted.",
        findings: [],
        durationMs: Date.now() - startedAt
      };
    }
    if (timedOut) {
      return fail(`Provider timed out after ${timeoutMs}ms.`);
    }
    return fail(
      `API provider ${provider.id} request failed.`,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    clearTimeout(timer);
    if (hooks?.signal) hooks.signal.removeEventListener("abort", onUserAbort);
  }
}
