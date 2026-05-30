import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { runCliProvider } from "../src/cli-provider.js";

describe("runCliProvider abort", () => {
  const providerTempDirPattern = /^quorate-[^-]+$/;

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
    const script = "setTimeout(() => process.stdout.write('done'), 60000)";
    const controller = new AbortController();

    // Snapshot existing quorate-* temp dirs BEFORE the run so we can prove
    // the dir THIS run created is gone afterward. `result.rawOutput` is the
    // combined stdout/stderr TEXT (never the tempDir path), so `existsSync(rawOutput)`
    // would be trivially false and assert nothing — we must inspect os.tmpdir()
    // directly. prompt-file mode forces a tempDir to be created.
    const before = new Set(
      readdirSync(tmpdir()).filter((entry) => providerTempDirPattern.test(entry))
    );

    const promise = runCliProvider(
      {
        id: "node",
        type: "cli",
        command: process.execPath,
        args: ["-e", script],
        inputMode: "prompt-file",
        timeoutMs: 120_000,
        killGraceMs: 1_000
      },
      "maintainer",
      { mode: "review", subject: "abort-cleanup" },
      { signal: controller.signal }
    );

    setTimeout(() => controller.abort(), 250);
    const result = await promise;
    expect(result.status).toBe("interrupted");

    // No quorate-* temp dir created during this run survives the interrupt:
    // the `finally { rm(tempDir, { recursive: true, force: true }) }` ran on the
    // interrupted return path.
    const after = readdirSync(tmpdir()).filter((entry) => providerTempDirPattern.test(entry));
    const leaked = after.filter((entry) => !before.has(entry));
    expect(leaked).toEqual([]);
  });
});
