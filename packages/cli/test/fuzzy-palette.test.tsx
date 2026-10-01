import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { commandRegistry, matchCommands, scoreCommandMatch } from "../src/tui/commands.js";
import { SlashPalette, paletteWindowStart } from "../src/tui/SlashPalette.js";
import type { SlashCommand } from "../src/tui/commands.js";

describe("scoreCommandMatch", () => {
  it("prefers prefix matches over substring and subsequence matches", () => {
    expect(scoreCommandMatch("review", "re")).toBeGreaterThan(scoreCommandMatch("provider", "re"));
    expect(scoreCommandMatch("review", "rev")).toBeGreaterThan(scoreCommandMatch("review", "vie"));
    expect(scoreCommandMatch("review", "rev")).toBeGreaterThan(scoreCommandMatch("review", "rw"));
    expect(scoreCommandMatch("review", "zzz")).toBe(-1);
  });
});

describe("matchCommands", () => {
  const visibleCount = commandRegistry.filter((command) => !command.hidden).length;

  it("lists every visible command when the query is empty", () => {
    expect(matchCommands("")).toHaveLength(visibleCount);
  });

  it("prefix-matches review commands for /re", () => {
    const names = matchCommands("re").map((command) => command.name);
    expect(names).toContain("review");
    expect(names).toContain("rerun");
    expect(names).toContain("resume");
    // Canonical name prefix matches keep registry order; review is first.
    expect(names[0]).toBe("review");
  });

  it("substring-matches inspect for /spec", () => {
    const names = matchCommands("spec").map((command) => command.name);
    expect(names).toContain("inspect");
  });

  it("returns no matches for unrelated queries", () => {
    expect(matchCommands("zzz")).toEqual([]);
  });
});

describe("SlashPalette", () => {
  it("renders matches with the selected row highlighted and keycap footer", () => {
    const matches = matchCommands("re");
    const { lastFrame, unmount } = render(<SlashPalette matches={matches} selectedIndex={0} />);
    const frame = lastFrame() ?? "";

    expect(frame).toContain("/rerun");
    expect(frame).toContain("/review");
    expect(frame).toContain("select");
    expect(frame).toContain("complete");
    unmount();
  });

  it("shows the empty-state row when nothing matches", () => {
    const { lastFrame, unmount } = render(<SlashPalette matches={[]} selectedIndex={0} />);
    expect(lastFrame() ?? "").toContain("No matching commands");
    unmount();
  });
});
function fakeCommands(count: number): SlashCommand[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `cmd${String(index + 1).padStart(2, "0")}`,
    summary: `summary ${index + 1}`,
    run: () => {}
  }));
}

describe("paletteWindowStart", () => {
  it("keeps the window at the top while the caret stays inside it", () => {
    expect(paletteWindowStart(0, 14, 10)).toBe(0);
    expect(paletteWindowStart(9, 14, 10)).toBe(0);
  });

  it("scrolls one row at a time once the caret passes the bottom edge", () => {
    expect(paletteWindowStart(10, 14, 10)).toBe(1);
    expect(paletteWindowStart(11, 14, 10)).toBe(2);
  });

  it("pins the caret to the bottom edge at the end of the list", () => {
    expect(paletteWindowStart(13, 14, 10)).toBe(4);
  });

  it("resets to the top when the selection wraps back to zero", () => {
    expect(paletteWindowStart(0, 14, 10)).toBe(0);
  });

  it("returns zero when everything fits", () => {
    expect(paletteWindowStart(4, 5, 10)).toBe(0);
    expect(paletteWindowStart(0, 10, 10)).toBe(0);
  });
});

describe("SlashPalette windowed rendering", () => {
  // ink-testing-library stdout reports no rows -> fallback 24 -> 10 visible rows.
  it("shows only the first window with a below-indicator when the list is longer", () => {
    const { lastFrame, unmount } = render(<SlashPalette matches={fakeCommands(14)} selectedIndex={0} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/cmd01");
    expect(frame).toContain("/cmd10");
    expect(frame).not.toContain("/cmd11");
    expect(frame).toContain("4 more below");
    expect(frame).not.toContain("more above");
    unmount();
  });

  it("scrolls to the caret and shows an above-indicator at the end of the list", () => {
    const { lastFrame, unmount } = render(<SlashPalette matches={fakeCommands(14)} selectedIndex={13} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/cmd14");
    expect(frame).toContain("/cmd05");
    expect(frame).not.toContain("/cmd04");
    expect(frame).not.toContain("/cmd01");
    expect(frame).toContain("4 more above");
    expect(frame).not.toContain("more below");
    unmount();
  });

  it("scrolls exactly one row when the caret crosses the bottom edge", () => {
    const { lastFrame, unmount } = render(<SlashPalette matches={fakeCommands(14)} selectedIndex={10} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/cmd02");
    expect(frame).toContain("/cmd11");
    expect(frame).not.toContain("/cmd01");
    expect(frame).toContain("1 more above");
    expect(frame).toContain("3 more below");
    unmount();
  });

  it("renders every row without indicators when the list fits", () => {
    const { lastFrame, unmount } = render(<SlashPalette matches={fakeCommands(5)} selectedIndex={4} />);
    const frame = lastFrame() ?? "";
    for (let index = 1; index <= 5; index += 1) {
      expect(frame).toContain(`/cmd0${index}`);
    }
    expect(frame).not.toContain("more above");
    expect(frame).not.toContain("more below");
    unmount();
  });
});
