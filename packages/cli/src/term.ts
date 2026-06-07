import { styleText } from "node:util";
import { shouldColor, type ColorContext } from "@quorate/core";

/** A `node:util` style name, a `#rrggbb` hex color, or a list of either. */
export type TermStyle = string | string[];

const ESC = String.fromCharCode(27);

/** Wrap text in a 24-bit truecolor foreground escape for a `#rrggbb` value. */
function hexEscape(token: string, text: string): string | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(token);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `${ESC}[38;2;${r};${g};${b}m${text}${ESC}[39m`;
}

/**
 * Colorize a string for terminal output, honoring NO_COLOR/FORCE_COLOR/TTY via
 * the core {@link shouldColor} policy. Supports both named `node:util` styles
 * and `#rrggbb` hex colors (the palette is truecolor), applied inner-to-outer so
 * the visual order matches the list. Never throws — unknown tokens are skipped.
 */
export function paint(style: TermStyle, text: string, context: ColorContext = {}): string {
  if (!shouldColor(context)) return text;
  const styles = Array.isArray(style) ? style : [style];
  let out = text;
  for (let index = styles.length - 1; index >= 0; index -= 1) {
    const token = styles[index];
    const hex = typeof token === "string" ? hexEscape(token, out) : null;
    if (hex !== null) {
      out = hex;
      continue;
    }
    try {
      out = styleText(token as Parameters<typeof styleText>[0], out);
    } catch {
      // Unknown style token — leave the text as-is rather than throwing.
    }
  }
  return out;
}

export function bold(text: string, context: ColorContext = {}): string {
  return paint("bold", text, context);
}

export function dim(text: string, context: ColorContext = {}): string {
  return paint("dim", text, context);
}
