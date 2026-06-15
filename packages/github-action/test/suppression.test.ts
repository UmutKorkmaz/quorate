import { describe, expect, it } from "vitest";
import { serializeSuppressionStore, addSuppression, createSuppressionStore } from "@quorate/core";

import { loadBaseSuppressionStore } from "../src/index.js";

function fakeClient(files: Record<string, string>): Parameters<typeof loadBaseSuppressionStore>[0] {
  return {
    rest: {
      repos: {
        getContent: async ({ path }: { path: string }) => {
          if (path in files) {
            return {
              data: { type: "file", encoding: "base64", content: Buffer.from(files[path], "utf8").toString("base64") }
            };
          }
          const error = new Error("Not Found") as Error & { status: number };
          error.status = 404;
          throw error;
        }
      }
    }
  } as unknown as Parameters<typeof loadBaseSuppressionStore>[0];
}

const params = { owner: "o", repo: "r", ref: "base-sha", path: ".quorate/suppressions.json" };

describe("loadBaseSuppressionStore", () => {
  it("loads the committed store from the base ref", async () => {
    const store = addSuppression(createSuppressionStore(), {
      fingerprint: "abc",
      reason: "accepted",
      createdAt: "2026-06-15T00:00:00.000Z"
    });
    const loaded = await loadBaseSuppressionStore(
      fakeClient({ ".quorate/suppressions.json": serializeSuppressionStore(store) }),
      params
    );
    expect(loaded?.suppressions).toHaveLength(1);
  });

  it("returns null when the base ref has no store", async () => {
    expect(await loadBaseSuppressionStore(fakeClient({}), params)).toBeNull();
  });

  it("throws on a malformed store (caller falls back fail-secure)", async () => {
    await expect(
      loadBaseSuppressionStore(fakeClient({ ".quorate/suppressions.json": "not json" }), params)
    ).rejects.toThrow(/not valid JSON|Invalid/i);
  });
});
