import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evidenceInspectionArgs, formatEvidenceInspection } from "../src/evidence";

describe("editor evidence inspection", () => {
  it("preserves selected paths as literal arguments and binds the workspace", () => {
    const root = join(tmpdir(), "quorate workspace");
    const bundle = join(root, "bundle; harmless");
    const policy = join(root, "policy with spaces.json");
    expect(evidenceInspectionArgs(root, bundle, policy)).toEqual([
      "evidence", "inspect", "--cwd", root, "--bundle", "bundle; harmless", "--policy", "policy with spaces.json", "--json"
    ]);
    expect(() => evidenceInspectionArgs(root, "../bundle", policy)).toThrow();
    expect(() => evidenceInspectionArgs(root, bundle, policy + "\0")).toThrow();
    expect(() => evidenceInspectionArgs(root, join(root, "..", "external"), policy)).toThrow();
    expect(() => evidenceInspectionArgs(root, root, policy)).toThrow();
  });

  it.each([40, 64])("renders inconclusive evidence with a %i-character Git revision", (length) => {
    const report = { schemaVersion: 1, kind: "evidence-inspection", state: "inconclusive",
      sourceRevision: "a".repeat(length), records: [], issues: [{ code: "untrusted-producer" }] };
    expect(JSON.parse(formatEvidenceInspection(JSON.stringify(report)))).toEqual(report);
  });

  it("rejects unrelated, malformed, or excessive CLI output", () => {
    expect(() => formatEvidenceInspection('{"kind":"council","state":"verified"}')).toThrow();
    expect(() => formatEvidenceInspection("not JSON")).toThrow();
    expect(() => formatEvidenceInspection("x".repeat(1024 * 1024 + 1))).toThrow();
  });
});
