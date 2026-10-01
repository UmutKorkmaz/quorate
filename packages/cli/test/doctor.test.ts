import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "@quorate/core";
import { buildDoctorReport, isSupportedNodeVersion, renderDoctorReport } from "../src/doctor.js";
import { testProvider } from "../src/provider-test.js";

describe("isSupportedNodeVersion", () => {
  it("requires Node 22.22.0 or newer", () => {
    expect(isSupportedNodeVersion("22.21.9")).toBe(false);
    expect(isSupportedNodeVersion("22.22.0")).toBe(true);
    expect(isSupportedNodeVersion("23.0.0")).toBe(true);
    expect(isSupportedNodeVersion("not-a-version")).toBe(false);
  });
});

describe("doctor report", () => {
  it("requires the input mode used by review preflight and labels provider tests as configuration checks", async () => {
    const provider = { id: "team-reviewer", type: "cli" as const, command: process.execPath, args: ["--version"] };
    expect(await testProvider(provider)).toMatchObject({ status: "error", verification: "configuration", checks: expect.arrayContaining([expect.objectContaining({ name: "input mode", status: "error" })]) });
    expect(await testProvider({ ...provider, inputMode: "none" })).toMatchObject({ status: "ok", verification: "configuration" });
  });

  it("reports custom executable readiness as configuration evidence and supplies an explicit opt-in command", () => {
    const config = createDefaultConfig([]);
    config.providers = [{ id: "team-reviewer", type: "cli", command: process.execPath, args: ["--version"], inputMode: "none", enabled: false }];
    const report = buildDoctorReport({ cwd: "/tmp/quorate-doctor-missing", config, mode: "review", transcript: [] });
    expect(report).toMatchObject({ status: "ready", verification: "configuration", providers: [{ id: "team-reviewer", active: false, available: true, runnable: true }] });
    expect(report.nextSteps).toContain("quorate review --providers team-reviewer");
    expect(renderDoctorReport(report)).toContain("authentication and model execution have not been tested");
    expect(report).not.toHaveProperty("config");
  });

  it("labels heuristic-only readiness degraded and offers the offline demo", () => {
    const config = createDefaultConfig([]);
    config.providers = [{ id: "heuristic", type: "mock", enabled: true }];
    const report = buildDoctorReport({ cwd: "/tmp/quorate-doctor-missing", config, mode: "review", transcript: [] });
    expect(report.status).toBe("degraded");
    expect(report.nextSteps).toContain("quorate setup demo");
    expect(renderDoctorReport(report)).toContain("DEGRADED");
  });
});
