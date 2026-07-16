import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "@quorate/core";
import { launchInkShell } from "../src/tui/index.js";

const { renderMock, waitUntilExitMock } = vi.hoisted(() => ({
  renderMock: vi.fn(),
  waitUntilExitMock: vi.fn()
}));

vi.mock("ink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ink")>()),
  render: renderMock
}));

describe("launchInkShell", () => {
  beforeEach(() => {
    waitUntilExitMock.mockReset().mockResolvedValue(undefined);
    renderMock.mockReset().mockReturnValue({ waitUntilExit: waitUntilExitMock });
  });

  it("is an async function with the expected arity", () => {
    expect(typeof launchInkShell).toBe("function");
    expect(launchInkShell.length).toBe(1);
  });

  it("lets the Quorate app own Ctrl+C instead of Ink exiting first", async () => {
    await launchInkShell({
      cwd: "/tmp/quorate-tui-launch-test",
      config: createDefaultConfig([])
    });

    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(renderMock.mock.calls[0]?.[1]).toMatchObject({ exitOnCtrlC: false });
    expect(waitUntilExitMock).toHaveBeenCalledTimes(1);
  });
});
