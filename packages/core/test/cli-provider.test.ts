import { describe, expect, it } from "vitest";
import { runCliProvider } from "../src/cli-provider.js";

describe("runCliProvider safety", () => {
  it.each(["", "I cannot review this request.", '[{"severity":"high"}]', '[{"severity":"high","title":"Bug"},{}]'])
    ("rejects invalid review output even when the process exits successfully: %j", async (output) => {
      const result = await runCliProvider({
        id: "fixture", type: "cli", command: process.execPath,
        args: ["-e", `process.stdout.write(${JSON.stringify(output)})`], inputMode: "stdin"
      }, "security", { mode: "review", subject: "validity regression" });
      expect(result.status).toBe("error");
      expect(result.error).toMatch(/valid review/i);
    });

  it.each(["[]", "```json\n[]\n```", "No findings.", "- [high] Unsafe query (db.ts:4): Parameterize it."])
    ("accepts a complete supported review: %j", async (output) => {
      const result = await runCliProvider({
        id: "fixture", type: "cli", command: process.execPath,
        args: ["-e", `process.stdout.write(${JSON.stringify(output)})`], inputMode: "stdin"
      }, "security", { mode: "review", subject: "validity regression" });
      expect(result.status).toBe("ok");
    });

  it("rejects output truncation even if the provider handles SIGTERM and exits zero", async () => {
    const result = await runCliProvider({
      id: "fixture", type: "cli", command: process.execPath,
      args: ["-e", "process.on('SIGTERM', () => process.exit(0)); process.stdout.write('[]' + 'x'.repeat(10000)); setInterval(() => {}, 1000)"],
      inputMode: "stdin", maxOutputBytes: 64
    }, "security", { mode: "review", subject: "truncation regression" });
    expect(result.status).toBe("error");
    expect(result.summary).toContain("exceeded");
  });

  it.each(["[]", "[{}]", "{}"])("retains a reported high finding beside an unusable JSON block: %s", async (json) => {
    const output = `\`\`\`json\n${json}\n\`\`\`\n- [high] SQL injection (db.ts:4): User input reaches an unparameterized query.`;
    const result = await runCliProvider({
      id: "fixture", type: "cli", command: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(output)})`], inputMode: "stdin"
    }, "security", { mode: "review", subject: "contradictory output" });
    expect(result.status).toBe("error");
    expect(result.findings).toEqual([expect.objectContaining({ severity: "high", title: "SQL injection" })]);
  });

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
