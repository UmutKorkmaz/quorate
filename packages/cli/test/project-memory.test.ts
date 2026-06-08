import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyProjectMemoryDefaults,
  findProjectMemoryPath,
  loadProjectMemory,
  projectMemoryInspectLines,
  parseProjectMemory,
  projectDefaultsLine
} from "../src/project-memory.js";

describe("parseProjectMemory", () => {
  it("reads roles and agents from YAML frontmatter", () => {
    const parsed = parseProjectMemory(`---
roles: architect, security
agents: claude, codex
---
# Notes
`);
    expect(parsed.roles).toEqual(["architect", "security"]);
    expect(parsed.agents).toEqual(["claude", "codex"]);
  });

  it("reads providers as an alias for agents", () => {
    const parsed = parseProjectMemory(`---
providers: codex, qwen
---`);
    expect(parsed.agents).toEqual(["codex", "qwen"]);
  });

  it("reads markdown sections when frontmatter is absent", () => {
    const parsed = parseProjectMemory(`# Repo defaults

## Default roles
architect
security

## Preferred agents
claude
codex
`);
    expect(parsed.roles).toEqual(["architect", "security"]);
    expect(parsed.agents).toEqual(["claude", "codex"]);
  });
});

describe("loadProjectMemory", () => {
  it("prefers QUORATE.md over .quorate/QUORATE.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-quorate-"));
    mkdirSync(join(dir, ".quorate"));
    writeFileSync(join(dir, ".quorate", "QUORATE.md"), "---\nroles: qa\n---\n", "utf8");
    writeFileSync(join(dir, "QUORATE.md"), "---\nroles: architect\n---\n", "utf8");

    const memory = loadProjectMemory(dir);
    expect(memory?.label).toBe("QUORATE.md");
    expect(memory?.roles).toEqual(["architect"]);
  });

  it("falls back to .quorate/QUORATE.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-quorate-"));
    mkdirSync(join(dir, ".quorate"));
    writeFileSync(join(dir, ".quorate", "QUORATE.md"), "---\nagents: codex\n---\n", "utf8");

    expect(findProjectMemoryPath(dir)).toBe(join(dir, ".quorate", "QUORATE.md"));
    expect(loadProjectMemory(dir)?.agents).toEqual(["codex"]);
  });
});

describe("applyProjectMemoryDefaults", () => {
  it("applies roles and agents when the session has no overrides", () => {
    const memory = { path: "/tmp/QUORATE.md", label: "QUORATE.md", roles: ["security"], agents: ["claude"] };
    const next = applyProjectMemoryDefaults({ cwd: "/tmp" }, memory);
    expect(next.activeRoles).toEqual(["security"]);
    expect(next.activeProviders).toEqual(["claude"]);
  });

  it("does not override CLI provider selection", () => {
    const memory = { path: "/tmp/QUORATE.md", label: "QUORATE.md", agents: ["claude"] };
    const next = applyProjectMemoryDefaults({ activeProviders: ["codex"] }, memory, { providersFromCli: true });
    expect(next.activeProviders).toEqual(["codex"]);
  });
});

describe("projectMemoryInspectLines and projectDefaultsLine", () => {
  it("emits the one-line welcome hint only when defaults exist", () => {
    expect(projectDefaultsLine(undefined)).toBeUndefined();
    expect(projectDefaultsLine({ path: "/tmp/QUORATE.md", label: "QUORATE.md" })).toBeUndefined();
    expect(
      projectDefaultsLine({ path: "/tmp/QUORATE.md", label: "QUORATE.md", roles: ["architect"] })
    ).toBe("project defaults loaded");
  });

  it("summarizes project memory for /inspect", () => {
    const lines = projectMemoryInspectLines({
      path: "/tmp/QUORATE.md",
      label: "QUORATE.md",
      roles: ["architect"],
      agents: ["claude"]
    });
    const text = lines.join("\n");
    expect(text).toContain("Project memory: QUORATE.md");
    expect(text).toContain("Default roles: architect");
    expect(text).toContain("Preferred agents: claude");
    expect(text).toContain("Project defaults: loaded");
  });
});