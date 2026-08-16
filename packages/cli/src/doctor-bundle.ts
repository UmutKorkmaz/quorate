import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { redactUrlCredentials, serializeConfig, type QuorateConfig } from "@quorate/core";
import { formatDoctorReport } from "./doctor.js";
import { providerSnapshots, type ShellState } from "./session.js";
import { latestSession } from "./sessions.js";
import { readVersion } from "./version.js";

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

function readLastReport(cwd: string): unknown {
  const path = resolve(cwd, ".quorate", "last-report.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Zip diagnostics: redacted config, provider grid, doctor text, and last report. */
export function buildDoctorBundle(config: QuorateConfig, cwd: string): Buffer {
  const shellState: ShellState = { cwd, config, mode: "review", transcript: [] };
  const redacted = redactConfig(config);
  const snapshots = providerSnapshots(shellState);
  const latest = latestSession(cwd);
  const lastReport = readLastReport(cwd) ?? latest?.lastReportSummary ?? null;

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