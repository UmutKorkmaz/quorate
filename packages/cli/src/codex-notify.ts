import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { parse } from "smol-toml";

const MARKER = "# quorate-managed-notify-v1";

/** Only add a root key when absent. Preserve existing TOML byte for byte. */
export function mergeCodexNotify(text: string, binary: string): string {
  const config = parse(text);
  // Even an explicit empty array belongs to the user.
  if (Object.hasOwn(config, "notify")) return text;
  const argv = [binary, "hook-report", "--source", "codex", "--event", "notify"];
  return `${MARKER}\nnotify = ${JSON.stringify(argv)}\n${text}`;
}

export function stripCodexNotify(text: string): string {
  const lines = text.split("\n");
  if (lines[0] !== MARKER || !lines[1]?.startsWith("notify = ")) return text;
  const config = parse(text);
  const command = config.notify;
  if (!Array.isArray(command) || command.length !== 6 ||
      JSON.stringify(command.slice(1)) !== JSON.stringify(["hook-report", "--source", "codex", "--event", "notify"])) return text;
  const remaining = lines.slice(2).join("\n");
  parse(remaining);
  return remaining;
}

export function readCodexConfig(path: string): string {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Codex config must be a regular file.");
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export function updateCodexNotify(path: string, binary?: string): string {
  const before = readCodexConfig(path);
  const after = binary === undefined ? stripCodexNotify(before) : mergeCodexNotify(before, binary);
  if (after === before) return "Codex config unchanged (existing notify preserved).";
  mkdirSync(dirname(path), { recursive: true });
  const suffix = randomUUID();
  if (before) writeFileSync(`${path}.quorate-backup-${suffix}.toml`, before, { mode: 0o600, flag: "wx" });
  const temp = `${path}.${suffix}.tmp`;
  writeFileSync(temp, after, { mode: 0o600, flag: "wx" });
  // Refuse a concurrent configuration edit rather than overwriting it.
  if (readCodexConfig(path) !== before) throw new Error(`Codex config changed during setup; preserved backup and ${temp}.`);
  renameSync(temp, path);
  return binary === undefined ? "Quorate Codex notify removed." : "Codex turn-completion notify installed.";
}
