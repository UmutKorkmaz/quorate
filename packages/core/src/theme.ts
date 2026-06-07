import type { Severity, Verdict } from "./types.js";

/**
 * Quorate's "Council Chamber" palette.
 *
 * Color values are Ink/chalk color names so the same palette can drive the Ink
 * TUI directly and a `node:util` `styleText` helper in the plain shell. Markdown
 * and PR-comment output stay plain text. Changing a role here re-themes every
 * surface at once — the Oh My Posh "named segment palette" model.
 */
export interface QuoratePalette {
  /** Council identity accent (banners, headings, the ◆ quorum mark). Indigo. */
  accent: string;
  /** Interactive/command highlight (slash commands, prompt, selection). Indigo. */
  command: string;
  /** The braille spinner — the council at work. Amber. */
  spinner: string;
  /** Cross-model agreement dots. Amber. */
  agreement: string;
  pass: string;
  warn: string;
  fail: string;
  /**
   * Honest amber for a heuristic-only / low-confidence verdict. NEVER green —
   * Quorate's intellectual honesty made visible.
   */
  degraded: string;
  severity: Record<Severity, string>;
  /** The five council roles, each with its own hue. */
  roles: Record<string, string>;
  /** Available + runnable provider. */
  ok: string;
  /** Available but missing a headless profile. */
  needsProfile: string;
  /** Not found on PATH. */
  missing: string;
  dim: string;
}

/**
 * The "Council Chamber" palette — indigo brand + amber council accent, carried
 * verbatim from the Quorate design system. Values are truecolor hex; Ink renders
 * them directly and downsamples on low-color terminals, while the terminal
 * `paint()` helper emits a 24-bit escape. NO_COLOR strips all of it.
 */
export const PALETTE: QuoratePalette = {
  accent: "#6E97FF",
  command: "#6E97FF",
  spinner: "#FBBF24",
  agreement: "#FBBF24",
  pass: "#34D399",
  warn: "#FBBF24",
  fail: "#F87171",
  degraded: "#FBBF24",
  severity: {
    critical: "#FB7185",
    high: "#F87171",
    medium: "#FBBF24",
    low: "#38BDF8",
    info: "#7C8597"
  },
  roles: {
    architect: "#8AA6FF",
    security: "#FB7185",
    qa: "#34D399",
    performance: "#FBBF24",
    maintainer: "#38BDF8"
  },
  ok: "#34D399",
  needsProfile: "#FBBF24",
  missing: "#F87171",
  dim: "#6B748A"
};

/** The hue for a council role, falling back to dim for unknown roles. */
export function roleColor(role: string): string {
  return PALETTE.roles[role] ?? PALETTE.dim;
}

/** Per-role mono glyphs approximating the design's Lucide icons (compass,
 *  shield, flask, zap, wrench), with single-letter ASCII fallbacks. */
const ROLE_GLYPHS_UNICODE: Record<string, string> = {
  architect: "△",
  security: "⬡",
  qa: "◇",
  performance: "↯",
  maintainer: "⌥"
};
const ROLE_GLYPHS_ASCII: Record<string, string> = {
  architect: "A",
  security: "S",
  qa: "Q",
  performance: "P",
  maintainer: "M"
};

/** The glyph for a council role, ASCII-aware. Falls back to a bullet/asterisk. */
export function roleGlyph(role: string, env: NodeJS.ProcessEnv = process.env): string {
  const set = useAscii(env) ? ROLE_GLYPHS_ASCII : ROLE_GLYPHS_UNICODE;
  return set[role] ?? (useAscii(env) ? "*" : "•");
}

/** Verdict → palette color. Replaces ad-hoc maps scattered across the UI. */
export const VERDICT_COLOR: Record<Verdict, string> = {
  pass: PALETTE.pass,
  warn: PALETTE.warn,
  fail: PALETTE.fail
};

/** Severity → palette color. */
export const SEVERITY_COLOR: Record<Severity, string> = PALETTE.severity;

export interface GlyphSet {
  /** Verdict gavel chips. */
  verdict: Record<Verdict, string>;
  /** A finding's severity marker. */
  severity: string;
  /** Provider segment marker (status line, doctor). */
  provider: string;
  /** Diff segment marker. */
  diff: string;
  /** Mode segment marker. */
  mode: string;
  /** An active / selected item. */
  active: string;
  /** A passing / available check. */
  check: string;
  /** A warning / needs-attention check. */
  warn: string;
  /** A failing / missing check. */
  cross: string;
  /** Palette selection caret. */
  caret: string;
  /** Inline separator between status segments. */
  separator: string;
  /** Points from a problem to its fix (e.g. in doctor detail lines). */
  arrow: string;
  /** An unfilled agreement meter dot (the filled dot reuses `active`). */
  dotOff: string;
  /** Celebration / AI moment mark (the welcome tagline). */
  sparkle: string;
  /** A changed-file marker in the diff summary card. */
  file: string;
  /** A loaded-diff / branch marker. */
  branch: string;
  /** Filled / empty cells of an indeterminate progress bar. */
  barOn: string;
  barOff: string;
}

const UNICODE_GLYPHS: GlyphSet = {
  verdict: { pass: "◆", warn: "▲", fail: "✖" },
  severity: "●",
  provider: "⌘",
  diff: "⎇",
  mode: "◷",
  active: "●",
  check: "✔",
  warn: "⚠",
  cross: "✖",
  caret: "▸",
  separator: "·",
  arrow: "→",
  dotOff: "○",
  sparkle: "✦",
  file: "▤",
  branch: "⎇",
  barOn: "█",
  barOff: "░"
};

const ASCII_GLYPHS: GlyphSet = {
  verdict: { pass: "[P]", warn: "[!]", fail: "[X]" },
  severity: "*",
  provider: "#",
  diff: "@",
  mode: ">",
  active: "*",
  check: "+",
  warn: "!",
  cross: "x",
  caret: ">",
  separator: "-",
  arrow: "->",
  dotOff: ".",
  sparkle: "*",
  file: "-",
  branch: "@",
  barOn: "#",
  barOff: "."
};

/**
 * Whether to fall back to plain-ASCII glyphs. Triggered explicitly by
 * `QUORATE_ASCII=1`, or inferred from a non-UTF-8 locale where box/braille glyphs
 * render poorly.
 */
export function useAscii(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.QUORATE_ASCII;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG ?? "";
  if (locale && !/utf-?8/i.test(locale)) return true;
  return false;
}

/** The active glyph set for the current environment. */
export function glyphs(env: NodeJS.ProcessEnv = process.env): GlyphSet {
  return useAscii(env) ? ASCII_GLYPHS : UNICODE_GLYPHS;
}

export interface ColorContext {
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * Whether ANSI color should be emitted, honoring the `NO_COLOR` and
 * `FORCE_COLOR` conventions (https://no-color.org, https://force-color.org).
 *
 * Precedence: `FORCE_COLOR` wins when set, then `NO_COLOR` presence disables,
 * otherwise color follows TTY detection.
 */
export function shouldColor(context: ColorContext = {}): boolean {
  const env = context.env ?? process.env;
  const force = env.FORCE_COLOR;
  if (force !== undefined) {
    // Any defined value except an explicit off-switch enables color (an empty
    // FORCE_COLOR — e.g. a bare `export FORCE_COLOR=` — still means "on").
    return force !== "0" && force !== "false";
  }
  if (env.NO_COLOR !== undefined) return false;
  return context.isTTY ?? Boolean(process.stdout?.isTTY);
}
