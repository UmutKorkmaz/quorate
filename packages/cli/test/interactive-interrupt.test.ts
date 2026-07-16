import { describe, expect, it } from "vitest";
import { nextInterruptAction } from "../src/interactive-interrupt.js";

describe("nextInterruptAction", () => {
  it("clears before it exits", () => {
    expect(nextInterruptAction(false)).toBe("clear");
    expect(nextInterruptAction(true)).toBe("exit");
  });
});
