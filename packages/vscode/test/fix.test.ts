import { describe, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({}));
import { fixTerminalOptions, normalizeDoctorReport, type CouncilReport, type Finding } from "../src/cli";
import { createDefaultConfig } from "@quorate/core";
import { buildDoctorReport } from "../../cli/src/doctor.js";

const finding: Finding = { severity: "high", title: "Unsafe call", body: "Fix this", file: "src/a.ts", fingerprint: "finding-a" };
const report: CouncilReport = {
  verdict: "fail", summary: "One finding", findings: [finding], providerResults: [],
  metadata: { degraded: false, reviewId: "review-1", generatedAt: "2026-09-08T00:00:00Z" }
};

describe("editor fix handoff", () => {
  it("binds the repository and exact report/finding without generating shell code", () => {
    const command = "/opt/CLI Tools/quorate;touch nope";
    const options = fixTerminalOptions(command, "/repo/a", report, finding);
    expect(options.cwd).toBe("/repo/a");
    expect(options.shellPath).toBe(command);
    expect(options.shellArgs).toEqual([
      "fix", "--cwd", "/repo/a", "--report-id", "review-1", "--report-generated-at", "2026-09-08T00:00:00Z", "--finding-fingerprint", "finding-a"
    ]);
    expect(options).not.toHaveProperty("shellLocation");
  });

  it("refuses old reports and findings without persistent identity", () => {
    expect(() => fixTerminalOptions("quorate", "/repo/a", { ...report, metadata: { degraded: false } }, finding)).toThrow("new review");
    expect(() => fixTerminalOptions("quorate", "/repo/a", report, { ...finding, fingerprint: undefined })).toThrow("new review");
    expect(() => fixTerminalOptions("quorate", "relative", report, finding)).toThrow("new review");
  });
});

describe("doctor JSON compatibility", () => {
  it("preserves custom councils from the actual CLI producer without counting heuristics as installed agents", () => {
    const config = createDefaultConfig([]);
    config.councils = ["release-review"];
    config.providers = [{ id: "heuristic", type: "mock", enabled: true }];
    const emitted = buildDoctorReport({ cwd: "/tmp/quorate-doctor-contract", config, mode: "review", transcript: [] });
    const doctor = normalizeDoctorReport(JSON.parse(JSON.stringify(emitted)));
    expect(doctor?.config.councils).toEqual(["release-review"]);
    expect(doctor?.detected).toEqual([]);
    expect(doctor?.config.providers.map((provider) => provider.id)).toEqual(["heuristic"]);
  });

  it("retains installed CLI providers from the current safe doctor report", () => {
    const doctor = normalizeDoctorReport({
      schema: 1, status: "ready", verification: "configuration", configPath: "/repo/.quorate.yml",
      providers: [
        { id: "codex", type: "cli", active: true, available: true, runnable: true, command: "codex" },
        { id: "claude", type: "cli", active: false, available: false, runnable: false },
        { id: "heuristic", type: "mock", active: true, available: true, runnable: true }
      ], nextSteps: []
    });
    expect(doctor?.detected.find((provider) => provider.id === "codex")?.available).toBe(true);
    expect(doctor?.detected.find((provider) => provider.id === "claude")?.available).toBe(false);
    expect(doctor?.config.providers.map((provider) => provider.id)).toEqual(["codex", "claude", "heuristic"]);
  });

  it("continues accepting the previous detected/config shape", () => {
    const previous = { detected: [{ id: "codex", available: true }], config: { providers: [{ id: "codex", type: "cli" }], councils: ["security"] } };
    expect(normalizeDoctorReport(previous)).toEqual(previous);
    expect(normalizeDoctorReport({ schema: 99 })).toBeUndefined();
  });
});
