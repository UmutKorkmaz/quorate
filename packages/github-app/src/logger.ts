/** Minimal structured logger that writes to stderr, never stdout. */

type Level = "info" | "warn" | "error" | "debug";

function write(level: Level, message: string, data?: Record<string, unknown>): void {
  const entry = data
    ? `[quorate] ${level.toUpperCase()} ${message} ${JSON.stringify(data)}`
    : `[quorate] ${level.toUpperCase()} ${message}`;
  process.stderr.write(entry + "\n");
}

export const logger = {
  info: (message: string, data?: Record<string, unknown>): void => write("info", message, data),
  warn: (message: string, data?: Record<string, unknown>): void => write("warn", message, data),
  error: (message: string, data?: Record<string, unknown>): void => write("error", message, data),
  debug: (message: string, data?: Record<string, unknown>): void => {
    if (process.env.DEBUG) write("debug", message, data);
  }
} as const;
