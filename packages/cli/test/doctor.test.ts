import { describe, expect, it } from "vitest";
import { isSupportedNodeVersion } from "../src/doctor.js";

describe("isSupportedNodeVersion", () => {
  it("requires Node 22.22.0 or newer", () => {
    expect(isSupportedNodeVersion("22.21.9")).toBe(false);
    expect(isSupportedNodeVersion("22.22.0")).toBe(true);
    expect(isSupportedNodeVersion("23.0.0")).toBe(true);
    expect(isSupportedNodeVersion("not-a-version")).toBe(false);
  });
});
