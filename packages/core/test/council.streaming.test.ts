import { describe, expect, it } from "vitest";
import { runCouncil, verdictFor } from "../src/council.js";
import { shouldFailForThreshold } from "../src/render.js";
import type { QuorateConfig, CouncilEvent, ProviderResult } from "../src/types.js";

function providerResult(overrides: Partial<ProviderResult>): ProviderResult {
  return {
    providerId: "codex",
    role: "qa",
    providerType: "cli",
    status: "error",
    summary: "",
    findings: [],
    durationMs: 0,
    ...overrides
  };
}

const cleanDiff = `diff --git a/src/util.ts b/src/util.ts
--- a/src/util.ts
+++ b/src/util.ts
@@ -1,2 +1,3 @@
+export const add = (a: number, b: number) => a + b;
`;

function heuristicOnlyConfig(): QuorateConfig {
  return {
    councils: ["maintainer"],
    providers: [{ id: "heuristic", type: "mock", roles: ["maintainer"], enabled: true }],
    github: { commentMode: "off", failOn: "high", runnerMode: "auto" }
  };
}

describe("runCouncil streaming events", () => {
  it("emits council/started, then per-lane started before done, with council/done strictly last", async () => {
    const events: CouncilEvent[] = [];
    const report = await runCouncil(
      { mode: "review", subject: "fixture", diff: cleanDiff },
      heuristicOnlyConfig(),
      { onEvent: (event) => events.push(event) }
    );

    expect(events[0].type).toBe("council/started");
    expect(events[events.length - 1].type).toBe("council/done");

    const startedAt = events.findIndex(
      (event) => event.type === "provider/started" && event.providerId === "heuristic"
    );
    const doneAt = events.findIndex(
      (event) => event.type === "provider/done" && event.providerId === "heuristic"
    );
    expect(startedAt).toBeGreaterThan(0);
    expect(doneAt).toBeGreaterThan(startedAt);

    // council/done report matches the resolved report
    const doneEvent = events[events.length - 1];
    if (doneEvent.type === "council/done") {
      expect(doneEvent.report.verdict).toBe(report.verdict);
    }
  });

  it("council/started planned lanes carry providerType", async () => {
    const events: CouncilEvent[] = [];
    await runCouncil(
      { mode: "review", subject: "fixture", diff: cleanDiff },
      heuristicOnlyConfig(),
      { onEvent: (event) => events.push(event) }
    );

    const started = events.find((event) => event.type === "council/started");
    expect(started).toBeDefined();
    if (started && started.type === "council/started") {
      expect(started.planned).toEqual([
        { providerId: "heuristic", role: "maintainer", providerType: "mock" }
      ]);
    }
  });

  it("heuristic-only clean diff yields verdict warn + degraded true, but stays cosmetic for CI", async () => {
    const report = await runCouncil(
      { mode: "review", subject: "fixture", diff: cleanDiff },
      heuristicOnlyConfig()
    );

    expect(report.verdict).toBe("warn");
    expect(report.metadata.degraded).toBe(true);
    expect(report.metadata.requestedProviders).toEqual(["heuristic:maintainer"]);
    expect(report.metadata.ranProviders).toEqual(["heuristic:maintainer"]);
    expect(report.summary).toContain("heuristic");
    // default CI behavior unchanged: degraded is cosmetic, not a fail at the high threshold
    expect(shouldFailForThreshold(report, "high")).toBe(false);
  });

  it("an enabled api provider with no model errors and keeps the run degraded", async () => {
    const config: QuorateConfig = {
      councils: ["maintainer"],
      providers: [{ id: "remote", type: "api", roles: ["maintainer"], enabled: true }],
      github: { commentMode: "off", failOn: "high", runnerMode: "auto" }
    };

    const events: CouncilEvent[] = [];
    const report = await runCouncil(
      { mode: "review", subject: "fixture", diff: cleanDiff },
      config,
      { onEvent: (event) => events.push(event) }
    );

    const done = events.find(
      (event) => event.type === "provider/done" && event.providerId === "remote"
    );
    expect(done).toBeDefined();
    if (done && done.type === "provider/done") {
      // No model configured → the api provider fails fast (no network call).
      expect(done.result.status).toBe("error");
      expect(done.result.providerType).toBe("api");
    }
    expect(report.metadata.degraded).toBe(true);
    // api produced no real `ok` result; the errored lane still counts as having run.
    expect(report.metadata.ranProviders).toEqual(["remote:maintainer"]);
    expect(report.metadata.requestedProviders).toEqual(["remote:maintainer"]);
  });

  it("a throwing onEvent does not prevent council/done", async () => {
    let sawDone = false;
    const report = await runCouncil(
      { mode: "review", subject: "fixture", diff: cleanDiff },
      heuristicOnlyConfig(),
      {
        onEvent: (event) => {
          if (event.type === "council/done") sawDone = true;
          throw new Error("subscriber boom");
        }
      }
    );

    expect(sawDone).toBe(true);
    expect(report).toBeDefined();
    expect(report.verdict).toBe("warn");
  });

  // spec §5.2 (line 128): verdictFor must stay coupled to the degraded downgrade.
  // An interrupted result makes the "every result is error" branch false, so an
  // [error, interrupted] or [interrupted-only] run with no medium+ findings has a
  // BASE verdict of `pass`; the `warn` users actually see is produced SOLELY by the
  // `degraded = realOk.length === 0` downgrade in runCouncil. These two fixtures
  // lock that base verdict so a future change to verdictFor cannot silently flip a
  // degraded run to a clean `pass`.
  it("verdictFor returns pass for [error, interrupted] with no medium+ findings", () => {
    const base = verdictFor(
      [],
      [providerResult({ status: "error" }), providerResult({ status: "interrupted" })]
    );
    expect(base).toBe("pass");
  });

  it("verdictFor returns pass for [interrupted-only, no findings]", () => {
    const base = verdictFor([], [providerResult({ status: "interrupted" })]);
    expect(base).toBe("pass");
  });
});
