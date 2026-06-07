import { describe, expect, it } from "vitest";
import { closestMatch, levenshtein, suggestionSuffix } from "../src/session.js";

const PROVIDERS = ["heuristic", "claude", "codex", "qwen", "kimi", "goose"];
const ROLES = ["architect", "security", "qa", "performance", "maintainer"];

describe("levenshtein", () => {
  it("computes known edit distances", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("claude", "claude")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("closestMatch", () => {
  it("suggests the nearest candidate for a plausible typo", () => {
    expect(closestMatch("claud", PROVIDERS)).toBe("claude");
    expect(closestMatch("codx", PROVIDERS)).toBe("codex");
  });

  it("returns undefined when nothing is close enough", () => {
    // Protects the pinned shell.test substrings: these must NOT gain a suffix.
    expect(closestMatch("nope", PROVIDERS)).toBeUndefined();
    expect(closestMatch("fake-role", ROLES)).toBeUndefined();
  });
});

describe("suggestionSuffix", () => {
  it("appends a did-you-mean only when a close match exists", () => {
    expect(suggestionSuffix(["claud"], PROVIDERS)).toBe('. Did you mean "claude"?');
    expect(suggestionSuffix(["nope"], PROVIDERS)).toBe("");
    expect(suggestionSuffix([], PROVIDERS)).toBe("");
  });
});
