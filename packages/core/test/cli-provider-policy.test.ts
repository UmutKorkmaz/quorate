import { describe, expect, it } from "vitest";
import { normalizeArgForPolicy, DANGEROUS_LONG_FLAGS, validateCliProvider } from "../src/cli-provider.js";
import type { ProviderConfig } from "../src/types.js";

function baseProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { id: "test", type: "cli", command: "test", args: [], ...overrides };
}

describe("normalizeArgForPolicy", () => {
  const cases: Array<{ name: string; arg: string; expected: string[] }> = [
    { name: "exact long flag", arg: "--resume", expected: ["--resume"] },
    { name: "long flag with =value stripped", arg: "--resume=foo", expected: ["--resume"] },
    { name: "UPPER long flag lowercased", arg: "--RESUME", expected: ["--resume"] },
    { name: "long flag mixed case with value", arg: "--Session-Id=abc", expected: ["--session-id"] },
    { name: "short bundle -rfoo expands prefix + cluster chars", arg: "-rfoo", expected: ["-r", "r", "f", "o", "o"] },
    { name: "short flag -c=x strips value then expands", arg: "-c=x", expected: ["-c", "c"] },
    { name: "bundled short flags -xr", arg: "-xr", expected: ["-x", "x", "r"] },
    { name: "single dash alone left intact", arg: "-", expected: ["-"] },
    { name: "double-dash terminator left intact", arg: "--", expected: ["--"] },
    { name: "bare token lowercased", arg: "bypassPermissions", expected: ["bypasspermissions"] },
    { name: "positional value lowercased", arg: "SomeSubject", expected: ["somesubject"] },
    // A token a malicious {subject} expansion could inject post-substitution:
    // normalizeArgForPolicy is pure over the already-substituted string, so the
    // injected long flag reduces to a single banned token (caught by the backstop
    // and exercised end-to-end at the validateCliProvider layer in the next task).
    { name: "{subject}-injected long flag", arg: "--yolo", expected: ["--yolo"] }
  ];

  for (const testCase of cases) {
    it(`normalizes ${testCase.name}`, () => {
      expect(normalizeArgForPolicy(testCase.arg)).toEqual(testCase.expected);
    });
  }
});

describe("DANGEROUS_LONG_FLAGS", () => {
  it("is long-form only and includes the session/yolo set", () => {
    for (const flag of DANGEROUS_LONG_FLAGS) {
      const isLongFlag = flag.startsWith("--");
      const isBareToken = flag === "bypasspermissions" || flag === "yolo";
      expect(isLongFlag || isBareToken).toBe(true);
    }
    expect(DANGEROUS_LONG_FLAGS).toContain("--continue");
    expect(DANGEROUS_LONG_FLAGS).toContain("--resume");
    expect(DANGEROUS_LONG_FLAGS).toContain("--resume-session");
    expect(DANGEROUS_LONG_FLAGS).toContain("--fork-session");
    expect(DANGEROUS_LONG_FLAGS).toContain("--session");
    expect(DANGEROUS_LONG_FLAGS).toContain("--session-id");
    expect(DANGEROUS_LONG_FLAGS).toContain("--yolo");
    expect(DANGEROUS_LONG_FLAGS).toContain("--experimental-yolo");
    expect(DANGEROUS_LONG_FLAGS).toContain("--afk");
    expect(DANGEROUS_LONG_FLAGS).toContain("bypasspermissions");
    expect(DANGEROUS_LONG_FLAGS).toContain("yolo");
  });

  it("does NOT ban bare short -c or -r globally", () => {
    expect(DANGEROUS_LONG_FLAGS).not.toContain("-c");
    expect(DANGEROUS_LONG_FLAGS).not.toContain("-r");
    expect(DANGEROUS_LONG_FLAGS).not.toContain("c");
    expect(DANGEROUS_LONG_FLAGS).not.toContain("r");
  });
});

describe("validateCliProvider", () => {
  it("rejects an empty arg list", () => {
    const error = validateCliProvider(baseProvider(), [], "prompt");
    expect(error).toContain("has no headless args configured");
  });

  it("rejects an exact dangerous long flag via backstop", () => {
    const error = validateCliProvider(baseProvider(), ["--resume"], "prompt");
    expect(error).toContain("dangerous argument");
  });

  it("rejects --resume=foo (=value form) via backstop", () => {
    const error = validateCliProvider(baseProvider(), ["--resume=foo"], "prompt");
    expect(error).toContain("dangerous argument");
  });

  it("rejects --RESUME (uppercase) via backstop", () => {
    const error = validateCliProvider(baseProvider(), ["--RESUME"], "prompt");
    expect(error).toContain("dangerous argument");
  });

  it("rejects --dangerously-skip-permissions (hyphen extension of --dangerously)", () => {
    const error = validateCliProvider(baseProvider(), ["--dangerously-skip-permissions"], "prompt");
    expect(error).toContain("dangerous argument");
  });

  it("rejects --dangerously-skip-permissions=true (=value form of the extension)", () => {
    const error = validateCliProvider(baseProvider(), ["--dangerously-skip-permissions=true"], "prompt");
    expect(error).toContain("dangerous argument");
  });

  it("rejects --session-id=abc (=value form of an exact listed flag)", () => {
    const error = validateCliProvider(baseProvider(), ["--session-id=abc"], "prompt");
    expect(error).toContain("dangerous argument");
  });

  it("rejects --resume-x via the --resume hyphen-extension prefix", () => {
    const error = validateCliProvider(baseProvider(), ["--resume-x"], "prompt");
    expect(error).toContain("dangerous argument");
  });

  const benignCases = [
    "--verbose",
    "--output-format",
    "--dangerous",
    "--resumable",
    "--sessions"
  ];
  for (const flag of benignCases) {
    it(`allows benign lookalike ${flag} (next char after a shared prefix is a letter, not - or =)`, () => {
      expect(validateCliProvider(baseProvider(), [flag], "prompt")).toBeUndefined();
    });
  }

  it("rejects a {subject}-injected banned token", () => {
    const error = validateCliProvider(baseProvider(), ["--print", "--yolo"], "prompt");
    expect(error).toContain("dangerous argument");
  });

  it("allows bare codex -c key=value (overloaded short flag not globally banned)", () => {
    const error = validateCliProvider(baseProvider({ id: "codex" }), ["exec", "-c", "key=value"], "prompt");
    expect(error).toBeUndefined();
  });

  it("backstop still applies when allowDangerousArgs is false and no allowlist set", () => {
    const error = validateCliProvider(baseProvider(), ["--continue"], "prompt");
    expect(error).toContain("dangerous argument");
  });

  it("does not run the backstop when allowDangerousArgs is true", () => {
    const error = validateCliProvider(baseProvider({ allowDangerousArgs: true }), ["--resume"], "prompt");
    expect(error).toBeUndefined();
  });

  it("permits only allowlisted flags when headlessAllowlist is declared", () => {
    const provider = baseProvider({ headlessAllowlist: ["--print", "--output-format"] });
    const ok = validateCliProvider(provider, ["--print", "--output-format", "text"], "prompt");
    expect(ok).toBeUndefined();
  });

  it("allowlist branch is unaffected by hyphen-extension denylist matching", () => {
    // The allowlist replaces the denylist backstop entirely: an explicitly
    // allowlisted flag is still permitted even though `--resume` would
    // hyphen-extend to it under the denylist.
    const provider = baseProvider({ headlessAllowlist: ["--resume-session"] });
    const ok = validateCliProvider(provider, ["--resume-session"], "prompt");
    expect(ok).toBeUndefined();
  });

  it("rejects a non-allowlisted flag when headlessAllowlist is declared", () => {
    const provider = baseProvider({ headlessAllowlist: ["--print"] });
    const error = validateCliProvider(provider, ["--print", "--resume"], "prompt");
    expect(error).toContain("not in the headless allowlist");
  });

  it("rejects a glued -rfoo when headlessAllowlist only permits -r-free flags", () => {
    const provider = baseProvider({ headlessAllowlist: ["--print"] });
    const error = validateCliProvider(provider, ["--print", "-rfoo"], "prompt");
    expect(error).toContain("not in the headless allowlist");
  });

  it("rejects a prompt larger than maxInputBytes", () => {
    const provider = baseProvider({ args: ["--print"], maxInputBytes: 4 });
    const error = validateCliProvider(provider, ["--print"], "way too long");
    expect(error).toContain("prompt is too large");
  });
});
