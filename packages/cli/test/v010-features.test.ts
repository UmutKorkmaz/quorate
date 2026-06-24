import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  it("scaffolds and lists custom packs", async () => {
    const output = captureLog();
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "quorate", "--cwd", dir, "pack", "scaffold", "org-rules"], { from: "node" });
    expect(existsSync(resolve(dir, ".quorate", "packs", "org-rules.yml"))).toBe(true);

    output.length = 0;
    await program.parseAsync(["node", "quorate", "--cwd", dir, "pack", "list", "--json"], { from: "node" });
    const rows = JSON.parse(output.join("\n")) as Array<{ id: string; source: string }>;
    expect(rows).toContainEqual(expect.objectContaining({ id: "org-rules", source: "custom" }));
  });
});
