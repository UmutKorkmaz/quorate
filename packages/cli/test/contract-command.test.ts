import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// ContractCourt's engine lives in @quorate/core. It is mocked here with the
// exact API surface the core package exports (parseOpenApi / compareContracts)
// so the CLI command is exercised against a deterministic double instead of
// reimplementing comparison logic in this package.
vi.mock("@quorate/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quorate/core")>();

  const sourceHash = (value: string): string => {
    let first = 0xdeadbeef;
    let second = 0x41c6ce57;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 2654435761);
      second = Math.imul(second ^ code, 1597334677);
    }
    first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
    second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
    return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
  };

  const listPaths = (source: string): string[] =>
    [...source.matchAll(/^ {2}(\/[^:\s]+):$/gm)].map((match) => match[1]);

  return {
    ...actual,
    parseOpenApi: vi.fn((source: string) =>
      source.includes("openapi:")
        ? { ok: true as const, doc: { paths: listPaths(source) } }
        : { ok: false as const, error: "not an OpenAPI document: missing 'openapi:' root" }
    ),
    compareContracts: vi.fn(
      (input: { before: { source: string; label: string }; after: { source: string; label: string } }) => {
        const beforePaths = listPaths(input.before.source);
        const afterPaths = listPaths(input.after.source);
        const findings = [];
        for (const path of beforePaths) {
          if (afterPaths.includes(path)) continue;
          findings.push({
            id: `removed:${path}`,
            changeType: "breaking" as const,
            rule: "openapi/path-removed",
            title: `Removed path ${path}`,
            body: `Path ${path} exists in ${input.before.label} but is gone in ${input.after.label}.`,
            severity: "high",
            path
          });
        }
        for (const path of afterPaths) {
          if (beforePaths.includes(path)) continue;
          findings.push({
            id: `added:${path}`,
            changeType: "additive" as const,
            rule: "openapi/path-added",
            title: `Added path ${path}`,
            body: `Path ${path} is new in ${input.after.label}.`,
            severity: "info",
            path
          });
        }
        const counts = {
          breaking: findings.filter((finding) => finding.changeType === "breaking").length,
          additive: findings.filter((finding) => finding.changeType === "additive").length,
          ambiguous: 0
        };
        const verdict = counts.breaking > 0 ? "block" : counts.ambiguous > 0 ? "warn" : "pass";
        return {
          verdict,
          counts,
          before: { label: input.before.label, hash: sourceHash(input.before.source) },
          after: { label: input.after.label, hash: sourceHash(input.after.source) },
          findings
        };
      }
    )
  };
});

import * as core from "@quorate/core";
import {
  CONTRACT_ARTIFACT_DIR,
  readContractArtifact,
  runContractCheck,
  type ContractArtifact
} from "../src/contract-command.js";

const engine = core as unknown as { parseOpenApi: Mock; compareContracts: Mock };

let dir: string;
let logSpy: Mock;
let errorSpy: Mock;

const artifactDir = (cwd: string): string => resolve(cwd, CONTRACT_ARTIFACT_DIR);
const artifactJsonPath = (cwd: string): string => join(artifactDir(cwd), "latest.json");
const artifactMdPath = (cwd: string): string => join(artifactDir(cwd), "latest.md");

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
}

function commit(message: string): void {
  git(["add", "."]);
  git(["commit", "-m", message]);
}

/** Minimal OpenAPI fixture: every listed path gets a GET operation. */
function apiSpec(paths: string[]): string {
  return [
    "openapi: 3.1.0",
    "info:",
    "  title: Users API",
    "  version: 1.0.0",
    "paths:",
    ...paths.flatMap((path) => [
      `  ${path}:`,
      "    get:",
      `      operationId: op${path.slice(1)}`,
      "      responses:",
      '        "200":',
      "          description: ok"
    ]),
    ""
  ].join("\n");
}

const BEFORE_SPEC = apiSpec(["/users", "/health"]);
const AFTER_SPEC = apiSpec(["/health", "/admins"]);

function writeFileModeFixtures(): void {
  writeFileSync(resolve(dir, "before.yaml"), BEFORE_SPEC, "utf8");
  writeFileSync(resolve(dir, "after.yaml"), AFTER_SPEC, "utf8");
}

function writeGitModeFixtures(): void {
  writeFileSync(resolve(dir, "openapi.yaml"), BEFORE_SPEC, "utf8");
  commit("baseline contract");
  git(["checkout", "-b", "feature"]);
  writeFileSync(resolve(dir, "openapi.yaml"), AFTER_SPEC, "utf8");
  commit("drop /users, add /admins");
  git(["checkout", "main"]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quorate-contract-cli-"));
  git(["init", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Quorate Test"]);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  engine.parseOpenApi.mockClear();
  engine.compareContracts.mockClear();
  logSpy.mockRestore();
  errorSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

describe("quorate contract check (file mode)", () => {
  it("compares --before/--after specs, writes the artifact, and exits 0 without --gate", async () => {
    writeFileModeFixtures();

    const outcome = await runContractCheck({ cwd: dir, before: "before.yaml", after: "after.yaml" });

    expect(outcome.verdict).toBe("block");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.artifactPath).toBe(artifactJsonPath(dir));

    expect(engine.compareContracts).toHaveBeenCalledTimes(1);
    expect(engine.compareContracts).toHaveBeenCalledWith({
      before: { source: BEFORE_SPEC, label: "before.yaml" },
      after: { source: AFTER_SPEC, label: "after.yaml" }
    });

    const artifact = readContractArtifact(dir);
    expect(artifact?.schema).toBe(1);
    expect(artifact?.verdict).toBe("block");
    expect(artifact?.counts).toEqual({ breaking: 1, additive: 1, ambiguous: 0 });
    expect(artifact?.before).toEqual({ label: "before.yaml", hash: expect.any(String) });
    expect(artifact?.after).toEqual({ label: "after.yaml", hash: expect.any(String) });
    expect(artifact?.findings).toHaveLength(2);
    expect(artifact?.findings[0]).toMatchObject({
      changeType: "breaking",
      rule: "openapi/path-removed",
      path: "/users"
    });
    expect(artifact?.findings[1]).toMatchObject({ changeType: "additive", path: "/admins" });
    expect(artifact?.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof artifact?.createdAt).toBe("string");

    expect(existsSync(artifactJsonPath(dir))).toBe(true);
    expect(existsSync(artifactMdPath(dir))).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("prints the artifact JSON with --json and the markdown summary by default", async () => {
    writeFileModeFixtures();

    await runContractCheck({ cwd: dir, before: "before.yaml", after: "after.yaml", json: true });
    const printedJson = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(() => JSON.parse(printedJson)).not.toThrow();
    const parsed = JSON.parse(printedJson) as ContractArtifact;
    expect(parsed).toEqual(readContractArtifact(dir));
    logSpy.mockClear();

    await runContractCheck({ cwd: dir, before: "before.yaml", after: "after.yaml" });
    const markdown = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(markdown).toContain("BLOCK");
    expect(markdown).toContain("/users");
    expect(markdown).toMatch(/before\.yaml.*→.*after\.yaml/s);
    expect(markdown).toBe(readFileSync(artifactMdPath(dir), "utf8").replace(/\n$/, ""));
  });

  it("exits 1 with --gate only when the verdict is block", async () => {
    writeFileModeFixtures();

    const blocked = await runContractCheck({ cwd: dir, before: "before.yaml", after: "after.yaml", gate: true });
    expect(blocked.verdict).toBe("block");
    expect(blocked.exitCode).toBe(1);

    writeFileSync(resolve(dir, "after.yaml"), BEFORE_SPEC, "utf8");
    const clean = await runContractCheck({ cwd: dir, before: "before.yaml", after: "after.yaml", gate: true });
    expect(clean.verdict).toBe("pass");
    expect(clean.exitCode).toBe(0);
  });
});

describe("quorate contract check (git mode)", () => {
  it("loads the spec at both refs and labels engine inputs as ref:path", async () => {
    writeGitModeFixtures();

    const outcome = await runContractCheck({
      cwd: dir,
      spec: "openapi.yaml",
      base: "main",
      head: "feature"
    });

    expect(outcome.verdict).toBe("block");
    expect(outcome.exitCode).toBe(0);

    expect(engine.compareContracts).toHaveBeenCalledTimes(1);
    expect(engine.compareContracts).toHaveBeenCalledWith({
      before: { source: BEFORE_SPEC, label: "main:openapi.yaml" },
      after: { source: AFTER_SPEC, label: "feature:openapi.yaml" }
    });

    const artifact = readContractArtifact(dir);
    expect(artifact?.before.label).toBe("main:openapi.yaml");
    expect(artifact?.after.label).toBe("feature:openapi.yaml");
  });

  it("fails closed when git cannot resolve a ref", async () => {
    writeGitModeFixtures();

    const outcome = await runContractCheck({
      cwd: dir,
      spec: "openapi.yaml",
      base: "does-not-exist",
      head: "feature"
    });

    expect(outcome.verdict).toBe("block");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.summary).toMatch(/error:/i);
    expect(outcome.summary).toMatch(/git show does-not-exist:openapi\.yaml failed/i);
    expect(existsSync(artifactDir(dir))).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("quorate contract check (fail-closed validation)", () => {
  it("errors when no input mode is selected", async () => {
    const outcome = await runContractCheck({ cwd: dir });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.summary).toMatch(/error:/i);
    expect(outcome.summary).toMatch(/--spec.*--base.*--head.*--before.*--after|--before.*--after.*--spec/s);
    expect(existsSync(artifactDir(dir))).toBe(false);
  });

  it("errors when both input modes are selected", async () => {
    writeFileModeFixtures();
    const outcome = await runContractCheck({
      cwd: dir,
      spec: "openapi.yaml",
      base: "main",
      head: "feature",
      before: "before.yaml",
      after: "after.yaml"
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.summary).toMatch(/one contract input mode/i);
    expect(existsSync(artifactDir(dir))).toBe(false);
  });

  it("errors on incomplete git mode arguments", async () => {
    const specOnly = await runContractCheck({ cwd: dir, spec: "openapi.yaml" });
    expect(specOnly.exitCode).toBe(1);
    expect(specOnly.summary).toMatch(/--spec requires both --base <ref> and --head <ref>/i);

    const noHead = await runContractCheck({ cwd: dir, spec: "openapi.yaml", base: "main" });
    expect(noHead.exitCode).toBe(1);
    expect(noHead.summary).toMatch(/--spec requires both --base <ref> and --head <ref>/i);

    const refsOnly = await runContractCheck({ cwd: dir, base: "main", head: "feature" });
    expect(refsOnly.exitCode).toBe(1);
    expect(refsOnly.summary).toMatch(/--base\/--head require --spec/i);
  });

  it("errors on incomplete file mode arguments", async () => {
    const beforeOnly = await runContractCheck({ cwd: dir, before: "before.yaml" });
    expect(beforeOnly.exitCode).toBe(1);
    expect(beforeOnly.summary).toMatch(/--before requires --after/i);

    const afterOnly = await runContractCheck({ cwd: dir, after: "after.yaml" });
    expect(afterOnly.exitCode).toBe(1);
  });

  it("errors when the engine cannot parse a spec", async () => {
    writeFileSync(resolve(dir, "before.yaml"), "title: definitely not an api\n", "utf8");
    writeFileSync(resolve(dir, "after.yaml"), AFTER_SPEC, "utf8");

    const outcome = await runContractCheck({ cwd: dir, before: "before.yaml", after: "after.yaml" });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.summary).toMatch(/error:/i);
    expect(outcome.summary).toMatch(/before\.yaml/);
    expect(outcome.summary).toMatch(/missing 'openapi:' root/);
    expect(existsSync(artifactDir(dir))).toBe(false);
  });

  it("errors when a file-mode spec file is missing", async () => {
    const outcome = await runContractCheck({ cwd: dir, before: "gone.yaml", after: "also-gone.yaml" });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.summary).toMatch(/error:/i);
    expect(outcome.summary).toMatch(/gone\.yaml/);
  });
});

describe("contract artifact determinism and permissions", () => {
  it("produces the same artifactHash across runs (only createdAt may differ)", async () => {
    writeFileModeFixtures();

    const first = await runContractCheck({ cwd: dir, before: "before.yaml", after: "after.yaml" });
    const firstArtifact = readContractArtifact(dir) as ContractArtifact;
    engine.compareContracts.mockClear();

    const second = await runContractCheck({ cwd: dir, before: "before.yaml", after: "after.yaml" });
    const secondArtifact = readContractArtifact(dir) as ContractArtifact;

    expect(first.verdict).toBe(second.verdict);
    expect(secondArtifact.artifactHash).toBe(firstArtifact.artifactHash);
    const { createdAt: firstCreated, ...firstStable } = firstArtifact;
    const { createdAt: secondCreated, ...secondStable } = secondArtifact;
    expect(secondStable).toEqual(firstStable);
    expect(typeof firstCreated).toBe("string");
    expect(typeof secondCreated).toBe("string");
  });

  it("creates the artifact directory 0700 and files 0600 (creation-time modes)", async () => {
    writeFileModeFixtures();

    await runContractCheck({ cwd: dir, before: "before.yaml", after: "after.yaml" });

    expect(statSync(artifactDir(dir)).mode & 0o777).toBe(0o700);
    expect(statSync(artifactJsonPath(dir)).mode & 0o777).toBe(0o600);
    expect(statSync(artifactMdPath(dir)).mode & 0o777).toBe(0o600);
  });

  it("round-trips through readContractArtifact and tolerates missing or corrupt files", async () => {
    expect(readContractArtifact(dir)).toBeUndefined();

    writeFileModeFixtures();
    await runContractCheck({ cwd: dir, before: "before.yaml", after: "after.yaml" });

    const fromDisk = JSON.parse(readFileSync(artifactJsonPath(dir), "utf8")) as ContractArtifact;
    expect(readContractArtifact(dir)).toEqual(fromDisk);

    writeFileSync(artifactJsonPath(dir), "{not json", "utf8");
    expect(readContractArtifact(dir)).toBeUndefined();
  });

  it("exposes the artifact directory constant relative to the workspace", () => {
    expect(CONTRACT_ARTIFACT_DIR).toBe(".quorate/contract");
  });
});
