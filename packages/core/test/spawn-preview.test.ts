import { describe, expect, it } from "vitest";
import { formatSpawnArgv } from "../src/cli-provider.js";
import { buildPlannedLanes } from "../src/council.js";
import type { ProviderConfig, QuorateConfig } from "../src/types.js";

function cliProvider(id: string, args: string[], roles: string[]): ProviderConfig {
  return {
    id,
    type: "cli",
    command: id,
    args,
    roles,
    enabled: true,
    inputMode: args.some((arg) => arg.includes("{promptFile}")) ? "prompt-file" : "stdin"
  };
}

describe("formatSpawnArgv", () => {
  it("summarizes argv with preview placeholders and stdin note", () => {
    const provider = cliProvider(
      "grok",
      ["--permission-mode", "plan", "--prompt-file", "{promptFile}"],
      ["architect"]
    );
    const summary = formatSpawnArgv(provider, "architect", {
      mode: "review",
      subject: "Auth changes",
      repoPath: "/repo"
    });
    expect(summary).toContain("grok --permission-mode plan --prompt-file <prompt.md> <stdin>");
  });
});

describe("buildPlannedLanes", () => {
  it("expands enabled providers across their roles", () => {
    const config: QuorateConfig = {
      councils: ["architect", "qa"],
      providers: [
        cliProvider("droid", ["exec"], ["qa"]),
        cliProvider("kilo", ["run"], ["architect"])
      ],
      github: { commentMode: "update", failOn: "high", runnerMode: "auto", failOnDegraded: false }
    };
    expect(buildPlannedLanes(config)).toEqual([
      { provider: config.providers[0], role: "qa" },
      { provider: config.providers[1], role: "architect" }
    ]);
  });
});