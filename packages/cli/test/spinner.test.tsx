import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { Spinner, SPINNERS, formatElapsed } from "../src/tui/Spinner.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("formatElapsed", () => {
  it("renders mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(5_000)).toBe("00:05");
    expect(formatElapsed(65_000)).toBe("01:05");
    expect(formatElapsed(125_000)).toBe("02:05");
  });
});

describe("Spinner", () => {
  it("renders a braille frame and keeps animating", async () => {
    const { lastFrame, unmount } = render(<Spinner intervalMs={20} />);
    expect(SPINNERS.braille.some((frame) => (lastFrame() ?? "").includes(frame))).toBe(true);
    await sleep(60);
    expect(SPINNERS.braille.some((frame) => (lastFrame() ?? "").includes(frame))).toBe(true);
    unmount();
  });

  it("exposes multiple spinner styles", () => {
    expect(Object.keys(SPINNERS)).toEqual(expect.arrayContaining(["braille", "dots", "pulse"]));
    for (const frames of Object.values(SPINNERS)) {
      expect(frames.length).toBeGreaterThan(0);
    }
  });
});
