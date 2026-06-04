import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  areSameFinding,
  jaccard,
  normalizeText,
  sameLocation,
  titleBodySimilarity,
  tokenize
} from "../src/similarity.js";
import type { Finding } from "../src/types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: "medium",
    title: "Title",
    body: "Body",
    ...overrides
  };
}

describe("normalizeText", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeText("  Hello,   WORLD!!  ")).toBe("hello world");
    expect(normalizeText("foo--bar__baz")).toBe("foo bar baz");
    expect(normalizeText("")).toBe("");
  });
});

describe("tokenize", () => {
  it("splits normalized text into tokens", () => {
    expect(tokenize("The quick, BROWN fox.")).toEqual(["the", "quick", "brown", "fox"]);
  });

  it("returns an empty array for empty / punctuation-only input", () => {
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize("!!!")).toEqual([]);
  });
});

describe("jaccard", () => {
  it("computes intersection over union", () => {
    expect(jaccard(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]))).toBeCloseTo(2 / 4);
  });

  it("treats two empty sets as identical and one-empty as disjoint", () => {
    expect(jaccard(new Set(), new Set())).toBe(1);
    expect(jaccard(new Set(["a"]), new Set())).toBe(0);
  });

  it("returns 1 for identical sets and 0 for disjoint sets", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });
});

describe("titleBodySimilarity", () => {
  it("scores findings with overlapping wording highly", () => {
    const a = finding({ title: "SQL injection in query", body: "user input concatenated into SQL" });
    const b = finding({ title: "SQL injection vulnerability", body: "user input concatenated into a SQL query" });
    expect(titleBodySimilarity(a, b)).toBeGreaterThan(0.4);
  });

  it("scores unrelated findings low", () => {
    const a = finding({ title: "SQL injection", body: "concatenated query" });
    const b = finding({ title: "Typo in comment", body: "spelling mistake docs" });
    expect(titleBodySimilarity(a, b)).toBeLessThan(0.2);
  });
});

describe("sameLocation", () => {
  it("matches the same file within the line window", () => {
    expect(sameLocation(finding({ file: "a.ts", line: 10 }), finding({ file: "a.ts", line: 12 }))).toBe(true);
    expect(sameLocation(finding({ file: "a.ts", line: 10 }), finding({ file: "a.ts", line: 20 }))).toBe(false);
  });

  it("treats a missing line as a wildcard on the same file", () => {
    expect(sameLocation(finding({ file: "a.ts" }), finding({ file: "a.ts", line: 99 }))).toBe(true);
  });

  it("matches when both files are undefined and rejects different files", () => {
    expect(sameLocation(finding(), finding())).toBe(true);
    expect(sameLocation(finding({ file: "a.ts" }), finding({ file: "b.ts" }))).toBe(false);
  });

  it("honors a custom line window", () => {
    expect(sameLocation(finding({ file: "a.ts", line: 10 }), finding({ file: "a.ts", line: 18 }), 10)).toBe(true);
  });
});

describe("areSameFinding", () => {
  it("clusters same-location findings worded differently regardless of severity", () => {
    const a = finding({
      severity: "high",
      title: "SQL injection in the user lookup query",
      body: "untrusted user input is concatenated directly into the SQL query string",
      file: "db.ts",
      line: 40
    });
    const b = finding({
      severity: "critical",
      title: "SQL injection vulnerability in the user lookup query",
      body: "untrusted user input is concatenated directly into the SQL query",
      file: "db.ts",
      line: 42
    });
    expect(areSameFinding(a, b)).toBe(true);
  });

  it("does not cluster findings at different locations even with similar text", () => {
    const a = finding({ title: "SQL injection", body: "concatenated query", file: "db.ts", line: 10 });
    const b = finding({ title: "SQL injection", body: "concatenated query", file: "other.ts", line: 10 });
    expect(areSameFinding(a, b)).toBe(false);
  });

  it("respects the exported default threshold", () => {
    expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.6);
  });
});
