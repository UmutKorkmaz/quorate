import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { createDefaultConfig } from "@quorate/core";
import { App } from "../src/tui/app.js";

const ENTER = "\r";
const INK_INTERACTION_TIMEOUT_MS = 15_000;

// Render against an isolated, config-less cwd so `firstRun` (and the
// getting-started card it gates) is deterministic and not affected by a
// .quorate.yml / .quorate/ that may exist in the real working directory.
const ISOLATED_CWD = mkdtempSync(join(tmpdir(), "quorate-welcome-"));

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 15));
}

function mount() {
  return render(<App cwd={ISOLATED_CWD} config={createDefaultConfig([])} mode="review" />);
}

describe("App welcome + suggestions", () => {
  it("shows the Quorate welcome hero with the tagline and getting-started card", () => {
    const { lastFrame, unmount } = mount();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Q U O R A T E");
    expect(frame).toContain("Council convened");
    expect(frame).toContain("GETTING STARTED");
    expect(frame).toContain("architect");
    unmount();
  });

  it("suggests the closest command for a transposed typo", async () => {
    const { lastFrame, stdin, unmount } = mount();
    // "/reivew" — no command starts with it, so the palette finds nothing and
    // Enter routes to the unknown-command branch, which offers a suggestion.
    stdin.write("/reivew");
    await flush();
    stdin.write(ENTER);
    await flush();
    expect(lastFrame() ?? "").toContain("Did you mean /review?");
    unmount();
  }, INK_INTERACTION_TIMEOUT_MS);
});
