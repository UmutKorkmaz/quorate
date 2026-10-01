import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { lockSync } from "proper-lockfile";
import { parse } from "smol-toml";

const MARKER = "# quorate-managed-notify-v1";

/** Only add a root key when absent. Preserve existing TOML byte for byte. */
export function mergeCodexNotify(text: string, binary: string): string {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = text.slice(bom.length);
  const config = parse(body);
  // Even an explicit empty array belongs to the user.
  if (Object.hasOwn(config, "notify")) return text;
  if (body.startsWith(MARKER)) throw new Error("Incomplete managed notify prefix; restore the config backup before setup.");
  const argv = [binary, "hook-report", "--source", "codex", "--event", "notify"];
  return `${bom}${MARKER}\nnotify = ${JSON.stringify(argv)}\n${body}`;
}

export function stripCodexNotify(text: string): string {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = text.slice(bom.length);
  const lines = body.split("\n");
  if (lines[0] !== MARKER || !lines[1]?.startsWith("notify = ")) return text;
  const config = parse(body);
  const command = config.notify;
  if (!Array.isArray(command) || command.length !== 6 ||
      JSON.stringify(command.slice(1)) !== JSON.stringify(["hook-report", "--source", "codex", "--event", "notify"])) return text;
  const remaining = lines.slice(2).join("\n");
  parse(remaining);
  return bom + remaining;
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
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.quorate-notify.lock`;
  const release = lockSync(path, { realpath: false, lockfilePath: lock, stale: 10_000, retries: 0 });
  let temp: string | undefined;
  try {
    const before = readCodexConfig(path);
    const after = binary === undefined ? stripCodexNotify(before) : mergeCodexNotify(before, binary);
    if (after === before) return "Codex config unchanged; no Quorate notify edit needed.";
    const suffix = randomUUID();
    if (before) writeFileSync(`${path}.quorate-backup-${suffix}.toml`, before, { mode: 0o600, flag: "wx" });
    temp = `${path}.${suffix}.tmp`;
    writeFileSync(temp, after, { mode: 0o600, flag: "wx" });
    // The lock serializes Quorate writers. Detect observed external edits too;
    // another editor that ignores this lock can still race the final rename.
    if (readCodexConfig(path) !== before) throw new Error("Codex config changed during setup; edit aborted.");
    renameSync(temp, path);
    return binary === undefined ? "Quorate Codex notify removed." : "Codex turn-completion notify installed.";
  } finally {
    try { if (temp) rmSync(temp, { force: true }); } finally { release(); }
  }
}
