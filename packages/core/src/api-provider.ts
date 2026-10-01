import { parseProviderReview } from "./cli-provider.js";
import { buildReviewPrompt } from "./prompt.js";
import { redactSecrets } from "./redact.js";
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

function firstMeaningfulLine(output: string): string {
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "Provider returned output."
  );
}

function redactProviderText(input: string, secrets: Array<string | undefined>): string {
  let knownSecretsRedacted = input;
  for (const secret of secrets) {
    if (secret) knownSecretsRedacted = knownSecretsRedacted.replaceAll(secret, "[redacted]");
  }
  return redactSecrets(knownSecretsRedacted, secrets) ?? knownSecretsRedacted;
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
  const prompt = buildReviewPrompt(provider, role, request);

  const headers: Record<string, string> = { "content-type": "application/json" };
  let apiToken: string | undefined;
  if (provider.apiKeyEnv) {
    const token = process.env[provider.apiKeyEnv];
    if (token) {
      apiToken = token;
      headers.authorization = `Bearer ${token}`;
    }
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
      redirect: "error",
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
      const trimmed = redactProviderText(errorText.trim(), [apiToken]);
      return fail(
        `API provider ${provider.id} returned HTTP ${response.status}.`,
        trimmed || `HTTP ${response.status} ${response.statusText}`.trim(),
        trimmed || undefined
      );
    }

    const json = (await response.json()) as {
      choices?: Array<{ finish_reason?: string | null; message?: { content?: unknown; refusal?: unknown } }>;
    };

    const choice = json.choices?.[0];
    const rawContent = choice?.message?.content;
    const text = typeof rawContent === "string" ? rawContent : "";

    const originalOutputTruncated = Buffer.byteLength(text) > maxOutputBytes;
    const redactedText = redactProviderText(text, [apiToken]);
    const outputTruncated =
      originalOutputTruncated || Buffer.byteLength(redactedText) > maxOutputBytes;
    const output = outputTruncated
      ? Buffer.from(redactedText).subarray(0, maxOutputBytes).toString("utf8")
      : redactedText;

    const review = parseProviderReview(output, provider.id, role);
    const incomplete = choice?.finish_reason != null && choice.finish_reason !== "stop";
    const error = outputTruncated
      ? `Provider output truncated to ${maxOutputBytes} bytes; the review is incomplete.`
      : incomplete || choice?.message?.refusal
        ? "Provider did not complete a valid review (generation stopped early or was refused)."
        : review.error;

    return {
      ...base,
      status: error ? "error" : "ok",
      summary: error ?? firstMeaningfulLine(output),
      ...(error ? { error } : {}),
      findings: review.findings,
      rawOutput: output || undefined,
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
      redactProviderText(error instanceof Error ? error.message : String(error), [apiToken])
    );
  } finally {
    clearTimeout(timer);
    if (hooks?.signal) hooks.signal.removeEventListener("abort", onUserAbort);
  }
}
