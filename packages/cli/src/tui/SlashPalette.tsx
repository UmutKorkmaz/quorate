import React from "react";
import { Box, Text } from "ink";
import { glyphs, PALETTE } from "@quorate/core";
import { Keycap } from "./views.js";
import type { SlashCommand } from "./commands.js";

const NAME_COLUMN = 12;

export interface SlashPaletteProps {
  matches: SlashCommand[];
  selectedIndex: number;
}

export function SlashPalette({ matches, selectedIndex }: SlashPaletteProps): React.ReactElement {
  if (matches.length === 0) {
    return (
      <Box marginLeft={2}>
        <Text dimColor>No matching commands</Text>
      </Box>
    );
  }

  const g = glyphs();
  return (
    <Box flexDirection="column" marginLeft={2}>
      {matches.map((command, index) => {
        const selected = index === selectedIndex;
        const name = `/${command.name}`.padEnd(NAME_COLUMN);
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
