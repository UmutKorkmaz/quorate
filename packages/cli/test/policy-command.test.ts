import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parsePolicyYaml, type QuorateConfig } from "@quorate/core";

import { loadPolicyFile, policyDoctor, writeStarterPolicy } from "../src/policy-command.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "quorate-policy-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function config(overrides: Partial<QuorateConfig> = {}): QuorateConfig {
  return {
    councils: ["security", "maintainer"],
    providers: [
      { id: "glm", type: "api", model: "glm-5.1", roles: ["security"], enabled: true },
      { id: "heuristic", type: "mock", roles: ["maintainer"], enabled: true }
    ],
    github: { commentMode: "update", failOn: "high", runnerMode: "auto" },
    ...overrides
  };
}

describe("writeStarterPolicy / loadPolicyFile", () => {
  it("writes a valid starter policy and reads it back", () => {
    const { path, overwritten } = writeStarterPolicy(dir);
    expect(overwritten).toBe(false);
    expect(path).toBe(resolve(dir, ".quorate", "policy.yml"));
    // the starter file must parse cleanly
    const parsed = parsePolicyYaml(readFileSync(path, "utf8"));
    expect(parsed.failOn).toBe("high");
    expect(parsed.failOnDegraded).toBe(true);
    expect(parsed.minRealProviders).toBe(1);
    expect(loadPolicyFile(dir)?.failOn).toBe("high");
  });

  it("refuses to overwrite without --force", () => {
    writeStarterPolicy(dir);
    expect(() => writeStarterPolicy(dir)).toThrow(/already exists/i);
    expect(writeStarterPolicy(dir, { force: true }).overwritten).toBe(true);
  });

  it("returns null when no policy file exists", () => {
    expect(loadPolicyFile(dir)).toBeNull();
  });
});

describe("policyDoctor", () => {
  it("passes when required roles are covered by enabled providers", () => {
    const policy = { ...parsePolicyYaml("version: 1"), rolesRequired: ["security"], minRealProviders: 1 };
    expect(policyDoctor(config(), policy).warnings).toHaveLength(0);
  });

  it("warns when a required role has no enabled provider", () => {
    const policy = { ...parsePolicyYaml("version: 1"), rolesRequired: ["performance"] };
    const { warnings } = policyDoctor(config({ councils: ["security", "maintainer", "performance"] }), policy);
    expect(warnings.join(" ")).toMatch(/performance.*no enabled provider/i);
  });

  it("warns when the provider floor is unreachable", () => {
    const policy = { ...parsePolicyYaml("version: 1"), minRealProviders: 2 };
    const { warnings } = policyDoctor(config(), policy); // only 1 real (api) provider enabled
    expect(warnings.join(" ")).toMatch(/min_real_providers/i);
  });
});
