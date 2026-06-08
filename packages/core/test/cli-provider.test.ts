import { describe, expect, it } from "vitest";
import { runCliProvider } from "../src/cli-provider.js";

describe("runCliProvider safety", () => {
  it("refuses enabled CLI providers without headless args", async () => {
    const result = await runCliProvider(
      {
        id: "node",
        type: "cli",
        command: "node",
        args: []
      },
      "maintainer",
      {
        mode: "plan",
        subject: "safe shell"
      }
    );

    expect(result.status).toBe("error");
    expect(result.error).toContain("has no headless args configured");
  });

  it("rejects dangerous provider args by default", async () => {
    const result = await runCliProvider(
      {
        id: "node",
        type: "cli",
        command: "node",
        args: ["--yolo"]
      },
      "maintainer",
      {
        mode: "plan",
        subject: "safe shell"
      }
    );

    expect(result.status).toBe("error");
    expect(result.error).toContain("dangerous argument");
  });

  it("does not crash when a provider closes stdin before the prompt is written", async () => {
    // Child exits immediately without reading stdin. The prompt (driven by a
    // large diff) exceeds the OS pipe buffer, so the write fails with EPIPE.
    // Without a stdin 'error' handler this emits an unhandled 'error' event and
    // takes the whole process down. The run must resolve, not throw.
    const bigDiff = `diff --git a/big.txt b/big.txt\n${"+x\n".repeat(60_000)}`;
    const result = await runCliProvider(
      {
        id: "node",
        type: "cli",
        command: "node",
        args: ["-e", "process.exit(0)"],
        inputMode: "stdin"
      },
      "maintainer",
      {
        mode: "review",
        subject: "epipe regression",
        diff: bigDiff
      }
    );

    // The child exited 0 having read nothing; we only assert the run completed
    // without throwing an unhandled EPIPE.
    expect(["ok", "error"]).toContain(result.status);
  });
});
