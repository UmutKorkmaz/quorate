import { describe, expect, it } from "vitest";
import {
  glyphs,
  PALETTE,
  roleColor,
  SEVERITY_COLOR,
  shouldColor,
  useAscii,
  VERDICT_COLOR
} from "../src/theme.js";

describe("shouldColor", () => {
  it("disables color when NO_COLOR is present, regardless of value", () => {
    expect(shouldColor({ isTTY: true, env: { NO_COLOR: "1" } })).toBe(false);
    expect(shouldColor({ isTTY: true, env: { NO_COLOR: "" } })).toBe(false);
  });

  it("lets FORCE_COLOR win over NO_COLOR and over a non-TTY", () => {
    expect(shouldColor({ isTTY: false, env: { FORCE_COLOR: "1", NO_COLOR: "1" } })).toBe(true);
    expect(shouldColor({ isTTY: true, env: { FORCE_COLOR: "0" } })).toBe(false);
    expect(shouldColor({ isTTY: true, env: { FORCE_COLOR: "false" } })).toBe(false);
  });

  it("treats an empty FORCE_COLOR as on (a bare `export FORCE_COLOR=`)", () => {
    expect(shouldColor({ isTTY: false, env: { FORCE_COLOR: "" } })).toBe(true);
  });

  it("follows TTY detection when neither override is set", () => {
    expect(shouldColor({ isTTY: true, env: {} })).toBe(true);
    expect(shouldColor({ isTTY: false, env: {} })).toBe(false);
  });
});

describe("useAscii / glyphs", () => {
  it("uses unicode glyphs by default and a UTF-8 locale", () => {
    expect(useAscii({ LANG: "en_US.UTF-8" })).toBe(false);
    expect(glyphs({ LANG: "en_US.UTF-8" }).verdict.pass).toBe("◆");
  });

  it("falls back to ASCII when forced or in a non-UTF-8 locale", () => {
    expect(useAscii({ QUORATE_ASCII: "1" })).toBe(true);
    expect(useAscii({ LANG: "C" })).toBe(true);
    expect(glyphs({ QUORATE_ASCII: "1" }).verdict.fail).toBe("[X]");
  });

  it("provides an ASCII-safe arrow and separator in ASCII mode", () => {
    expect(glyphs({ LANG: "en_US.UTF-8" }).arrow).toBe("→");
    expect(glyphs({ QUORATE_ASCII: "1" }).arrow).toBe("->");
    expect(glyphs({ QUORATE_ASCII: "1" }).separator).toBe("-");
  });

  it("QUORATE_ASCII=0 forces unicode even in a non-UTF-8 locale", () => {
    expect(useAscii({ QUORATE_ASCII: "0", LANG: "C" })).toBe(false);
  });
});

describe("palette", () => {
  it("is the indigo/amber design system (truecolor hex)", () => {
    expect(PALETTE.accent).toBe("#6E97FF"); // indigo brand
    expect(PALETTE.spinner).toBe("#FBBF24"); // amber council accent
    for (const value of [PALETTE.accent, PALETTE.pass, PALETTE.fail]) {
      expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("never paints a degraded verdict green — it is amber, like warn", () => {
    expect(PALETTE.degraded).not.toBe(PALETTE.pass);
    expect(PALETTE.degraded).toBe(PALETTE.warn);
  });

  it("exposes a color for every verdict and severity", () => {
    expect(Object.keys(VERDICT_COLOR).sort()).toEqual(["fail", "pass", "warn"]);
    for (const severity of ["critical", "high", "medium", "low", "info"] as const) {
      expect(SEVERITY_COLOR[severity]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("gives each council role a distinct hue and falls back to dim", () => {
    expect(roleColor("architect")).toBe(PALETTE.roles.architect);
    expect(roleColor("security")).not.toBe(roleColor("qa"));
    expect(roleColor("not-a-role")).toBe(PALETTE.dim);
  });
});
