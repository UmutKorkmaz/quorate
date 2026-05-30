import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectAvailableProviders, findExecutable } from "../src/providers.js";

const IS_WINDOWS = process.platform === "win32";

// Create a file that findExecutable() will resolve on the current platform:
// POSIX needs an executable bit; Windows resolves via PATHEXT (e.g. .CMD).
function writeExecutable(dir: string, base: string): string {
  const filePath = join(dir, IS_WINDOWS ? `${base}.CMD` : base);
  writeFileSync(filePath, IS_WINDOWS ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n", "utf8");
  if (!IS_WINDOWS) chmodSync(filePath, 0o755);
  return filePath;
}

describe("detectAvailableProviders", () => {
  it("detects commands from PATH without executing them", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-test-"));
    writeExecutable(dir, "codex");

    const [detected] = detectAvailableProviders(
      [{ id: "codex", command: "codex", roles: ["maintainer"] }],
      { PATH: dir }
    );

    expect(detected.id).toBe("codex");
    expect(detected.available).toBe(true);
    expect(detected.path).toBeDefined();
    expect(detected.path?.toLowerCase()).toContain("codex");
  });

  it("marks unavailable providers without throwing", () => {
    const [detected] = detectAvailableProviders(
      [{ id: "missing", command: "missing-ai", roles: ["qa"] }],
      { PATH: "" }
    );

    expect(detected.available).toBe(false);
    expect(detected.path).toBeUndefined();
  });
});

describe("findExecutable path joining", () => {
  it("builds candidates with node:path join (no hardcoded slash)", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-join-"));
    writeExecutable(dir, "joiner");

    const found = findExecutable("joiner", { PATH: dir });
    expect(found).toBeDefined();
    expect(found).toContain(dir);
    expect(found?.toLowerCase()).toContain("joiner");

    // A trailing separator in a PATH entry must not produce a doubled separator;
    // node:path join collapses it, so resolution still finds the same executable.
    const sep = IS_WINDOWS ? "\\" : "/";
    const found2 = findExecutable("joiner", { PATH: `${dir}${sep}` });
    expect(found2).toBe(found);
  });
});
