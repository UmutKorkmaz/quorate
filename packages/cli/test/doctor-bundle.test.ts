import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "@quorate/core";
import { buildDoctorBundle, createZipBuffer, redactConfig } from "../src/doctor-bundle.js";

function zipContents(buffer: Buffer): string {
  const contents: string[] = [];
  let offset = 0;

  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    contents.push(inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize)).toString("utf8"));
    offset = dataStart + compressedSize;
  }

  return contents.join("\n");
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
    const providerSecret = "configured-provider-secret-123456";
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, "last-report.json"),
      JSON.stringify({
        summary: `summary api_key=${reportSecret}`,
        findings: [
          {
            title: `title ${providerSecret}`,
            body: `body api_key=${reportSecret}`,
            suggestion: `suggestion ${providerSecret}`
          }
        ],
        providerResults: [{ rawOutput: `raw api_key=${reportSecret} and ${providerSecret}` }]
      }),
      "utf8"
    );

    const config = createDefaultConfig([]);
    const codex = config.providers.find((provider) => provider.id === "codex");
    if (!codex) throw new Error("missing codex provider");
    codex.env = { PROVIDER_SECRET: providerSecret };
    codex.apiKeyEnv = "BUNDLE_PROVIDER_TOKEN";
    vi.stubEnv("BUNDLE_PROVIDER_TOKEN", providerSecret);

    const buffer = buildDoctorBundle(config, dir);
    const archiveText = zipContents(buffer);

    for (const secret of [reportSecret, providerSecret]) {
      expect(buffer.includes(Buffer.from(secret))).toBe(false);
      expect(archiveText).not.toContain(secret);
    }
    expect(archiveText).toContain("[redacted]");
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
