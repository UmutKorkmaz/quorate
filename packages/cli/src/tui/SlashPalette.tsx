import React from "react";
import { Box, Text, useStdout } from "ink";
import { glyphs, PALETTE } from "@quorate/core";
import { Keycap } from "./views.js";
import type { SlashCommand } from "./commands.js";

export interface SlashPaletteProps {
  matches: SlashCommand[];
  selectedIndex: number;
}

// Rows outside the palette that also need terminal space: the keycap footer,
// the composer with its border, the status line, and transcript breathing room.
const RESERVED_ROWS = 8;
const MIN_VISIBLE_ROWS = 3;
const MAX_VISIBLE_ROWS = 10;

/**
 * Edge-follow window start: the selected row always stays on screen and the
 * window scrolls one row at a time, only when the caret reaches an edge.
 * Stateless on purpose — when the selection wraps back to index 0 the window
 * resets immediately, and tests can drive it without simulating key presses.
 */
export function paletteWindowStart(selectedIndex: number, count: number, visible: number): number {
  if (count <= visible) return 0;
  return Math.min(Math.max(0, selectedIndex - visible + 1), count - visible);
}

function formatCommandName(command: SlashCommand): string {
  const aliases = command.aliases ?? [];
  const aliasLabel = aliases.length > 0 ? ` (${aliases.join(", ")})` : "";
  return `/${command.name}${aliasLabel}`;
}

export function SlashPalette({ matches, selectedIndex }: SlashPaletteProps): React.ReactElement {
  const { stdout } = useStdout();
  // AI-terminal panes report a handful of rows; rendering the full list there
  // pushes the frame past the viewport, hiding the caret and breaking Ink's
  // frame erase (rows visibly vanish while navigating). Bound the palette to
  // what the terminal can actually show alongside the rest of the shell.
  const terminalRows = stdout?.rows ?? 24;
  const visible = Math.max(MIN_VISIBLE_ROWS, Math.min(MAX_VISIBLE_ROWS, terminalRows - RESERVED_ROWS));

  if (matches.length === 0) {
    return (
      <Box marginLeft={2}>
        <Text dimColor>No matching commands</Text>
      </Box>
    );
  }

  const start = paletteWindowStart(selectedIndex, matches.length, visible);
  const end = start + visible;
  const hiddenAbove = start;
  const hiddenBelow = matches.length - end;
  const g = glyphs();
  return (
    <Box flexDirection="column" marginLeft={2}>
      {hiddenAbove > 0 ? (
        <Box>
          <Text dimColor>{`↑ ${hiddenAbove} more above`}</Text>
        </Box>
      ) : null}
      {matches.slice(start, end).map((command, offset) => {
        const index = start + offset;
        const selected = index === selectedIndex;
        const name = formatCommandName(command);
        return (
          <Box key={command.name} backgroundColor={selected ? "#171D2E" : undefined}>
            <Text>
              <Text color={selected ? PALETTE.accent : undefined}>{selected ? `${g.caret} ` : "  "}</Text>
              <Text color={selected ? PALETTE.accent : "white"} bold={selected}>{name}</Text>
              <Text dimColor>
                {`  ${command.summary}${command.argHint ? `  ${command.argHint}` : ""}`}
              </Text>
            </Text>
          </Box>
        );
      })}
      {hiddenBelow > 0 ? (
        <Box>
          <Text dimColor>{`↓ ${hiddenBelow} more below`}</Text>
        </Box>
      ) : null}
      <Box marginTop={0}>
        <Keycap>↑</Keycap>
        <Keycap>↓</Keycap>
        <Text dimColor>{" select   "}</Text>
        <Keycap>Tab</Keycap>
        <Text dimColor>{" complete   "}</Text>
        <Keycap>↵</Keycap>
        <Text dimColor>{" run   "}</Text>
        <Keycap>Esc</Keycap>
        <Text dimColor>{" close"}</Text>
      </Box>
    </Box>
  );
}
