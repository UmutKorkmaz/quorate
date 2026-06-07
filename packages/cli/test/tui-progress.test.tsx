import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { BusyLabel } from "../src/tui/Spinner.js";

describe("BusyLabel", () => {
  it("reads 'reviewing' immediately and 'still reviewing' after 10s", () => {
    const fresh = render(<BusyLabel since={Date.now()} />);
    expect(fresh.lastFrame() ?? "").toContain("reviewing");
    fresh.unmount();

    const aged = render(<BusyLabel since={Date.now() - 15_000} />);
    expect(aged.lastFrame() ?? "").toContain("still reviewing");
    aged.unmount();
  });
});
