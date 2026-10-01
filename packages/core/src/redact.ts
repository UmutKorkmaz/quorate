const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|secret)\s*[:=]\s*["']?[^"'\s,}]{8,}/gi,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSecrets(input: string | undefined, secrets: Array<string | undefined> = []): string | undefined {
  if (input === undefined) return undefined;
  let output = input;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match) => {
      // PEM blocks contain "=" base64 padding; skip the assignment-prefix
      // heuristic below so the whole key is dropped, not partially re-emitted.
      if (match.startsWith("-----BEGIN")) return "[redacted]";
      const bearer = /^(Bearer\s+)/i.exec(match)?.[1];
      if (bearer) return `${bearer}[redacted]`;
      const assignment = /^([^:=]+[:=]\s*)/i.exec(match)?.[1];
      return assignment ? `${assignment}[redacted]` : "[redacted]";
    });
  }
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    output = output.replace(new RegExp(escapeRegExp(secret), "g"), "[redacted]");
  }
  return output;
}

/**
 * Masks `user:pass@` userinfo embedded in a URL while keeping scheme and host:
 * `https://token@host/path` -> `https://[redacted]@host/path`. URLs without
 * leading userinfo are returned unchanged.
 */
export function redactUrlCredentials(url: string): string {
  return url.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]+@/, "$1[redacted]@");
}
