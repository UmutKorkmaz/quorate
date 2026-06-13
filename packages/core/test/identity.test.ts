import { describe, expect, it } from "vitest";

import {
  computeReviewId,
  fingerprintFinding,
  findingRuleId,
  normalizeFingerprintText
} from "../src/identity.js";
import type { Finding } from "../src/types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: "high",
    title: "Hardcoded API key",
    body: "A secret is committed in source.",
    ...overrides
  };
}

describe("normalizeFingerprintText", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeFingerprintText("  Hardcoded   API_key!! ")).toBe("hardcoded api key");
  });

  it("is stable for cosmetic punctuation/case differences", () => {
    expect(normalizeFingerprintText("Remove stray console.log")).toBe(
      normalizeFingerprintText("remove stray  Console.Log")
    );
  });

  it("returns empty string for punctuation-only input", () => {
    expect(normalizeFingerprintText("!!!")).toBe("");
  });
});

describe("fingerprintFinding", () => {
  it("is a 16-char lowercase hex string", () => {
    expect(fingerprintFinding(finding())).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for identical findings", () => {
    expect(fingerprintFinding(finding())).toBe(fingerprintFinding(finding()));
  });

  it("ignores cosmetic title differences (severity + file equal)", () => {
    const a = fingerprintFinding(finding({ title: "Hardcoded API key", file: "src/a.ts" }));
    const b = fingerprintFinding(finding({ title: "hardcoded  API_KEY!", file: "src/a.ts" }));
    expect(a).toBe(b);
  });

  it("differs when the file differs (instance identity)", () => {
    const a = fingerprintFinding(finding({ file: "src/a.ts" }));
    const b = fingerprintFinding(finding({ file: "src/b.ts" }));
    expect(a).not.toBe(b);
  });

  it("differs when the severity differs", () => {
    expect(fingerprintFinding(finding({ severity: "high" }))).not.toBe(
      fingerprintFinding(finding({ severity: "low" }))
    );
  });

  it("treats a missing file the same as an empty file, and stably", () => {
    const noFile = fingerprintFinding(finding({ file: undefined }));
    const emptyFile = fingerprintFinding(finding({ file: "" }));
    expect(noFile).toBe(emptyFile);
    // and does not collide with a real path
    expect(noFile).not.toBe(fingerprintFinding(finding({ file: "src/a.ts" })));
  });

  it("does not depend on body, line, provider, or agreement", () => {
    const base = fingerprintFinding(finding());
    expect(
      fingerprintFinding(
        finding({ body: "different body", line: 42, providerId: "glm", agreement: 3 })
      )
    ).toBe(base);
  });
});

describe("findingRuleId", () => {
  it("is class-level: same title+severity in different files share a ruleId", () => {
    const a = findingRuleId(finding({ file: "src/a.ts" }));
    const b = findingRuleId(finding({ file: "src/b.ts" }));
    expect(a).toBe(b);
  });

  it("differs by severity and by title", () => {
    expect(findingRuleId(finding({ severity: "high" }))).not.toBe(
      findingRuleId(finding({ severity: "low" }))
    );
    expect(findingRuleId(finding({ title: "SQL injection" }))).not.toBe(
      findingRuleId(finding({ title: "XSS" }))
    );
  });

  it("is a stable, namespaced, slug-like id", () => {
    expect(findingRuleId(finding())).toMatch(/^quorate\.(critical|high|medium|low|info)\.[0-9a-f]{8}$/);
  });
});

describe("computeReviewId", () => {
  const base = {
    mode: "review" as const,
    subject: "PR #12",
    diff: "diff --git a/x b/x\n+secret = 'abc'\n",
    providerIds: ["glm", "heuristic"],
    councils: ["architect", "security"]
  };

  it("is a 16-char lowercase hex string", () => {
    expect(computeReviewId(base)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for the same inputs", () => {
    expect(computeReviewId(base)).toBe(computeReviewId({ ...base }));
  });

  it("is independent of provider and council ordering", () => {
    expect(
      computeReviewId({ ...base, providerIds: ["heuristic", "glm"], councils: ["security", "architect"] })
    ).toBe(computeReviewId(base));
  });

  it("changes when the diff changes", () => {
    expect(computeReviewId({ ...base, diff: base.diff + "more" })).not.toBe(computeReviewId(base));
  });

  it("is stable across cosmetic CRLF / trailing-whitespace diff differences", () => {
    const crlf = base.diff.replace(/\n/g, "\r\n") + "   \n";
    expect(computeReviewId({ ...base, diff: crlf })).toBe(computeReviewId(base));
  });

  it("falls back to the subject for plan mode with no diff", () => {
    const plan = { ...base, mode: "plan" as const, diff: undefined };
    expect(computeReviewId(plan)).toMatch(/^[0-9a-f]{16}$/);
    // two plan runs with the same subject collapse to the same id
    expect(computeReviewId(plan)).toBe(computeReviewId({ ...plan }));
    // a different subject yields a different id
    expect(computeReviewId({ ...plan, subject: "other" })).not.toBe(computeReviewId(plan));
  });

  it("distinguishes plan-mode from review-mode on the same diff", () => {
    const diff = "a\nb\n";
    expect(computeReviewId({ ...base, mode: "review", diff })).not.toBe(
      computeReviewId({ ...base, mode: "plan", diff })
    );
  });

  it("ignores subject when a diff is present (diff-content identity)", () => {
    expect(computeReviewId({ ...base, subject: "PR #12" })).toBe(
      computeReviewId({ ...base, subject: "PR #999" })
    );
  });

  it("is stable across bare-CR (old-Mac) line endings", () => {
    const cr = base.diff.replace(/\n/g, "\r");
    expect(computeReviewId({ ...base, diff: cr })).toBe(computeReviewId(base));
  });

  it("does not collide when a provider/council name contains a space", () => {
    expect(computeReviewId({ ...base, providerIds: ["a b"], councils: ["c"] })).not.toBe(
      computeReviewId({ ...base, providerIds: ["a"], councils: ["b c"] })
    );
  });
});

describe("Unicode handling", () => {
  it("preserves CJK and accented letters instead of stripping them", () => {
    expect(normalizeFingerprintText("SQLインジェクション")).toBe("sqlインジェクション");
    expect(normalizeFingerprintText("Café Leak")).toBe("café leak");
  });

  it("keeps distinct CJK titles distinct", () => {
    expect(fingerprintFinding(finding({ title: "SQLインジェクション脆弱性", file: "a.ts" }))).not.toBe(
      fingerprintFinding(finding({ title: "SQLアクセス制御不備", file: "a.ts" }))
    );
  });

  it("keeps distinct emoji-only titles distinct via the raw fallback", () => {
    expect(fingerprintFinding(finding({ title: "🔥💥", file: "a.ts" }))).not.toBe(
      fingerprintFinding(finding({ title: "🎯🔑", file: "a.ts" }))
    );
  });
});

// Golden values pin the exact identity algorithm. A change to normalization,
// encoding, or hashing — including drift between this source and the bundled
// GitHub Action — will break these. If you change them intentionally, you are
// invalidating every stored baseline/suppression: bump an identity version and
// say so in the changelog.
describe("golden values (frozen identity)", () => {
  it("fingerprintFinding is pinned", () => {
    expect(
      fingerprintFinding(finding({ severity: "high", title: "Hardcoded API key", file: "src/a.ts" }))
    ).toBe("7f1f624fbee0354e");
  });

  it("findingRuleId is pinned", () => {
    expect(findingRuleId(finding({ severity: "high", title: "Hardcoded API key" }))).toBe(
      "quorate.high.c583aa9b"
    );
  });

  it("computeReviewId is pinned", () => {
    expect(
      computeReviewId({
        mode: "review",
        subject: "PR #12",
        diff: "diff --git a/x b/x\n+secret = 'abc'\n",
        providerIds: ["glm", "heuristic"],
        councils: ["architect", "security"]
      })
    ).toBe("0232956262f61a4e");
  });
});
