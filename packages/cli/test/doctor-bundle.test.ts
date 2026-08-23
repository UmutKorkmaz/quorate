import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "@quorate/core";
import { buildDoctorBundle, createZipBuffer, redactConfig } from "../src/doctor-bundle.js";

function zipEntries(buffer: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  let offset = 0;

  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = offset + 30 + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    entries.set(name, inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize)).toString("utf8"));
    offset = dataStart + compressedSize;
  }

  return entries;
}

function zipContents(buffer: Buffer): string {
  return [...zipEntries(buffer).values()].join("\n");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("doctor bundle", () => {
  it("redacts provider env and api key references", () => {
    const config = createDefaultConfig([]);
    const codex = config.providers.find((provider) => provider.id === "codex");
    if (!codex) throw new Error("missing codex provider");
    codex.env = { SECRET: "super-secret" };
    codex.apiKeyEnv = "OPENAI_API_KEY";

    const redacted = redactConfig(config);
    const next = redacted.providers.find((provider) => provider.id === "codex");
    expect(next?.env?.SECRET).toBe("[REDACTED]");
    expect(next?.apiKeyEnv).toBe("[REDACTED]");
    // The raw secret must not survive anywhere in the redacted output.
    expect(JSON.stringify(redacted)).not.toContain("super-secret");
  });

  it("strips embedded credentials from provider baseUrl", () => {
    const config = createDefaultConfig([]);
    const codex = config.providers.find((provider) => provider.id === "codex");
    if (!codex) throw new Error("missing codex provider");
    codex.baseUrl = "https://user:super-secret@proxy.internal/v1";

    const redacted = redactConfig(config);
    const next = redacted.providers.find((provider) => provider.id === "codex");
    expect(next?.baseUrl).toBe("https://[redacted]@proxy.internal/v1");
    expect(JSON.stringify(redacted)).not.toContain("super-secret");
  });

  it("creates a zip archive with expected entries", () => {
    const buffer = createZipBuffer([
      { name: "manifest.json", data: "{}\n" },
      { name: "doctor.txt", data: "ok\n" }
    ]);
    expect(buffer.subarray(0, 4).toString()).toBe("PK\u0003\u0004");
    expect(buffer.includes(Buffer.from("manifest.json"))).toBe(true);
    expect(buffer.includes(Buffer.from("doctor.txt"))).toBe(true);
  });

  it("buildDoctorBundle includes last report when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-bundle-"));
    const reportDir = join(dir, ".quorate");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, "last-report.json"),
      JSON.stringify({ verdict: "pass", summary: "ok", findings: [], metadata: { degraded: false } }),
      "utf8"
    );

    const buffer = buildDoctorBundle(createDefaultConfig([]), dir);
    // Entry names live in the zip central directory (uncompressed); payloads are deflated.
    expect(buffer.includes(Buffer.from("last-report.json"))).toBe(true);
    expect(buffer.includes(Buffer.from("manifest.json"))).toBe(true);
    expect(buffer.includes(Buffer.from("config.redacted.yml"))).toBe(true);
  });

  it("redacts nested report strings with configured provider secrets from the bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-bundle-"));
    const reportDir = join(dir, ".quorate");
    const reportSecret = "nested-report-secret-123456";
    const providerEnvSecret = "e1";
    const apiKeySecret = "k2";
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, "last-report.json"),
      JSON.stringify({
        summary: `summary api_key=${reportSecret}`,
        findings: [
          {
            title: `title ${providerEnvSecret}`,
            body: `body api_key=${reportSecret}`,
            suggestion: `suggestion ${apiKeySecret}`
          }
        ],
        providerResults: [{ rawOutput: `raw api_key=${reportSecret} and ${providerEnvSecret} and ${apiKeySecret}` }]
      }),
      "utf8"
    );

    const config = createDefaultConfig([]);
    const codex = config.providers.find((provider) => provider.id === "codex");
    if (!codex) throw new Error("missing codex provider");
    codex.env = { PROVIDER_SECRET: providerEnvSecret };
    codex.apiKeyEnv = "BUNDLE_PROVIDER_TOKEN";
    vi.stubEnv("BUNDLE_PROVIDER_TOKEN", apiKeySecret);

    const buffer = buildDoctorBundle(config, dir);
    const archiveText = zipContents(buffer);

    expect(buffer.includes(Buffer.from(reportSecret))).toBe(false);
    for (const secret of [reportSecret, providerEnvSecret, apiKeySecret]) {
      expect(archiveText).not.toContain(secret);
    }
    expect(archiveText).toContain("[redacted]");
  });

  it("rejects a last report replaced between validation and open", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-bundle-"));
    const reportDir = join(dir, ".quorate");
    const reportPath = join(reportDir, "last-report.json");
    const originalSecret = "original-report-secret-123456";
    const replacementSecret = "replacement-report-secret-123456";
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(reportPath, JSON.stringify({ summary: originalSecret }), "utf8");
    const replacement = join(dir, "replacement.json");
    writeFileSync(replacement, JSON.stringify({ summary: replacementSecret }), "utf8");

    const archiveText = zipContents(
      buildDoctorBundle(createDefaultConfig([]), dir, {
        beforeLastReportOpen: () => renameSync(replacement, reportPath)
      })
    );

    expect(archiveText).not.toContain(originalSecret);
    expect(archiveText).not.toContain(replacementSecret);
  });

  it("omits a deeply nested report when sanitization exceeds its traversal bound", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-bundle-"));
    const reportDir = join(dir, ".quorate");
    const reportSecret = "deep-report-secret-123456";
    let report: unknown = { summary: reportSecret };
    for (let index = 0; index < 128; index += 1) report = { nested: report };
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, "last-report.json"), JSON.stringify(report), "utf8");

    const config = createDefaultConfig([]);
    const codex = config.providers.find((provider) => provider.id === "codex");
    if (!codex) throw new Error("missing codex provider");
    codex.env = { DEEP_REPORT_SECRET: reportSecret };

    const entries = zipEntries(buildDoctorBundle(config, dir));

    expect(entries.get("last-report.json")).toBe("null\n");
  });

  it("stops visiting a wide report after its sanitization node budget is exhausted", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-bundle-"));
    const reportDir = join(dir, ".quorate");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, "last-report.json"),
      JSON.stringify({ findings: Array.from({ length: 20_000 }, () => "ordinary report text") }),
      "utf8"
    );
    let visited = 0;

    const entries = zipEntries(
      buildDoctorBundle(createDefaultConfig([]), dir, {
        onReportNodeVisited: (nodes) => {
          visited = nodes;
        }
      })
    );

    expect(entries.get("last-report.json")).toBe("null\n");
    expect(visited).toBeLessThan(10_100);
  });

  it.skipIf(process.platform === "win32")("rejects a FIFO substituted after validation without blocking", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-bundle-"));
    const reportDir = join(dir, ".quorate");
    const reportPath = join(reportDir, "last-report.json");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(reportPath, JSON.stringify({ summary: "safe report" }), "utf8");
    const fifoPath = join(reportDir, "replacement.fifo");
    execFileSync("mkfifo", [fifoPath]);

    const entries = zipEntries(
      buildDoctorBundle(createDefaultConfig([]), dir, {
        beforeLastReportOpen: () => renameSync(fifoPath, reportPath)
      })
    );

    expect(entries.get("last-report.json")).toBe("null\n");
  });

  it("rejects a symlinked last report instead of copying its contents into the bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-bundle-"));
    const reportDir = join(dir, ".quorate");
    const victim = join(dir, "victim-report.json");
    const victimSecret = "symlink-report-secret-123456";
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(victim, JSON.stringify({ summary: victimSecret }), "utf8");
    symlinkSync(victim, join(reportDir, "last-report.json"));

    const archiveText = zipContents(buildDoctorBundle(createDefaultConfig([]), dir));

    expect(archiveText.includes(victimSecret)).toBe(false);
  });

  it("rejects an oversized last report instead of including it in the bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-bundle-"));
    const reportDir = join(dir, ".quorate");
    const reportSecret = "oversized-report-secret-123456";
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, "last-report.json"),
      JSON.stringify({ summary: `${reportSecret}${"x".repeat(5 * 1024 * 1024)}` }),
      "utf8"
    );

    const archiveText = zipContents(buildDoctorBundle(createDefaultConfig([]), dir));

    expect(archiveText.includes(reportSecret)).toBe(false);
  });
});
