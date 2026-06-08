import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commandNameFromRelativePath,
  discoverCustomCommands,
  parseCustomCommandFile,
  renderCustomPrompt,
  workspaceCommandsTrusted
} from "../src/custom-commands.js";
import { buildCommandRegistry, resolveCommand } from "../src/tui/commands.js";

describe("custom commands", () => {
  it("parses frontmatter description and argument-hint", () => {
    const definition = parseCustomCommandFile(
      `---
description: Security pass on the diff
argument-hint: [focus]
mode: review
---
Review for injection risks.
{{args}}`,
      "security-review",
      "/tmp/security-review.md"
    );
    expect(definition.description).toBe("Security pass on the diff");
    expect(definition.argHint).toBe("[focus]");
    expect(definition.mode).toBe("review");
    expect(definition.body).toContain("Review for injection risks.");
  });

  it("namespaces nested command files with colon syntax", () => {
    expect(commandNameFromRelativePath("security-review.md")).toBe("security-review");
    expect(commandNameFromRelativePath("frontend/component.md")).toBe("frontend:component");
  });

  it("discovers workspace commands and registers them without overriding built-ins", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorate-cmd-"));
    const commandsDir = join(dir, ".quorate", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, "security-review.md"),
      `---
description: Custom security review
---
Focus on auth boundaries.`,
      "utf8"
    );

    // Untrusted by default: a repo's commands are NOT loaded without opt-in.
    expect(discoverCustomCommands(dir)).toHaveLength(0);
    expect(resolveCommand("security-review", buildCommandRegistry(dir))).toBeUndefined();

    // Trusted: opting in loads them.
    const discovered = discoverCustomCommands(dir, true);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.name).toBe("security-review");

    const registry = buildCommandRegistry(dir, true);
    expect(resolveCommand("security-review", registry)?.custom).toBe(true);
    expect(resolveCommand("review", registry)?.custom).toBeUndefined();
  });

  it("treats QUORATE_TRUST_WORKSPACE as the trust signal", () => {
    expect(workspaceCommandsTrusted({})).toBe(false);
    expect(workspaceCommandsTrusted({ QUORATE_TRUST_WORKSPACE: "0" })).toBe(false);
    expect(workspaceCommandsTrusted({ QUORATE_TRUST_WORKSPACE: "false" })).toBe(false);
    expect(workspaceCommandsTrusted({ QUORATE_TRUST_WORKSPACE: "1" })).toBe(true);
    expect(workspaceCommandsTrusted({ QUORATE_TRUST_WORKSPACE: "yes" })).toBe(true);
  });

  it("renders args into custom prompts", () => {
    expect(renderCustomPrompt("Hello {{args}}", "world")).toBe("Hello world");
    expect(renderCustomPrompt("Hello", "world")).toBe("Hello\n\nworld");
  });
});