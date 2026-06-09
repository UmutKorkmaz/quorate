import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProviderModels } from "../src/models.js";

describe("fetchProviderModels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses an OpenAI-style {data:[{id}]} list and sorts it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: "zeta" }, { id: "alpha" }, { id: "mid" }] })
      }))
    );
    await expect(fetchProviderModels("http://x/v1")).resolves.toEqual(["alpha", "mid", "zeta"]);
  });

  it("sends a bearer header when a key is given and hits {baseUrl}/models", async () => {
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }));
    vi.stubGlobal("fetch", spy);
    await fetchProviderModels("http://host/v1/", "sekret");
    const [url, init] = spy.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("http://host/v1/models");
    expect(init.headers.Authorization).toBe("Bearer sekret");
  });

  it("returns [] on HTTP errors and network failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    await expect(fetchProviderModels("http://x/v1")).resolves.toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );
    await expect(fetchProviderModels("http://x/v1")).resolves.toEqual([]);
  });
});
