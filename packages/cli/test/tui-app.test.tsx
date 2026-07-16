import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { createDefaultConfig } from "@quorate/core";
import { App } from "../src/tui/app.js";

// Real control bytes the terminal sends; ink-testing-library feeds these to useInput.
const DOWN = "\u001B[B";
const TAB = "\t";
const ENTER = "\r";
const ESC = "\u001B";
const INK_INTERACTION_TIMEOUT_MS = 15_000;

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 15));
}

// Mount on a fresh temp cwd so the suite is HERMETIC: saved sessions live at
// ~/.quorate/sessions/<repoHash(cwd)>, so using the real repo cwd let pre-existing
// sessions leak in (e.g. `/resume` finding sessions when the test assumes none).
function mount(setup?: (cwd: string) => void) {
  const cwd = mkdtempSync(join(tmpdir(), "quorate-tui-"));
  setup?.(cwd);
  return render(<App cwd={cwd} config={createDefaultConfig([])} mode="review" />);
}

describe("App", () => {
  it("renders the composer and status line on mount", () => {
    const { lastFrame, unmount } = mount();
    expect(lastFrame() ?? "").toContain("review");
    unmount();
  });

  it("typing /help and pressing Enter shows help text in the transcript", async () => {
    const { lastFrame, stdin, unmount } = mount();
    stdin.write("/help");
    await flush();
    stdin.write(ENTER);
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/review");
    expect(frame).toContain("/mode");
    expect(frame).toContain("/supply-chain");
    unmount();
  }, INK_INTERACTION_TIMEOUT_MS);

  it("keeps the Ink shell available after a no-change SupplyChainGate scan", async () => {
    const { lastFrame, stdin, unmount } = mount((cwd) => {
      execFileSync("git", ["init", "-q"], { cwd });
    });
    stdin.write("/supply-chain scan");
    await flush();
    stdin.write(ENTER);
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No changes to scan. Pass --diff, --base/--head, or --pr.");
    expect(frame).toContain("›");
    unmount();
  }, INK_INTERACTION_TIMEOUT_MS);

  it("/mode plan (space closes palette) updates the status line to plan", async () => {
    const { lastFrame, stdin, unmount } = mount();
    stdin.write("/mode plan");
    await flush();
    stdin.write(ENTER);
    await flush();
    expect(lastFrame() ?? "").toContain("plan");
    unmount();
  }, INK_INTERACTION_TIMEOUT_MS);

  it("Esc clears the composer buffer", async () => {
    const { lastFrame, stdin, unmount } = mount();
    stdin.write("hello world");
    await flush();
    expect(lastFrame() ?? "").toContain("hello world");
    stdin.write(ESC);
    await flush();
    expect(lastFrame() ?? "").not.toContain("hello world");
    unmount();
  }, INK_INTERACTION_TIMEOUT_MS);

  it("typing /re opens the palette with matching commands and a footer hint", async () => {
    const { lastFrame, stdin, unmount } = mount();
    stdin.write("/re");
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/review");
    expect(frame).toContain("/rerun");
    expect(frame).toContain("select"); // keycap footer
    unmount();
  }, INK_INTERACTION_TIMEOUT_MS);

  it("shows the idle footer hint and replaces it with the palette when open", async () => {
    const { lastFrame, stdin, unmount } = mount();
    await flush();
    expect(lastFrame() ?? "").toContain("Enter send");
    stdin.write("/re");
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("select"); // the palette keycap footer
    expect(frame).not.toContain("Enter send"); // idle footer hidden while the palette is open
    unmount();
  }, INK_INTERACTION_TIMEOUT_MS);

  it("typing /zzz shows the no-matches row", async () => {
    const { lastFrame, stdin, unmount } = mount();
    stdin.write("/zzz");
    await flush();
    expect(lastFrame() ?? "").toContain("No matching commands");
    unmount();
  }, INK_INTERACTION_TIMEOUT_MS);

  it("Down then Enter runs the second match, not the first", async () => {
    const { lastFrame, stdin, unmount } = mount();
    stdin.write("/re");
    await flush();
    stdin.write(DOWN);
    await flush();
    stdin.write(ENTER);
    await flush();
    // matches for "re" are [review, resume, ...]; Down selects resume, which with no
    // saved sessions emits "No saved sessions for this repo." (proves resume ran, not review).
    expect(lastFrame() ?? "").toContain("No saved sessions");
    unmount();
  }, INK_INTERACTION_TIMEOUT_MS);

  it("Tab completes the buffer to the selected command and closes the palette", async () => {
    const { lastFrame, stdin, unmount } = mount();
    stdin.write("/re");
    await flush();
    stdin.write(TAB);
    await flush();
    // First match is /review; Tab fills "/review " into the composer prompt.
    expect(lastFrame() ?? "").toContain("› /review");
    unmount();
  }, INK_INTERACTION_TIMEOUT_MS);
});
