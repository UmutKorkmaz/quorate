import { describe, expect, it } from "vitest";

import { renderHtml, renderJunit, renderSarif } from "../src/export.js";
import { findingRuleId } from "../src/identity.js";
import type { CouncilReport, Finding } from "../src/types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return { severity: "high", title: "Hardcoded API key", body: "A secret is committed.", ...overrides };
}

function report(findings: Finding[], overrides: Partial<CouncilReport> = {}): CouncilReport {
  return {
    verdict: "fail",
    summary: "Quorate found issues.",
    findings,
    providerResults: [
      { providerId: "glm", role: "security", providerType: "api", status: "ok", summary: "ran", findings, durationMs: 12 }
    ],
    metadata: {
      generatedAt: "2026-06-13T00:00:00.000Z",
      mode: "review",
      subject: "PR #1",
      providers: ["glm:security"],
      requestedProviders: ["glm:security"],
      ranProviders: ["glm:security"],
      degraded: false,
      reviewId: "abc123"
    },
    ...overrides
  };
}

describe("renderSarif", () => {
  it("emits schema-shaped SARIF 2.1.0", () => {
    const sarif = JSON.parse(renderSarif(report([finding({ file: "src/a.ts", line: 4 })])));
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.$schema).toMatch(/sarif/i);
    expect(sarif.runs[0].tool.driver.name).toBe("Quorate");
    expect(sarif.runs).toHaveLength(1);
  });

  it("maps severity to SARIF level", () => {
    const sarif = JSON.parse(
      renderSarif(
        report([
          finding({ severity: "critical", file: "a.ts", line: 1 }),
          finding({ severity: "medium", title: "Perf", file: "b.ts", line: 2 }),
          finding({ severity: "info", title: "Style", file: "c.ts", line: 3 })
        ])
      )
    );
    const levels = sarif.runs[0].results.map((r: { level: string }) => r.level);
    expect(levels).toEqual(["error", "warning", "note"]);
  });

  it("encodes file/line locations and the finding fingerprint", () => {
    const f = finding({ file: "src/a.ts", line: 7, fingerprint: "deadbeefdeadbeef" });
    const sarif = JSON.parse(renderSarif(report([f])));
    const result = sarif.runs[0].results[0];
    const loc = result.locations[0].physicalLocation;
    expect(loc.artifactLocation.uri).toBe("src/a.ts");
    expect(loc.region.startLine).toBe(7);
    expect(result.partialFingerprints.quorateFingerprint).toBe("deadbeefdeadbeef");
  });

  it("uses findingRuleId and de-duplicates rules across findings of the same class", () => {
    const a = finding({ file: "a.ts", line: 1 });
    const b = finding({ file: "b.ts", line: 2 }); // same severity+title → same rule, different location
    const sarif = JSON.parse(renderSarif(report([a, b])));
    const rules = sarif.runs[0].tool.driver.rules;
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe(findingRuleId(a));
    expect(sarif.runs[0].results).toHaveLength(2);
    expect(sarif.runs[0].results.every((r: { ruleId: string }) => r.ruleId === findingRuleId(a))).toBe(true);
  });

  it("omits locations for a finding with no file", () => {
    const sarif = JSON.parse(renderSarif(report([finding({ file: undefined })])));
    expect(sarif.runs[0].results[0].locations ?? []).toHaveLength(0);
  });

  it("produces valid, empty results for a clean report", () => {
    const sarif = JSON.parse(renderSarif(report([])));
    expect(sarif.runs[0].results).toHaveLength(0);
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(0);
  });

  it("includes the tool version when provided", () => {
    const sarif = JSON.parse(renderSarif(report([]), { toolVersion: "1.2.3" }));
    expect(sarif.runs[0].tool.driver.version).toBe("1.2.3");
  });
});

describe("renderJunit", () => {
  it("emits a testsuite with one failing testcase per finding", () => {
    const xml = renderJunit(report([finding({ file: "a.ts", line: 1 }), finding({ title: "XSS", file: "b.ts", line: 2 })]));
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml).toMatch(/<testsuites[^>]*tests="2"[^>]*failures="2"/);
    expect((xml.match(/<testcase/g) ?? [])).toHaveLength(2);
    expect((xml.match(/<failure/g) ?? [])).toHaveLength(2);
  });

  it("XML-escapes finding text", () => {
    const xml = renderJunit(report([finding({ title: 'Tag <b> & "q"', body: "a < b && c", file: "a.ts", line: 1 })]));
    expect(xml).toContain("Tag &lt;b&gt; &amp; &quot;q&quot;");
    expect(xml).not.toMatch(/<b>/);
  });

  it("emits a single passing testcase for a clean report", () => {
    const xml = renderJunit(report([]));
    expect(xml).toMatch(/<testsuites[^>]*tests="1"[^>]*failures="0"/);
    expect(xml).not.toContain("<failure");
  });

  it("sets errors=\"0\" on the testsuite (Jenkins/Azure parse it directly)", () => {
    const withFindings = renderJunit(report([finding({ file: "a.ts", line: 1 })]));
    const clean = renderJunit(report([]));
    expect(withFindings).toMatch(/<testsuite[^>]*errors="0"/);
    expect(clean).toMatch(/<testsuite[^>]*errors="0"/);
  });

  it("escapes the severity in the failure type attribute (defensive against cast inputs)", () => {
    const evil = finding({ file: "a.ts", line: 1, severity: 'high" x="y' as Finding["severity"] });
    const xml = renderJunit(report([evil]));
    expect(xml).not.toMatch(/type="high" x="y"/);
    expect(xml).toContain("&quot;");
  });
});

describe("renderHtml", () => {
  it("is a self-contained HTML document with the verdict and findings", () => {
    const html = renderHtml(report([finding({ file: "src/a.ts", line: 4 })]));
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain("FAIL");
    expect(html).toContain("Hardcoded API key");
    expect(html).toContain("src/a.ts");
  });

  it("HTML-escapes finding content to prevent injection", () => {
    const html = renderHtml(report([finding({ title: "<script>alert(1)</script>", file: "a.ts", line: 1 })]));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("truncates very large finding sets with a note", () => {
    const many = Array.from({ length: 600 }, (_, i) => finding({ title: `Issue ${i}`, file: `f${i}.ts`, line: 1 }));
    const html = renderHtml(report(many));
    expect(html).toMatch(/truncat/i);
  });
});
