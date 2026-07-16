import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildProgram } from "../src/index.js";
import { readSupplyChainDiff } from "../src/supply-chain-command.js";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quorate-supply-chain-cli-"));
  git(["init", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Quorate Test"]);
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

function commit(message: string): void {
  git(["add", "."]);
  git(["commit", "-m", message]);
}

function captureLog(): string[] {
  const output: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
    output.push(String(message));
  });
  return output;
}

describe("quorate supply-chain scan", () => {
  it("rejects --head without --base instead of silently scanning the working tree", () => {
    expect(() => readSupplyChainDiff({ head: "HEAD" }, dir)).toThrow(/--head requires --base/i);
  });

  it("rejects conflicting diff selectors instead of silently choosing one", () => {
    expect(() => readSupplyChainDiff({ diff: "changes.diff", pr: "42" }, dir)).toThrow(
      /choose only one/i
    );
    expect(() => readSupplyChainDiff({ base: "main", pr: "42" }, dir)).toThrow(/choose only one/i);
  });

  it("includes untracked supply-chain files in a working-tree scan", () => {
    writeFileSync(resolve(dir, "README.md"), "baseline\n", "utf8");
    commit("baseline");
    writeFileSync(resolve(dir, "Dockerfile"), "FROM node:latest\n", "utf8");

    const diff = readSupplyChainDiff({}, dir);

    expect(diff).toContain("diff --git a/Dockerfile b/Dockerfile");
    expect(diff).toContain("+FROM node:latest");
  });

  it("uses a bounded number of Git processes when many files are untracked", () => {
    writeFileSync(resolve(dir, "README.md"), "baseline\n", "utf8");
    commit("baseline");
    for (let index = 0; index < 12; index += 1) {
      const serviceDir = resolve(dir, `service-${index}`);
      mkdirSync(serviceDir, { recursive: true });
      writeFileSync(resolve(serviceDir, "Dockerfile"), "FROM node:latest\n", "utf8");
    }
    vi.mocked(spawnSync).mockClear();

    const diff = readSupplyChainDiff({}, dir);
    const gitProcesses = vi.mocked(spawnSync).mock.calls.filter(([command]) => command === "git");

    expect(diff).toContain("diff --git a/service-11/Dockerfile b/service-11/Dockerfile");
    expect(gitProcesses.length).toBeLessThanOrEqual(6);
  });

  it("scans --base/--head, prints JSON, persists the report, and gates on policy", async () => {
    writeFileSync(resolve(dir, "Dockerfile"), "FROM node:20\n", "utf8");
    commit("baseline");
    git(["checkout", "-b", "feature"]);
    writeFileSync(resolve(dir, "Dockerfile"), "FROM node:latest\n", "utf8");
    commit("mutable base image");

    const output = captureLog();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync(
      [
        "node",
        "quorate",
        "--cwd",
        dir,
        "supply-chain",
        "scan",
        "--base",
        "main",
        "--head",
        "HEAD",
        "--json",
        "--gate",
        "--fail-on",
        "medium"
      ],
      { from: "node" }
    );

    const report = JSON.parse(output.join("\n")) as { findings: Array<{ title: string }>; verdict: string };
    expect(report.verdict).toBe("warn");
    expect(report.findings).toContainEqual(
      expect.objectContaining({ title: "Docker base image is not pinned by digest" })
    );
    expect(existsSync(resolve(dir, ".quorate", "supply-chain", "latest.json"))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it("uses full diffs so lockfile updates suppress dependency-without-lockfile findings", async () => {
    writeFileSync(
      resolve(dir, "package.json"),
      JSON.stringify({ dependencies: { react: "^19.0.0" } }, null, 2) + "\n",
      "utf8"
    );
    writeFileSync(resolve(dir, "package-lock.json"), JSON.stringify({ packages: {} }, null, 2) + "\n", "utf8");
    commit("baseline package");

    git(["checkout", "-b", "feature"]);
    writeFileSync(
      resolve(dir, "package.json"),
      JSON.stringify({ dependencies: { "left-pad": "^1.3.0", react: "^19.0.0" } }, null, 2) + "\n",
      "utf8"
    );
    writeFileSync(
      resolve(dir, "package-lock.json"),
      JSON.stringify(
        {
          lockfileVersion: 3,
          packages: {
            "node_modules/left-pad": {
              version: "1.3.0",
              resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
              integrity: "sha512-test"
            }
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    commit("add dependency with lockfile");

    const output = captureLog();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync(
      ["node", "quorate", "--cwd", dir, "supply-chain", "scan", "--base", "main", "--head", "HEAD", "--json"],
      { from: "node" }
    );

    const report = JSON.parse(output.join("\n")) as { findings: Array<{ title: string }> };
    expect(report.findings.map((finding) => finding.title)).not.toContain("Dependency added without lockfile update");
    expect(readFileSync(resolve(dir, ".quorate", "supply-chain", "latest.json"), "utf8")).toContain(
      "SupplyChainGate"
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("does not apply council coverage requirements to the dedicated deterministic gate", async () => {
    writeFileSync(resolve(dir, "Dockerfile"), "FROM scratch\n", "utf8");
    commit("baseline");
    git(["checkout", "-b", "feature"]);
    writeFileSync(
      resolve(dir, "Dockerfile"),
      "FROM node@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef\n",
      "utf8"
    );
    mkdirSync(resolve(dir, ".quorate"), { recursive: true });
    writeFileSync(
      resolve(dir, ".quorate", "policy.yml"),
      `version: 1
merge_gate:
  enabled: true
  block_on_verdict: [fail]
verdict:
  fail_on: high
  fail_on_degraded: true
roles_required: [security]
providers:
  min_real_providers: 2
`,
      "utf8"
    );

    const output = captureLog();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync(
      ["node", "quorate", "--cwd", dir, "supply-chain", "scan", "--base", "main", "--json", "--gate"],
      { from: "node" }
    );

    const report = JSON.parse(output.join("\n")) as { findings: unknown[]; verdict: string };
    expect(report.verdict).toBe("pass");
    expect(report.findings).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });
});
