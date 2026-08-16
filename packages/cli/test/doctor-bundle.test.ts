import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "@quorate/core";
import { buildDoctorBundle, createZipBuffer, redactConfig } from "../src/doctor-bundle.js";

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
});