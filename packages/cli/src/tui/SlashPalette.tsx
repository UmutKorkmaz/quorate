import React from "react";
import { Box, Text } from "ink";
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

  return (
    <Box flexDirection="column" marginLeft={2}>
      {matches.map((command, index) => {
        const selected = index === selectedIndex;
        const name = `/${command.name}`.padEnd(NAME_COLUMN);
        return (
          <Text key={command.name}>
            <Text color={selected ? "cyan" : undefined}>{selected ? "▸ " : "  "}</Text>
            <Text color={selected ? "cyan" : "white"} bold={selected}>{name}</Text>
            <Text dimColor>
              {`  ${command.summary}${command.argHint ? `  ${command.argHint}` : ""}`}
            </Text>
          </Text>
        );
      })}
      <Text dimColor>{"  ↑/↓ select · Tab complete · Enter run · Esc close"}</Text>
    </Box>
  );
}
