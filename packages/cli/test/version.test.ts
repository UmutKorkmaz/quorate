import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readVersion } from "../src/version.js";

describe("readVersion", () => {
  it("matches the version in package.json (no drift)", () => {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(readVersion()).toBe(pkg.version);
  });

  it("returns a semver-shaped string", () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
