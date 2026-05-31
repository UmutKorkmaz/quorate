import { describe, expect, it } from "vitest";
import { parseFindingsFromText } from "../src/cli-provider.js";

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
