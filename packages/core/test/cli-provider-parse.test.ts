import { describe, expect, it } from "vitest";
import { parseFindings, parseFindingsFromText } from "../src/cli-provider.js";

describe("parseFindingsFromText", () => {
  it("keeps the full title and splits file/line/body (regression for the 'F | ocus' bug)", () => {
    const line =
      "- [medium] Focus icon overstates actual focus (src/ui/StatusBarManager.ts:97): isFocusSessionActive() only checks a timer exists.";
    const [finding] = parseFindingsFromText(line, "codex", "maintainer");

    expect(finding.severity).toBe("medium");
    expect(finding.title).toBe("Focus icon overstates actual focus");
    expect(finding.file).toBe("src/ui/StatusBarManager.ts");
    expect(finding.line).toBe(97);
    expect(finding.body).toBe("isFocusSessionActive() only checks a timer exists.");
  });

  it("parses a finding with no file reference", () => {
    const [finding] = parseFindingsFromText("- [low] Console logging added: confirm it is safe", "codex", "qa");
    expect(finding.title).toBe("Console logging added");
    expect(finding.file).toBeUndefined();
    expect(finding.body).toBe("confirm it is safe");
  });

  it("parses a title-only finding and supplies a default body", () => {
    const [finding] = parseFindingsFromText("[high] Missing authorization check", "codex", "maintainer");
    expect(finding.title).toBe("Missing authorization check");
    expect(finding.body).toBe("Provider reported this finding.");
  });

  it("parses a file reference without a line number", () => {
    const [finding] = parseFindingsFromText("- [info] Note here (path/to/file.ts): tidy up", "codex", "maintainer");
    expect(finding.title).toBe("Note here");
    expect(finding.file).toBe("path/to/file.ts");
    expect(finding.line).toBeUndefined();
    expect(finding.body).toBe("tidy up");
  });

  it("ignores lines that are not findings", () => {
    expect(parseFindingsFromText("Here is my review summary.", "codex", "maintainer")).toEqual([]);
  });
});

describe("parseFindings (structured-output path)", () => {
  it("parses a fenced ```json block of finding objects", () => {
    const output = [
      "Here is the review.",
      "```json",
      JSON.stringify([
        { severity: "high", title: "Missing authz", body: "endpoint trusts client claims", file: "api.ts", line: 12 },
        { severity: "low", title: "Nit", body: "rename variable", suggestion: "use camelCase" }
      ]),
      "```"
    ].join("\n");

    const findings = parseFindings(output, "codex", "security");
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      severity: "high",
      title: "Missing authz",
      file: "api.ts",
      line: 12,
      providerId: "codex",
      role: "security"
    });
    expect(findings[1].suggestion).toBe("use camelCase");
  });

  it("parses a raw JSON array without a fence", () => {
    const output = '[{"severity":"critical","title":"RCE","body":"unsafe eval of user input"}]';
    const [finding] = parseFindings(output, "review-bot", "security");
    expect(finding.severity).toBe("critical");
    expect(finding.title).toBe("RCE");
    expect(finding.line).toBeUndefined();
  });

  it("skips JSON items with invalid severity and falls back to text when none are valid", () => {
    const output = [
      "```json",
      JSON.stringify([{ severity: "blocker", title: "bad sev", body: "x" }]),
      "```",
      "- [medium] Real finding (a.ts:1): from the bullet fallback"
    ].join("\n");

    const findings = parseFindings(output, "codex", "maintainer");
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe("Real finding");
    expect(findings[0].file).toBe("a.ts");
  });

  it("falls back to the Markdown parser when there is no JSON", () => {
    const [finding] = parseFindings("- [high] Plain bullet finding", "codex", "maintainer");
    expect(finding.title).toBe("Plain bullet finding");
  });

  it("falls back to the Markdown parser when the JSON is malformed", () => {
    const output = "```json\n[ {severity: oops } ]\n```\n- [low] Backup bullet (b.ts:2): recovered";
    const [finding] = parseFindings(output, "codex", "maintainer");
    expect(finding.title).toBe("Backup bullet");
    expect(finding.line).toBe(2);
  });
});
