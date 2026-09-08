import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultConfig, serializeConfig, validateDecisionRecord } from "@quorate/core";
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
  it.each([false, true])("preserves required adaptive roles in CLI review (json=%s)", async (json) => {
    writeConfig({ councils: ["security", "maintainer"], providers: [{ id: "fixture", type: "cli", enabled: true,
      command: process.execPath, args: ["-e", "process.stdin.resume(); process.stdin.on('end', () => console.log('[]'));"], roles: ["security", "maintainer"] }],
      execution: { mode: "adaptive", maxParallelProviders: 1 } });
    mkdirSync(resolve(dir, ".quorate"));
    writeFileSync(resolve(dir, ".quorate/policy.yml"), "roles_required: [security]\nverdict:\n  fail_on: never\n");
    writeFileSync(resolve(dir, "change.diff"), "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n");
    captureLog();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await buildProgram().parseAsync(["node", "quorate", "--cwd", dir, "review", "--diff", "change.diff", "--write-json", "report.json", ...(json ? ["--json"] : [])], { from: "node" });
    const report = JSON.parse(readFileSync(resolve(dir, "report.json"), "utf8"));
    expect(report.metadata.routing.selected).toContainEqual(expect.objectContaining({ providerId: "fixture", role: "security", reason: "Required by policy" }));
    expect(report.metadata.decision.coverage.completed).toContain("fixture:security");
  });

  it("exports the final decision and verifies its exact input without claiming a diff file describes the checkout", async () => {
    writeConfig();
    writeFileSync(resolve(dir, "change.diff"), "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n");
    captureLog();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await buildProgram().parseAsync(["node", "quorate", "--cwd", dir, "review", "--diff", "change.diff", "--fail-on", "never", "--write-json", "report.json", "--write-receipt", "receipt.json"], { from: "node" });
    const receipt = JSON.parse(readFileSync(resolve(dir, "receipt.json"), "utf8"));
    expect(validateDecisionRecord(receipt)).toBe(true);
    expect(receipt.source).toEqual({ kind: "diff" });
    expect(receipt.policy.value.failOn).toBe("never");
    expect(JSON.parse(readFileSync(resolve(dir, "report.json"), "utf8")).metadata.decision).toEqual(receipt);
    expect(JSON.parse(readFileSync(resolve(dir, ".quorate", "decision.json"), "utf8"))).toEqual(receipt);
    await buildProgram().parseAsync(["node", "quorate", "--cwd", dir, "audit", "verify", "--receipt", "receipt.json", "--diff", "change.diff", "--json"], { from: "node" });
    expect(process.exitCode).toBeUndefined();
    writeFileSync(resolve(dir, "change.diff"), "changed input");
    await buildProgram().parseAsync(["node", "quorate", "--cwd", dir, "audit", "verify", "--receipt", "receipt.json", "--diff", "change.diff", "--json"], { from: "node" });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    await buildProgram().parseAsync(["node", "quorate", "--cwd", dir, "audit", "verify", "--receipt", "receipt.json", "--current", "--json"], { from: "node" });
    expect(process.exitCode).toBe(1);
  });

  it("runs and replays the offline setup demo with blocked and passing exit codes", async () => {
    const output = captureLog();
    const target = resolve(dir, "demo");
    await buildProgram().parseAsync(["node", "quorate", "--cwd", dir, "setup", "demo", "demo"], { from: "node" });
    expect(output.join("\n")).toContain("3. PASSED");
    expect(output.join("\n")).toContain(target);
    expect(process.exitCode).toBeUndefined();
    await buildProgram().parseAsync(["node", "quorate", "--cwd", target, "supply-chain", "scan", "--diff", "before.diff", "--gate"], { from: "node" });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    await buildProgram().parseAsync(["node", "quorate", "--cwd", target, "supply-chain", "scan", "--diff", "after.diff", "--gate"], { from: "node" });
    expect(process.exitCode).toBeUndefined();
  });

  it("refuses stale editor fix handoffs before opening a terminal or taking a snapshot", async () => {
    mkdirSync(resolve(dir, ".quorate"));
    writeFileSync(resolve(dir, ".quorate", "last-report.json"), JSON.stringify({
      metadata: { reviewId: "current", generatedAt: "2026-09-08T12:00:00Z" },
      findings: [{ fingerprint: "finding", file: "a.ts", severity: "high", title: "Fix this", body: "detail" }]
    }));
    await expect(buildProgram().parseAsync([
      "node", "quorate", "--cwd", dir, "fix", "--report-id", "previous", "--report-generated-at", "2026-09-08T12:00:00Z", "--finding-fingerprint", "finding"
    ], { from: "node" })).rejects.toThrow(/saved review changed/);
    expect(existsSync(resolve(dir, ".quorate", "fix"))).toBe(false);
    captureLog();
    await buildProgram().parseAsync([
      "node", "quorate", "--cwd", dir, "fix", "--list", "--report-id", "current", "--report-generated-at", "2026-09-08T12:00:00Z", "--finding-fingerprint", "finding"
    ], { from: "node" });
    expect(existsSync(resolve(dir, ".quorate", "fix"))).toBe(false);
  });

  it("preserves doctor risk failure status when JSON output is selected", async () => {
    writeConfig();
    const output = captureLog();
    for (const format of [[], ["--json"]]) {
      process.exitCode = undefined;
      output.length = 0;
      await buildProgram().parseAsync(["node", "quorate", "--cwd", dir, "doctor", "--risk", ...format], { from: "node" });
      expect(process.exitCode).toBe(1);
      if (format.length > 0) expect(JSON.parse(output.join("\n")).items).toContainEqual(expect.objectContaining({ level: "risk", label: "Real providers" }));
      else expect(output.join("\n")).toContain("Real providers");
    }
  });

  it("prints a structured doctor readiness report without dumping provider configuration", async () => {
    writeConfig();
    const output = captureLog();
    await buildProgram().parseAsync(["node", "quorate", "--cwd", dir, "doctor", "--json"], { from: "node" });
    const report = JSON.parse(output.join("\n"));
    expect(report).toMatchObject({ schema: 1, status: "degraded", verification: "configuration" });
    expect(report.environment.node.supported).toBe(true);
    expect(report.nextSteps).toContain("quorate setup demo");
    expect(report).not.toHaveProperty("config");
    expect(process.exitCode).toBeUndefined();
  });

  it("rejects a symlinked review report destination without changing the outside victim", async () => {
    writeConfig();
    writeFileSync(resolve(dir, "change.diff"), "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n", "utf8");
    const outside = mkdtempSync(join(tmpdir(), "quorate-review-outside-"));
    const victim = resolve(outside, "report.json");
    writeFileSync(victim, "outside remains intact\n", "utf8");
    // The parent is real; only the fixed application-owned destination is redirected.
    mkdirSync(resolve(dir, ".quorate"));
    symlinkSync(victim, resolve(dir, ".quorate", "last-report.json"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const program = buildProgram();
    program.exitOverride();

    await expect(program.parseAsync(["node", "quorate", "--cwd", dir, "review", "--diff", "change.diff"], { from: "node" })).rejects.toThrow(/symbolic link/i);
    expect(readFileSync(victim, "utf8")).toBe("outside remains intact\n");
    rmSync(outside, { recursive: true, force: true });
  });

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

  it("rejects a symlinked plan report destination without changing the outside victim", async () => {
    writeConfig();
    const outside = mkdtempSync(join(tmpdir(), "quorate-plan-outside-"));
    const victim = resolve(outside, "report.json");
    writeFileSync(victim, "outside remains intact\n", "utf8");
    mkdirSync(resolve(dir, ".quorate"));
    symlinkSync(victim, resolve(dir, ".quorate", "last-plan-report.json"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const program = buildProgram();
    program.exitOverride();

    await expect(program.parseAsync(["node", "quorate", "--cwd", dir, "plan", "Add a guarded checkout flow"], { from: "node" })).rejects.toThrow(/symbolic link/i);
    expect(readFileSync(victim, "utf8")).toBe("outside remains intact\n");
    rmSync(outside, { recursive: true, force: true });
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
