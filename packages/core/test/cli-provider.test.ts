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
});
