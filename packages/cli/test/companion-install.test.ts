import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findAppBundle,
  installApp,
  installCompanion,
  installFromLocal,
  installFromRelease,
  selectAsset,
  verifySha256
} from "../src/companion-install.js";
import { createHash } from "node:crypto";

describe("selectAsset", () => {
  it("picks the matching arch zip + sha", () => {
    const assets = [
      { name: "QuorateIsland-arm64.zip" },
      { name: "QuorateIsland-arm64.zip.sha256" },
      { name: "QuorateIsland-x64.zip" }
    ];
    const arm = selectAsset(assets, "arm64");
    expect(arm?.zip).toBe("QuorateIsland-arm64.zip");
    expect(arm?.sha).toBe("QuorateIsland-arm64.zip.sha256");
  });

  it("returns undefined when no matching zip exists", () => {
    expect(selectAsset([{ name: "other.zip" }], "arm64")).toBeUndefined();
  });
});

describe("verifySha256", () => {
  it("matches a correct digest and rejects a wrong one", () => {
    const buf = new TextEncoder().encode("hello").buffer as ArrayBuffer;
    const correct = createHash("sha256").update(Buffer.from(buf)).digest("hex");
    expect(verifySha256(buf, correct)).toBe(true);
    expect(verifySha256(buf, "0".repeat(64))).toBe(false);
  });

  it("rejects a malformed digest length", () => {
    expect(verifySha256(new ArrayBuffer(0), "short")).toBe(false);
  });
});

describe("installApp refuse-overwrite", () => {
  it("refuses to overwrite an existing app without --force", () => {
    // Arrange — fake an existing install.
    const dir = mkdtempSync(join(tmpdir(), "companion-"));
    const existing = join(dir, "QuorateIsland.app");
    mkdirSync(join(existing, "Contents", "MacOS"), { recursive: true });

    // Act
    const result = installApp("/nowhere", { dir });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Refusing to overwrite");
  });

  it("installs by renaming when no app exists, creating the target dir", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "companion-"));
    const src = join(dir, "built");
    mkdirSync(join(src, "Contents", "MacOS"), { recursive: true });
    writeFileSync(join(src, "Contents", "Info.plist"), "<plist/>");

    // Act — target a fresh dir under temp.
    const fresh = join(dir, "fresh-target");
    const result = installApp(src, { dir: fresh });

    // Assert
    expect(result.ok).toBe(true);
    expect(existsSync(join(fresh, "QuorateIsland.app", "Contents", "Info.plist"))).toBe(true);
  });
});

describe("findAppBundle", () => {
  it("finds the app at the root or one level deep", () => {
    const dir = mkdtempSync(join(tmpdir(), "companion-find-"));
    const nested = join(dir, "top");
    mkdirSync(join(nested, "QuorateIsland.app", "Contents"), { recursive: true });
    writeFileSync(join(nested, "QuorateIsland.app", "Contents", "Info.plist"), "<x/>");
    expect(findAppBundle(dir)).toContain("QuorateIsland.app");
  });

  it("returns undefined when no app is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "companion-find-"));
    expect(findAppBundle(dir)).toBeUndefined();
  });
});

describe("installCompanion platform gate", () => {
  it("returns the macOS-only message on other platforms", async () => {
    const result = await installCompanion({ deps: { platform: "linux" } });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("macOS-only");
  });
});

describe("installFromRelease with injected fetch + exec", () => {
  it("reports a clear message when the release has no matching asset", async () => {
    const deps = {
      fetch: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ assets: [{ name: "other.zip" }] })).buffer as ArrayBuffer
      })
    };
    const result = await installFromRelease({ deps });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no QuorateIsland");
  });

  it("reports a clear message when the release fetch fails", async () => {
    const deps = {
      fetch: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })
    };
    const result = await installFromRelease({ deps });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("--from-local");
  });
});

describe("installFromLocal with injected exec", () => {
  it("returns a clear error when the native source is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "companion-local-"));
    const result = await installFromLocal(dir);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("No native app source");
  });
});
