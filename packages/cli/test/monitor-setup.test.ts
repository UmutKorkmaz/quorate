import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";
import fsActual from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  applyRemove,
  applySetup,
  buildClaudeHookCommand,
  computeSetupPlan,
  detectCliCapabilities,
  mergeClaudeHooks,
  QUORATE_HOOK_MARKER,
  readClaudeSettings,
  renderCapabilityTable,
  stripClaudeHooks
} from "../src/monitor-setup.js";

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync), writeFileSync: vi.fn(actual.writeFileSync) };
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "quorate-setup-"));
}

function writeFixture(dir: string, json: unknown): string {
  const path = join(dir, "settings.json");
  writeFileSync(path, JSON.stringify(json, null, 2), "utf8");
  return path;
}

describe("mergeClaudeHooks", () => {
  it("appends a Quotate hook per event when absent, preserving existing keys", () => {
    // Arrange — a populated settings with an unrelated key + one existing hook group.
    const before = {
      $schema: "https://schema.example/claude.json",
      hooks: {
        Notification: [{ matcher: "*", hooks: [{ type: "command", command: "echo existing" }] }]
      }
    };

    // Act
    const after = mergeClaudeHooks(before, "/abs/quorate");

    // Assert — unrelated key preserved, existing hook preserved, Quorate appended.
    expect(after.$schema).toBe(before.$schema);
    expect(after.hooks?.Notification).toHaveLength(2);
    expect(after.hooks?.Notification?.[0]?.hooks?.[0]?.command).toBe("echo existing");
    expect(after.hooks?.Notification?.[1]?.hooks?.[0]?.command).toContain(QUORATE_HOOK_MARKER);
    // All ten events present.
    expect(Object.keys(after.hooks ?? {}).sort()).toEqual(
      ["Notification", "PermissionRequest", "PostToolUse", "PreToolUse", "SessionEnd", "SessionStart", "Stop", "SubagentStart", "SubagentStop", "UserPromptSubmit"]
    );
  });

  it("is idempotent — merging twice does not duplicate Quorate entries", () => {
    const before = { hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: "echo x" }] }] } };
    const once = mergeClaudeHooks(before, "/abs/quorate");
    const twice = mergeClaudeHooks(once, "/abs/quorate");
    for (const event of Object.keys(twice.hooks ?? {})) {
      const quorateCount = (twice.hooks?.[event] ?? []).filter((g) =>
        g.hooks.some((h) => h.command.includes(QUORATE_HOOK_MARKER) && h.command.includes(`--event ${event}`))
      ).length;
      expect(quorateCount).toBe(1);
    }
    // The original non-Quorate Stop hook is still there exactly once.
    expect(twice.hooks?.Stop?.[0]?.hooks?.[0]?.command).toBe("echo x");
  });

  it("gives PermissionRequest a generous timeout", () => {
    const after = mergeClaudeHooks({}, "/abs/quorate");
    const group = after.hooks?.PermissionRequest?.[0];
    expect(group?.hooks?.[0]?.timeout).toBe(120);
  });

  it("does not mutate the input", () => {
    const before = { hooks: { Stop: [] } };
    const snapshot = JSON.stringify(before);
    mergeClaudeHooks(before, "/abs/quorate");
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("stripClaudeHooks", () => {
  it("removes only Quorate-tagged entries, drops empty groups/hooks", () => {
    const merged = mergeClaudeHooks({ hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: "echo keep" }] }] } }, "/abs/quorate");
    const stripped = stripClaudeHooks(merged);
    // Quorate entries gone; the keep hook survives.
    expect(stripped.hooks?.Stop).toEqual([{ matcher: "*", hooks: [{ type: "command", command: "echo keep" }] }]);
    // Events that ONLY had Quorate entries are gone entirely.
    expect(stripped.hooks?.SessionStart).toBeUndefined();
  });

  it("drops the hooks object entirely when nothing remains", () => {
    const merged = mergeClaudeHooks({}, "/abs/quorate");
    const stripped = stripClaudeHooks(merged);
    expect(stripped.hooks).toBeUndefined();
  });
});

describe("buildClaudeHookCommand", () => {
  it.skipIf(process.platform === "win32")("treats shell metacharacters in the executable path as literal data", () => {
    const dir = tempDir();
    try {
      const binary = join(dir, "quorate $(printf expanded) `printf expanded` '$HOME' \\\"path");
      writeFileSync(binary, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
      chmodSync(binary, 0o700);
      const result = spawnSync("/bin/sh", ["-c", buildClaudeHookCommand(binary, "Stop")], { encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n")).toEqual(["hook-report", "--source", "claude", "--event", "Stop"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("embeds the binary path, the event, and always exits 0", () => {
    const cmd = buildClaudeHookCommand("/abs/quorate", "Stop");
    expect(cmd.startsWith("/bin/sh -c '")).toBe(true);
    expect(cmd).toContain('Q="/abs/quorate"');
    expect(cmd).toContain("--source claude");
    expect(cmd).toContain("--event Stop");
    expect(cmd.trim().endsWith("exit 0'")).toBe(true);
  });
});

describe("detectCliCapabilities + renderCapabilityTable", () => {
  it("classifies Claude hooks, Codex shim, and scan-only integrations", () => {
    const caps = detectCliCapabilities({ claude: true, codex: true, gemini: false, qwen: false, kimi: false, opencode: false, crush: false, goose: false });
    const claude = caps.find((c) => c.kind === "claude");
    const codex = caps.find((c) => c.kind === "codex");
    const gemini = caps.find((c) => c.kind === "gemini");
    expect(claude?.hookSupport).toBe("full");
    expect(codex?.hookSupport).toBe("shim");
    expect(gemini?.hookSupport).toBe("scan-only");
  });

  it("renders a readable table", () => {
    const table = renderCapabilityTable(detectCliCapabilities({ claude: true }));
    expect(table).toContain("claude");
    expect(table).toContain("installed");
    expect(table).toContain("full hooks");
  });
});

describe("applySetup + applyRemove (fixture I/O)", () => {
  it("writes the merged settings and creates a backup; Claude path may not pre-exist", () => {
    // Arrange
    const dir = tempDir();
    const claudePath = join(dir, "settings.json");
    const plan = computeSetupPlan({ claudePath, codexPath: join(dir, "none.toml"), codexNotifyOccupied: true, dryRun: false });

    // Act
    const result = applySetup(plan, "/abs/quorate");

    // Assert
    expect(result.applied).toBe(true);
    const written = readClaudeSettings(claudePath);
    expect(written.hooks?.SessionStart?.[0]?.hooks?.[0]?.command).toContain(QUORATE_HOOK_MARKER);
  });

  it("preserves existing content and creates a backup when settings already exist", () => {
    // Arrange
    const dir = tempDir();
    const claudePath = writeFixture(dir, { env: { FOO: "bar" }, hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: "echo orig" }] }] } });
    const plan = computeSetupPlan({ claudePath, codexPath: join(dir, "none.toml"), codexNotifyOccupied: true, dryRun: false });

    // Act
    const result = applySetup(plan, "/abs/quorate");

    // Assert
    expect(result.applied).toBe(true);
    expect(result.backup).toBeDefined();
    const backup = JSON.parse(readFileSync(result.backup!, "utf8"));
    expect(backup.env.FOO).toBe("bar"); // backup is the pre-image
    const written = readClaudeSettings(claudePath);
    expect(written.env?.FOO).toBe("bar"); // preserved
    expect(written.hooks?.Stop).toHaveLength(2); // original + quorate
  });

  it("dry-run never writes", () => {
    const dir = tempDir();
    const claudePath = join(dir, "settings.json");
    const plan = computeSetupPlan({ claudePath, codexPath: join(dir, "none.toml"), codexNotifyOccupied: true, dryRun: true });
    const result = applySetup(plan, "/abs/quorate");
    expect(result.applied).toBe(false);
    expect(() => readFileSync(claudePath, "utf8")).toThrow();
  });

  it("remove strips Quorate entries and writes a backup", () => {
    // Arrange — start from a settings that already has Quorate installed.
    const dir = tempDir();
    const claudePath = join(dir, "settings.json");
    const setupPlan = computeSetupPlan({ claudePath, codexPath: join(dir, "none.toml"), codexNotifyOccupied: true, dryRun: false });
    applySetup(setupPlan, "/abs/quorate");
    const removePlan = computeSetupPlan({ claudePath, codexPath: join(dir, "none.toml"), codexNotifyOccupied: true, dryRun: false });

    // Act
    const result = applyRemove(removePlan);

    // Assert
    expect(result.applied).toBe(true);
    const after = readClaudeSettings(claudePath);
    expect(after.hooks).toBeUndefined(); // all groups were quorate-only → dropped
  });
});

describe("computeSetupPlan codex handling", () => {
  it("skips codex when the notify slot is occupied (never clobbers)", () => {
    const plan = computeSetupPlan({ claudePath: "/none", codexPath: "/none", codexNotifyOccupied: true, dryRun: true });
    expect(plan.codex.action).toBe("skip");
    expect(plan.codex.note).toContain("occupied");
  });

  it("plans a shim when the notify key is absent", () => {
    const plan = computeSetupPlan({ claudePath: "/none", codexPath: "/none", codexNotifyOccupied: false, dryRun: true });
    expect(plan.codex.action).toBe("shim");
    expect(plan.codex.note).toContain("install");
  });
});

it("reports partial setup when Claude succeeds but Codex configuration fails", () => {
  const dir = tempDir();
  const claudePath = join(dir, "settings.json"), codexPath = join(dir, "config.toml");
  writeFileSync(codexPath, "notify = [");
  const result = applySetup(computeSetupPlan({ claudePath, codexPath, codexNotifyOccupied: false, dryRun: false }), "/abs/quorate");
  expect(result.applied).toBe(false);
  expect(result.partial).toBe(true);
  expect(result.message).toContain("Claude hooks installed; Codex setup failed");
  expect(readClaudeSettings(claudePath).hooks).toBeDefined();
  expect(readFileSync(codexPath,"utf8")).toBe("notify = [");
});


describe("safe settings preservation", () => {
  function fixture(raw: string) {
    const dir = tempDir(), path = join(dir, "settings.json"), codex = join(dir, "config.toml");
    writeFileSync(path, raw); writeFileSync(codex, "model = \"keep\"\n");
    const plan = { claude: { path, exists: true, changes: 10 }, codex: { path: codex, notifyOccupied: false, action: "shim" as const, note: "" }, dryRun: false };
    return { dir, path, codex, plan };
  }
  it.each(['{"env":1,}', 'null', '[]', '42'])("refuses invalid settings %s without writing either config", raw => {
    const f = fixture(raw);
    try {
      expect(() => readClaudeSettings(f.path)).toThrow("Cannot safely read Claude settings");
      expect(() => computeSetupPlan({ claudePath:f.path, codexPath:f.codex, dryRun:true })).toThrow();
      for (const apply of [() => applySetup(f.plan, "/fixture/quorate"), () => applyRemove(f.plan)]) {
        expect(apply().applied).toBe(false);
        expect(readFileSync(f.path, "utf8")).toBe(raw);
        expect(readFileSync(f.codex, "utf8")).toBe('model = "keep"\n');
      }
    } finally { rmSync(f.dir, {recursive:true, force:true}); }
  });
  it("backs up exact bytes and preserves unrelated keys through setup/remove", () => {
    const raw = ' { "env" : { "KEEP":"yes" } }\n\n', f=fixture(raw);
    try {
      const setup=applySetup(f.plan,"/fixture/quorate");
      expect(setup.applied).toBe(true); expect(readFileSync(setup.backup!,"utf8")).toBe(raw);
      const installed=readFileSync(f.path);
      const removed=applyRemove(f.plan);
      expect(removed.applied).toBe(true); expect(readFileSync(removed.backup!)).toEqual(installed);
      expect(readClaudeSettings(f.path).env).toEqual({KEEP:"yes"});
    } finally { rmSync(f.dir,{recursive:true,force:true}); }
  });
  it("refuses an unreadable file rather than treating it as absent", () => {
    const f=fixture('{}'), read=fsActual.readFileSync;
    const spy=vi.spyOn(fs,'readFileSync').mockImplementation(((path:unknown,...args:unknown[])=> {
      if(path===f.path) throw Object.assign(new Error('denied'),{code:'EACCES'});
      return (read as Function)(path,...args);
    }) as typeof fs.readFileSync);
    try { expect(applySetup(f.plan,"/fixture/quorate").applied).toBe(false); }
    finally { spy.mockRestore(); expect(readFileSync(f.path,"utf8")).toBe('{}'); rmSync(f.dir,{recursive:true,force:true}); }
  });
  it("refuses a destination changed between snapshot and rename", () => {
    const f=fixture('{}'), write=fsActual.writeFileSync;
    const spy=vi.spyOn(fs,'writeFileSync').mockImplementation(((path:unknown,...args:unknown[])=>{
      (write as Function)(path,...args);
      if(typeof path==='string' && path.endsWith('.tmp')) { rmSync(f.path); write(f.path,'{"replacement":true}'); }
    }) as typeof fs.writeFileSync);
    try {
      expect(applySetup(f.plan,"/fixture/quorate").applied).toBe(false);
      expect(readFileSync(f.path,"utf8")).toBe('{"replacement":true}');
      expect(readFileSync(f.codex,"utf8")).toBe('model = "keep"\n');
    } finally { spy.mockRestore(); rmSync(f.dir,{recursive:true,force:true}); }
  });
});
