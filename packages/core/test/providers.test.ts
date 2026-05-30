import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectAvailableProviders, findExecutable } from "../src/providers.js";

describe("detectAvailableProviders", () => {
  it("detects commands from PATH without executing them", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-test-"));
    const commandPath = join(dir, "codex");
    writeFileSync(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(commandPath, 0o755);

    const [detected] = detectAvailableProviders(
      [{ id: "codex", command: "codex", roles: ["maintainer"] }],
      { PATH: dir }
    );

    expect(detected).toMatchObject({
      id: "codex",
      command: "codex",
      path: commandPath,
      available: true
    });
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
  it("builds candidates with the platform separator (regression for hardcoded slash)", () => {
    // On POSIX the separator is "/"; this asserts we no longer hardcode "/" via
    // string interpolation and instead use node:path join. A found executable
    // path must contain the joined directory + command, not a double separator.
    const dir = mkdtempSync(join(tmpdir(), "quorate-join-"));
    const commandPath = join(dir, "joiner");
    writeFileSync(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(commandPath, 0o755);

    const found = findExecutable("joiner", { PATH: dir });
    expect(found).toBe(join(dir, "joiner"));
    // node:path join collapses redundant separators; a hardcoded `${dir}/...`
    // would produce a different string when dir already ends with a separator.
    const found2 = findExecutable("joiner", { PATH: `${dir}/` });
    expect(found2).toBe(join(dir, "joiner"));
  });
});
