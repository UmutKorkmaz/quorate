import { describe, expect, it } from "vitest";
import { parseConfig, serializeConfig } from "../src/config.js";

describe("config", () => {
  it("parses provider and GitHub settings", () => {
    const config = parseConfig(`
councils:
  - architect
providers:
  - id: codex
    type: cli
    command: codex
    enabled: true
    roles: [maintainer]
github:
  commentMode: update
  failOn: medium
  runnerMode: cli
`);

    expect(config.councils).toEqual(["architect"]);
    expect(config.providers[0]).toMatchObject({
      id: "codex",
      command: "codex",
      enabled: true,
      roles: ["maintainer"]
    });
    expect(config.github.failOn).toBe("medium");
  });

  it("serializes valid default-shaped YAML", () => {
    const config = parseConfig("{}");
    expect(serializeConfig(config)).toContain("providers:");
    expect(config.providers.some((provider) => provider.id === "heuristic")).toBe(true);
  });

  it("parses github.failOnDegraded when present", () => {
    const config = parseConfig(`
github:
  failOn: high
  failOnDegraded: true
`);

    expect(config.github.failOnDegraded).toBe(true);
  });

  it("defaults github.failOnDegraded to false", () => {
    const config = parseConfig("{}");
    expect(config.github.failOnDegraded).toBe(false);
  });

  it("parses github.inlineComments, inlineCommentLimit and gate when present", () => {
    const config = parseConfig(`
github:
  failOn: high
  inlineComments: true
  inlineCommentLimit: 10
  gate:
    severity: medium
    minAgreement: 2
`);

    expect(config.github.inlineComments).toBe(true);
    expect(config.github.inlineCommentLimit).toBe(10);
    expect(config.github.gate).toEqual({ severity: "medium", minAgreement: 2 });
  });

  it("leaves the new github fields undefined when absent", () => {
    const config = parseConfig("{}");
    expect(config.github.inlineComments).toBeUndefined();
    expect(config.github.inlineCommentLimit).toBeUndefined();
    expect(config.github.gate).toBeUndefined();
  });
});
