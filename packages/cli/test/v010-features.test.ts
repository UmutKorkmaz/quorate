import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultConfig, serializeConfig } from "@quorate/core";
import { buildProgram } from "../src/index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quorate-v010-"));
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function writeConfig(extra: Partial<ReturnType<typeof createDefaultConfig>> = {}): void {
  writeFileSync(
    resolve(dir, ".quorate.yml"),
    serializeConfig({
      ...createDefaultConfig([]),
      councils: ["maintainer"],
      providers: [{ id: "heuristic", type: "mock", enabled: true, roles: ["maintainer"] }],
      ...extra
    }),
    "utf8"
  );
}

function captureLog(): string[] {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
    out.push(String(message));
  });
  return out;
}

describe("v0.10 CLI feature surfaces", () => {
  it("fails before provider execution when review budget caps are exceeded", async () => {
    writeConfig({ budget: { maxChangedLines: 1 } });
    writeFileSync(
      resolve(dir, "change.diff"),
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n+newer\n",
      "utf8"
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "quorate", "--cwd", dir, "review", "--diff", "change.diff"], { from: "node" });
    expect(process.exitCode).toBe(1);
  });

  it("tests a configured provider and prints JSON", async () => {
    writeConfig();
    const output = captureLog();
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "quorate", "--cwd", dir, "provider", "test", "heuristic", "--json"], { from: "node" });
    const result = JSON.parse(output.join("\n")) as { providerId: string; status: string };
    expect(result).toMatchObject({ providerId: "heuristic", status: "ok" });
  });

  it("writes PlanCourt JSON/Markdown and ReviewGraph artifacts", async () => {
    writeConfig();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(
      [
        "node",
        "quorate",
        "--cwd",
        dir,
        "plan",
        "--write-json",
        "plan.json",
        "--write-md",
        "plan.md",
        "--write-reviewgraph",
        "graph.json",
        "--reviewgraph",
        "Add a guarded checkout flow"
      ],
      { from: "node" }
    );
    expect(existsSync(resolve(dir, "plan.json"))).toBe(true);
    expect(readFileSync(resolve(dir, "plan.md"), "utf8")).toContain("Quorate Report");
    expect(JSON.parse(readFileSync(resolve(dir, "graph.json"), "utf8")).providers).toBeDefined();
    expect(existsSync(resolve(dir, ".quorate", "last-plan-report.json"))).toBe(true);
  });

  it("keeps the persisted last report owner-only while exports keep default permissions", async () => {
    // Arrange — .quorate/last-report.json embeds full provider raw output, so
    // it must be owner-only; --write-json/--write-md destinations are chosen
    // by the user for CI tooling and keep default permissions. Same POSIX
    // gate as the history suite.
    writeConfig();
    writeFileSync(
      resolve(dir, "change.diff"),
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n",
      "utf8"
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const program = buildProgram();
    program.exitOverride();

    // Act
    await program.parseAsync(
      ["node", "quorate", "--cwd", dir, "review", "--diff", "change.diff", "--write-json", "report.json", "--write-md", "report.md"],
      { from: "node" }
    );

    // Assert — control.bin is written mode-less, so it carries exactly the
    // default creation mode regardless of the process umask.
    const control = resolve(dir, "control.bin");
    writeFileSync(control, "x", "utf8");
    const defaultMode = statSync(control).mode & 0o777;
    expect(existsSync(resolve(dir, "report.json"))).toBe(true);
    expect(statSync(resolve(dir, "report.json")).mode & 0o777).toBe(defaultMode);
    expect(statSync(resolve(dir, "report.md")).mode & 0o777).toBe(defaultMode);
    expect(statSync(resolve(dir, ".quorate", "last-report.json")).mode & 0o777).toBe(platform() === "win32" ? 0o666 : 0o600);
    if (platform() !== "win32") {
      expect(statSync(resolve(dir, ".quorate")).mode & 0o777).toBe(0o700);
    }
  });

  it("scaffolds and lists custom packs only in trusted workspaces", async () => {
    const output = captureLog();
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "quorate", "--cwd", dir, "pack", "scaffold", "org-rules"], { from: "node" });
    expect(existsSync(resolve(dir, ".quorate", "packs", "org-rules.yml"))).toBe(true);

    const previous = process.env.QUORATE_TRUST_WORKSPACE;
    try {
      delete process.env.QUORATE_TRUST_WORKSPACE;
      output.length = 0;
      await program.parseAsync(["node", "quorate", "--cwd", dir, "pack", "list", "--json"], { from: "node" });
      let rows = JSON.parse(output.join("\n")) as Array<{ id: string; source: string }>;
      expect(rows).not.toContainEqual(expect.objectContaining({ id: "org-rules" }));

      process.env.QUORATE_TRUST_WORKSPACE = "1";
      output.length = 0;
      await program.parseAsync(["node", "quorate", "--cwd", dir, "pack", "list", "--json"], { from: "node" });
      rows = JSON.parse(output.join("\n")) as Array<{ id: string; source: string }>;
      expect(rows).toContainEqual(expect.objectContaining({ id: "org-rules", source: "custom" }));
    } finally {
      if (previous !== undefined) process.env.QUORATE_TRUST_WORKSPACE = previous;
      else delete process.env.QUORATE_TRUST_WORKSPACE;
    }
  });
});
