import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPackConfig,
  buildSolanaReleaseGate,
  buildSolanaTestPlan,
  PACKS,
  serializeConfig
} from "../src/index.js";

const PROGRAM_ID = "11111111111111111111111111111111";
const MAINNET_PROGRAM_ID = "22222222222222222222222222222222";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quorate-solana-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeAnchorProject(
  options: {
    idl?: boolean;
    idlAddress?: string;
    quorate?: boolean;
    verifiable?: boolean;
    providerCluster?: string;
    mainnetProgramId?: string;
  } = {}
): void {
  const providerCluster = options.providerCluster ?? "localnet";
  const programSections = options.mainnetProgramId
    ? `[programs.localnet]
counter = "${PROGRAM_ID}"

[programs.mainnet]
counter = "${options.mainnetProgramId}"
`
    : `[programs.localnet]
counter = "${PROGRAM_ID}"
`;

  writeFileSync(
    join(dir, "Anchor.toml"),
    `${programSections}
[provider]
cluster = "${providerCluster}"
wallet = "~/.config/solana/id.json"

[scripts]
verify_upgrade = "solana program show ${options.mainnetProgramId ?? PROGRAM_ID} --url ${providerCluster}"
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

  if (options.idl !== false) {
    mkdirSync(join(dir, "target", "idl"), { recursive: true });
    writeFileSync(
      join(dir, "target", "idl", "counter.json"),
      JSON.stringify({ version: "0.1.0", name: "counter", metadata: { address: options.idlAddress ?? PROGRAM_ID } }),
      "utf8"
    );
  }

  if (options.verifiable !== false) {
    mkdirSync(join(dir, "target", "verifiable"), { recursive: true });
    writeFileSync(join(dir, "target", "verifiable", "counter-build.json"), JSON.stringify({ program: "counter" }), "utf8");
  }

  if (options.quorate !== false) {
    writeFileSync(join(dir, ".quorate.yml"), serializeConfig(buildPackConfig(PACKS.solana, [])), "utf8");
  }
}

describe("buildSolanaReleaseGate", () => {
  it("passes when Anchor, Cargo, IDL, Quorate, authority, and verifiable evidence are present", () => {
    writeAnchorProject();

    const report = buildSolanaReleaseGate({ cwd: dir, now: new Date("2026-06-23T00:00:00.000Z") });

    expect(report.summary.gate).toBe("pass");
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report.programs[0]).toMatchObject({
      name: "counter",
      idlMatchesProgramId: true
    });
  });

  it("fails when no IDL artifacts are present", () => {
    writeAnchorProject({ idl: false });

    const report = buildSolanaReleaseGate({ cwd: dir });
    const idlCheck = report.checks.find((check) => check.id === "idl");

    expect(report.summary.gate).toBe("fail");
    expect(idlCheck?.status).toBe("fail");
    expect(idlCheck?.detail).toMatch(/No target\/idl/i);
  });

  it("fails when IDL metadata address does not match Anchor.toml", () => {
    writeAnchorProject({ idlAddress: "22222222222222222222222222222222" });

    const report = buildSolanaReleaseGate({ cwd: dir });

    expect(report.summary.gate).toBe("fail");
    expect(report.checks.find((check) => check.id === "idl")?.detail).toMatch(/do not match/i);
  });

  it("compares IDL metadata against the provider cluster program ID", () => {
    writeAnchorProject({
      providerCluster: "mainnet",
      mainnetProgramId: MAINNET_PROGRAM_ID,
      idlAddress: PROGRAM_ID
    });

    const report = buildSolanaReleaseGate({ cwd: dir });

    expect(report.summary.gate).toBe("fail");
    expect(report.checks.find((check) => check.id === "idl")?.detail).toMatch(/do not match/i);
    expect(report.programs[0].idlMatchesProgramId).toBe(false);
  });

  it("uses the provider cluster program ID in the generated upgrade-authority command", () => {
    writeAnchorProject({
      providerCluster: "mainnet",
      mainnetProgramId: MAINNET_PROGRAM_ID,
      idlAddress: MAINNET_PROGRAM_ID
    });

    const report = buildSolanaReleaseGate({ cwd: dir });
    const plan = buildSolanaTestPlan(report);

    expect(plan.items.find((item) => item.id === "upgrade-authority")?.command).toBe(
      `solana program show ${MAINNET_PROGRAM_ID} --url mainnet`
    );
  });

  it("adds Quorate setup to the generated test plan when the Solana pack is missing", () => {
    writeAnchorProject({ quorate: false });

    const report = buildSolanaReleaseGate({ cwd: dir });
    const plan = buildSolanaTestPlan(report);

    expect(plan.items.some((item) => item.command === "quorate init --pack solana")).toBe(true);
    expect(plan.items.some((item) => item.command === "anchor build --verifiable")).toBe(true);
  });
});
