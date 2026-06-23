import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPackConfig, PACKS, serializeConfig } from "@quorate/core";
import { buildProgram } from "../src/index.js";

const PROGRAM_ID = "11111111111111111111111111111111";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quorate-solana-cli-"));
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

function captureConsoleLog(): string[] {
  const output: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
    output.push(String(message));
  });
  return output;
}

function writeAnchorProject(options: { idl?: boolean; quorate?: boolean; verifiable?: boolean } = {}): void {
  writeFileSync(
    join(dir, "Anchor.toml"),
    `[programs.localnet]
counter = "${PROGRAM_ID}"

[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"

[scripts]
verify_upgrade = "solana program show ${PROGRAM_ID} --url localnet"
`,
    "utf8"
  );

  mkdirSync(join(dir, "programs", "counter"), { recursive: true });
  writeFileSync(
    join(dir, "programs", "counter", "Cargo.toml"),
    `[package]
name = "counter"
version = "0.1.0"
edition = "2021"
`,
    "utf8"
  );

  mkdirSync(join(dir, "target", "deploy"), { recursive: true });
  writeFileSync(join(dir, "target", "deploy", "counter.so"), "", "utf8");
  if (options.verifiable !== false) {
    mkdirSync(join(dir, "target", "verifiable"), { recursive: true });
    writeFileSync(join(dir, "target", "verifiable", "counter-build.json"), "{}", "utf8");
  }

  if (options.idl !== false) {
    mkdirSync(join(dir, "target", "idl"), { recursive: true });
    writeFileSync(
      join(dir, "target", "idl", "counter.json"),
      JSON.stringify({ version: "0.1.0", name: "counter", metadata: { address: PROGRAM_ID } }),
      "utf8"
    );
  }

  if (options.quorate !== false) {
    writeFileSync(join(dir, ".quorate.yml"), serializeConfig(buildPackConfig(PACKS.solana, [])), "utf8");
  }
}

describe("quorate solana", () => {
  it("prints doctor JSON for a passing offline release gate", async () => {
    writeAnchorProject();
    const output = captureConsoleLog();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync(["node", "quorate", "--cwd", dir, "solana", "doctor", "--json"], { from: "node" });

    const report = JSON.parse(output.join("\n")) as { summary: { gate: string }; programs: Array<{ name: string }> };
    expect(report.summary.gate).toBe("pass");
    expect(report.programs[0]?.name).toBe("counter");
    expect(process.exitCode).toBeUndefined();
  });

  it("sets exitCode when the Solana doctor gate fails", async () => {
    writeAnchorProject({ idl: false });
    captureConsoleLog();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync(["node", "quorate", "--cwd", dir, "solana", "doctor", "--json"], { from: "node" });

    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode on warnings when Solana doctor runs in strict mode", async () => {
    writeAnchorProject({ verifiable: false });
    captureConsoleLog();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync(["node", "quorate", "--cwd", dir, "solana", "doctor", "--strict"], { from: "node" });

    expect(process.exitCode).toBe(1);
  });

  it("generates a JSON test plan that includes Quorate setup when config is missing", async () => {
    writeAnchorProject({ quorate: false });
    const output = captureConsoleLog();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync(["node", "quorate", "--cwd", dir, "solana", "test-plan", "--json"], { from: "node" });

    const plan = JSON.parse(output.join("\n")) as { items: Array<{ command: string }> };
    expect(plan.items.some((item) => item.command === "quorate init --pack solana")).toBe(true);
    expect(plan.items.some((item) => item.command === "anchor test")).toBe(true);
  });

  it.each(["doctor", "test-plan"])("rejects a missing explicit --config for solana %s", async (subcommand) => {
    writeAnchorProject();
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(["node", "quorate", "--cwd", dir, "--config", "missing.yml", "solana", subcommand, "--json"], {
        from: "node"
      })
    ).rejects.toThrow(/Config file not found: missing\.yml/);
    expect(process.exitCode).toBeUndefined();
  });
});
