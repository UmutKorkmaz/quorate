const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|secret)\s*[:=]\s*["']?[^"'\s,}]{8,}/gi,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSecrets(input: string | undefined, secrets: Array<string | undefined> = []): string | undefined {
  if (input === undefined) return undefined;
  let output = input;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match) => {
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
