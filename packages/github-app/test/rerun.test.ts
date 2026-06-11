import { describe, expect, it } from "vitest";
import { isCheckRerunEvent } from "../src/server.js";

describe("isCheckRerunEvent", () => {
  it("fires on GitHub's native re-run (rerequested)", () => {
    expect(isCheckRerunEvent({ action: "rerequested" })).toBe(true);
  });
  it("fires on our custom requested_action with identifier 'rerun'", () => {
    expect(isCheckRerunEvent({ action: "requested_action", requested_action: { identifier: "rerun" } })).toBe(true);
  });
  it("ignores other requested_action identifiers", () => {
    expect(isCheckRerunEvent({ action: "requested_action", requested_action: { identifier: "other" } })).toBe(false);
  });
  it("ignores unrelated actions (created/completed)", () => {
    expect(isCheckRerunEvent({ action: "created" })).toBe(false);
    expect(isCheckRerunEvent({ action: "completed" })).toBe(false);
  });
});
