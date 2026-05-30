import { describe, expect, it } from "vitest";
import { runCliProvider } from "../src/cli-provider.js";

describe("runCliProvider prompt-file input mode", () => {
  it("pipes the prompt file CONTENTS on stdin (not the path string)", async () => {
    // node -e reads all of stdin and echoes it back; we assert the council
    // prompt text appears in the output, proving file CONTENTS were piped.
    const script =
      "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(d)})";

    const result = await runCliProvider(
      {
        id: "node",
        type: "cli",
        command: process.execPath,
        args: ["-e", script],
        inputMode: "prompt-file",
        timeoutMs: 10_000
      },
      "maintainer",
      {
        mode: "review",
        subject: "promptfile-contents-marker"
      }
    );

    expect(result.status).toBe("ok");
    // The prompt body always contains the subject; if the PATH were piped the
    // output would be a /tmp/quorate-*/prompt.md path, not this marker.
    expect(result.rawOutput).toContain("promptfile-contents-marker");
    expect(result.rawOutput).not.toMatch(/prompt\.md$/);
  });
});
