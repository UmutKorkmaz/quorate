import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliProvider } from "../src/cli-provider.js";

describe("runCliProvider abort", () => {
  async function waitForFile(path: string): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (!existsSync(path)) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("resolves with status 'interrupted' when the signal aborts mid-run", async () => {
    // A long sleep so the process is alive when we abort.
    const script = "setTimeout(() => process.stdout.write('done'), 60000)";
    const controller = new AbortController();

    const promise = runCliProvider(
      {
        id: "node",
        type: "cli",
        command: process.execPath,
        args: ["-e", script],
        inputMode: "none",
        timeoutMs: 120_000,
        killGraceMs: 1_000
      },
      "maintainer",
      { mode: "review", subject: "abort" },
      { signal: controller.signal }
    );

    // Give the child time to spawn, then abort.
    setTimeout(() => controller.abort(), 250);

    const result = await promise;
    expect(result.status).toBe("interrupted");
    // Not mislabeled as a provider failure.
    expect(result.status).not.toBe("error");
  });

  it("removes the abort tempdir even when interrupted", async () => {
    const marker = join(tmpdir(), `quorate-abort-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    const script = [
      "const { writeFileSync } = require('node:fs');",
      "const { dirname } = require('node:path');",
      "writeFileSync(process.argv[1], dirname(process.argv[2]));",
      "setTimeout(() => process.stdout.write('done'), 60000);"
    ].join(" ");
    const controller = new AbortController();

    const promise = runCliProvider(
      {
        id: "node",
        type: "cli",
        command: process.execPath,
        args: ["-e", script, marker, "{promptFile}"],
        inputMode: "prompt-file",
        timeoutMs: 120_000,
        killGraceMs: 1_000
      },
      "maintainer",
      { mode: "review", subject: "abort-cleanup" },
      { signal: controller.signal }
    );

    await waitForFile(marker);
    const tempDir = readFileSync(marker, "utf8");
    controller.abort();
    const result = await promise;
    expect(result.status).toBe("interrupted");

    // The exact temp dir created during this run does not survive the interrupt:
    // the `finally { rm(tempDir, { recursive: true, force: true }) }` ran on the
    // interrupted return path.
    expect(existsSync(tempDir)).toBe(false);
    rmSync(marker, { force: true });
  });
});
