import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { commandRegistry, matchCommands, scoreCommandMatch } from "../src/tui/commands.js";
import { SlashPalette } from "../src/tui/SlashPalette.js";

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