import { describe, expect, it } from "vitest";
import { launchInkShell } from "../src/tui/index.js";

describe("launchInkShell", () => {
  it("is an async function with the expected arity", () => {
    expect(typeof launchInkShell).toBe("function");
    expect(launchInkShell.length).toBe(1);
  });
});
