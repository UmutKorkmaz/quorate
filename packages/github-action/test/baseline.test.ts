import { describe, expect, it } from "vitest";
import { createBaseline, fingerprintFinding, serializeBaseline, type Finding } from "@quorate/core";

import { loadBaseBaseline } from "../src/index.js";

// Minimal Octokit stub: getContent returns a base64 file for known paths, 404 otherwise.
function fakeClient(files: Record<string, string>): Parameters<typeof loadBaseBaseline>[0] {
  return {
    rest: {
      repos: {
        getContent: async ({ path }: { path: string }) => {
          if (path in files) {
            return {
              data: {
                type: "file",
                encoding: "base64",
                content: Buffer.from(files[path], "utf8").toString("base64")
              }
            };
          }
          const error = new Error("Not Found") as Error & { status: number };
          error.status = 404;
          throw error;
        }
      }
    }
  } as unknown as Parameters<typeof loadBaseBaseline>[0];
}

const params = { owner: "o", repo: "r", ref: "base-sha", path: ".quorate.baseline.json" };

function finding(overrides: Partial<Finding> = {}): Finding {
  const base: Finding = { severity: "high", title: "Known issue", body: "x", ...overrides };
  return { ...base, fingerprint: fingerprintFinding(base) };
}

describe("loadBaseBaseline", () => {
  it("loads the baseline from the base ref", async () => {
    const store = createBaseline([finding({ file: "a.ts" })], {
      generatedAt: "2026-06-13T00:00:00.000Z"
    });
    const loaded = await loadBaseBaseline(
      fakeClient({ ".quorate.baseline.json": serializeBaseline(store) }),
      params
    );
    expect(loaded?.findings).toHaveLength(1);
  });

  it("returns null when the base ref has no committed baseline", async () => {
    expect(await loadBaseBaseline(fakeClient({}), params)).toBeNull();
  });

  it("throws on a malformed baseline file (fail loud, never silently ungate)", async () => {
    await expect(loadBaseBaseline(fakeClient({ ".quorate.baseline.json": "not json" }), params)).rejects.toThrow(
      /Invalid baseline/i
    );
  });
});
