import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { redactSecrets, redactUrlCredentials, serializeConfig, type QuorateConfig } from "@quorate/core";
import { formatDoctorReport } from "./doctor.js";
import { providerSnapshots, type ShellState } from "./session.js";
import { latestSession } from "./sessions.js";
import { readVersion } from "./version.js";

const MAX_LAST_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_REPORT_REDACTION_DEPTH = 64;
const MAX_REPORT_REDACTION_NODES = 10_000;
const OMIT_REPORT = Symbol("omit report");

export function redactConfig(config: QuorateConfig): QuorateConfig {
  return {
    ...config,
    providers: config.providers.map((provider) => {
      const next = { ...provider };
      if (next.env) {
        next.env = Object.fromEntries(Object.keys(next.env).map((key) => [key, "[REDACTED]"]));
      }
      if (next.apiKeyEnv) {
        next.apiKeyEnv = "[REDACTED]";
      }
      // baseUrl can embed credentials (https://user:token@host); strip userinfo.
      if (next.baseUrl) {
        next.baseUrl = redactUrlCredentials(next.baseUrl);
      }
      return next;
    })
  };
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

interface DoctorBundleHooks {
  /** Test-only synchronization point for deterministic file-replacement coverage. */
  beforeLastReportOpen?: () => void;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localFileHeader(entry: ZipEntry, offset: number, compressed: Buffer): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc32(entry.data), 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return header;
}

function centralDirectoryRecord(entry: ZipEntry, offset: number, compressed: Buffer): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const record = Buffer.alloc(46 + name.length);
  record.writeUInt32LE(0x02014b50, 0);
  record.writeUInt16LE(20, 4);
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(0x0800, 8);
  record.writeUInt16LE(8, 10);
  record.writeUInt16LE(0, 12);
  record.writeUInt16LE(0, 14);
  record.writeUInt32LE(crc32(entry.data), 16);
  record.writeUInt32LE(compressed.length, 20);
  record.writeUInt32LE(entry.data.length, 24);
  record.writeUInt16LE(name.length, 28);
  record.writeUInt16LE(0, 30);
  record.writeUInt16LE(0, 32);
  record.writeUInt16LE(0, 34);
  record.writeUInt16LE(0, 36);
  record.writeUInt32LE(0, 38);
  record.writeUInt32LE(offset, 42);
  name.copy(record, 46);
  return record;
}

/** Build a deflate-compressed ZIP archive from UTF-8/text payloads. */
export function createZipBuffer(files: Array<{ name: string; data: string }>): Buffer {
  const entries: ZipEntry[] = files.map((file) => ({
    name: file.name.replace(/\\/g, "/"),
    data: Buffer.from(file.data, "utf8")
  }));

  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const compressed = deflateRawSync(entry.data);
    const header = localFileHeader(entry, offset, compressed);
    parts.push(header, compressed);
    central.push(centralDirectoryRecord(entry, offset, compressed));
    offset += header.length + compressed.length;
  }

  const centralDir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralDir, end]);
}

function readLastReport(cwd: string, hooks?: DoctorBundleHooks): unknown {
  const stateDir = resolve(cwd, ".quorate");
  const path = resolve(cwd, ".quorate", "last-report.json");
  let fd: number | undefined;
  try {
    const stateDirBefore = lstatSync(stateDir);
    if (stateDirBefore.isSymbolicLink() || !stateDirBefore.isDirectory()) return null;

    const fileBefore = lstatSync(path);
    if (fileBefore.isSymbolicLink() || !fileBefore.isFile()) return null;

    hooks?.beforeLastReportOpen?.();
    fd = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    );
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.dev !== fileBefore.dev ||
      opened.ino !== fileBefore.ino ||
      opened.size > MAX_LAST_REPORT_BYTES
    ) {
      return null;
    }

    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < opened.size) {
      const count = readSync(fd, bytes, offset, opened.size - offset, offset);
      if (count === 0) return null;
      offset += count;
    }

    const fileAfter = lstatSync(path);
    const stateDirAfter = lstatSync(stateDir);
    if (
      fileAfter.isSymbolicLink() ||
      !fileAfter.isFile() ||
      fileAfter.dev !== fileBefore.dev ||
      fileAfter.ino !== fileBefore.ino ||
      stateDirAfter.isSymbolicLink() ||
      !stateDirAfter.isDirectory() ||
      stateDirAfter.dev !== stateDirBefore.dev ||
      stateDirAfter.ino !== stateDirBefore.ino
    ) {
      return null;
    }
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function providerSecrets(config: QuorateConfig): Array<string | undefined> {
  return config.providers.flatMap((provider) => [
    ...Object.values(provider.env ?? {}),
    provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined
  ]);
}

function redactKnownSecrets(value: string, secrets: Array<string | undefined>): string {
  let knownSecretsRedacted = value;
  for (const secret of secrets) {
    if (secret) knownSecretsRedacted = knownSecretsRedacted.replaceAll(secret, "[redacted]");
  }
  return redactSecrets(knownSecretsRedacted, secrets) ?? knownSecretsRedacted;
}

function redactReportStrings(value: unknown, secrets: Array<string | undefined>): unknown | undefined {
  let nodes = 0;
  const visit = (current: unknown, depth: number): unknown | typeof OMIT_REPORT => {
    nodes += 1;
    if (nodes > MAX_REPORT_REDACTION_NODES || depth > MAX_REPORT_REDACTION_DEPTH) {
      return OMIT_REPORT;
    }
    if (typeof current === "string") return redactKnownSecrets(current, secrets);
    if (Array.isArray(current)) {
      const items = current.map((item) => visit(item, depth + 1));
      return items.includes(OMIT_REPORT) ? OMIT_REPORT : items;
    }
    if (current && typeof current === "object") {
      const entries = Object.entries(current).map(([key, item]) => [key, visit(item, depth + 1)]);
      return entries.some(([, item]) => item === OMIT_REPORT)
        ? OMIT_REPORT
        : Object.fromEntries(entries);
    }
    return current;
  };

  try {
    const redacted = visit(value, 0);
    return redacted === OMIT_REPORT ? undefined : redacted;
  } catch {
    return undefined;
  }
}

/** Zip diagnostics: redacted config, provider grid, doctor text, and last report. */
export function buildDoctorBundle(
  config: QuorateConfig,
  cwd: string,
  hooks?: DoctorBundleHooks
): Buffer {
  const shellState: ShellState = { cwd, config, mode: "review", transcript: [] };
  const redacted = redactConfig(config);
  const snapshots = providerSnapshots(shellState);
  const latest = latestSession(cwd);
  const lastReport = redactReportStrings(
    readLastReport(cwd, hooks) ?? latest?.lastReportSummary ?? null,
    providerSecrets(config)
  ) ?? null;

  const manifest = {
    tool: "quorate",
    version: readVersion(),
    generatedAt: new Date().toISOString(),
    node: process.versions.node,
    cwd,
    latestSessionId: latest?.id ?? null
  };

  return createZipBuffer([
    { name: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: "config.redacted.yml", data: serializeConfig(redacted) },
    { name: "providers.json", data: `${JSON.stringify(snapshots, null, 2)}\n` },
    { name: "doctor.txt", data: `${formatDoctorReport(shellState, { color: false })}\n` },
    { name: "last-report.json", data: `${JSON.stringify(lastReport, null, 2)}\n` }
  ]);
}
