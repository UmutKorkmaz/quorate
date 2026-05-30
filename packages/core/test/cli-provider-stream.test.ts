import { describe, expect, it } from "vitest";
import { runCliProvider } from "../src/cli-provider.js";

describe("runCliProvider streaming", () => {
  it("invokes onChunk with stdout text as it arrives", async () => {
    // Print two distinct lines so we get at least one stdout chunk.
    const script = "process.stdout.write('chunk-alpha\\n');process.stdout.write('chunk-beta\\n')";
    const chunks: Array<{ stream: "stdout" | "stderr"; text: string }> = [];

    const result = await runCliProvider(
      {
        id: "node",
        type: "cli",
        command: process.execPath,
        args: ["-e", script],
        inputMode: "none",
        timeoutMs: 10_000
      },
      "maintainer",
      { mode: "review", subject: "streaming" },
      { onChunk: (stream, text) => chunks.push({ stream, text }) }
    );

    expect(result.status).toBe("ok");
    const combined = chunks.map((entry) => entry.text).join("");
    expect(combined).toContain("chunk-alpha");
    expect(combined).toContain("chunk-beta");
    expect(chunks.every((entry) => entry.stream === "stdout" || entry.stream === "stderr")).toBe(true);
  });
});
