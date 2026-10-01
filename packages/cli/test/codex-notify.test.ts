import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { mergeCodexNotify, stripCodexNotify, updateCodexNotify } from "../src/codex-notify.js";
import { dispatchHook, parseHookPayload } from "../src/hook-report.js";

describe("Codex turn-completion integration", () => {
  it("roundtrips comments and tables while treating a binary path as argv data", () => {
    const original = '# keep\nmodel = "test"\n[projects."/tmp/repo"]\ntrust_level = "trusted"\n';
    const binary = '/path with spaces/"$`quorate';
    const merged = mergeCodexNotify(original, binary);
    expect(parse(merged).notify).toEqual([binary, "hook-report", "--source", "codex", "--event", "notify"]);
    expect(mergeCodexNotify(merged, "other")).toBe(merged);
    expect(stripCodexNotify(merged)).toBe(original);
  });
  it.each(['notify = []\n', '"notify" = [\n "other",\n "arg"\n]\n'])('preserves an existing notification: %s', (original) => {
    expect(mergeCodexNotify(original, "quorate")).toBe(original);
    expect(stripCodexNotify(original)).toBe(original);
  });
  it("refuses malformed TOML and rechecks a newly occupied slot at apply time", () => {
    expect(() => mergeCodexNotify('notify = [', 'quorate')).toThrow();
    const file = join(mkdtempSync(join(tmpdir(), "q-notify-")), "config.toml");
    writeFileSync(file, 'notify = ["existing"]\n');
    updateCodexNotify(file, "quorate");
    expect(readFileSync(file, "utf8")).toBe('notify = ["existing"]\n');
  });
  it("maps the actual Codex payload into a visible spool run", () => {
    const dir = mkdtempSync(join(tmpdir(), "q-notify-"));
    const payload = parseHookPayload(JSON.stringify({ type: "agent-turn-complete", "thread-id": "thread-42", "last-assistant-message": "Finished tests", cwd: "/repo" }));
    dispatchHook("codex", "notify", payload, { dir, cwd: "/repo", pid: 123 });
    expect(JSON.parse(readFileSync(join(dir, "codex-thread-42.meta.json"), "utf8"))).toMatchObject({ source: "codex", status: "done" });
    expect(readFileSync(join(dir, "codex-thread-42.ndjson"), "utf8")).toContain("Finished tests");
  });
});
