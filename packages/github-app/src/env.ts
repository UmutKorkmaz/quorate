/** Validated environment configuration for the GitHub App server. */

export interface AppEnv {
  /** GitHub App ID (numeric, as string). */
  readonly appId: string;
  /** PEM-encoded private key. Newlines may be escaped as \\n. */
  readonly privateKey: string;
  /** Webhook secret set during App registration. */
  readonly webhookSecret: string;
  /** TCP port the HTTP server listens on (default 3000). */
  readonly port: number;
  /** Optional: comma-separated list of provider IDs to enable. */
  readonly providers: string | undefined;
  /** Optional: Anthropic API key forwarded to @quorate/core providers. */
  readonly anthropicApiKey: string | undefined;
  /** Optional: OpenAI API key. */
  readonly openaiApiKey: string | undefined;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Load and validate runtime configuration from environment variables. */
export function loadEnv(): AppEnv {
  const rawKey = required("PRIVATE_KEY");
  // Support both literal newlines and the escaped \\n form used by Render/Fly
  const privateKey = rawKey.replace(/\\n/g, "\n");

  return {
    appId: required("APP_ID"),
    privateKey,
    webhookSecret: required("WEBHOOK_SECRET"),
    port: Number(optional("PORT") ?? "3000"),
    providers: optional("QUORATE_PROVIDERS"),
    anthropicApiKey: optional("ANTHROPIC_API_KEY"),
    openaiApiKey: optional("OPENAI_API_KEY")
  } as const;
}
