import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import * as interactiveInterrupt from "../src/interactive-interrupt.js";
import { nextInterruptAction } from "../src/interactive-interrupt.js";

type ClassicReadline = EventEmitter & {
  line: string;
  cursor: number;
  close: ReturnType<typeof vi.fn>;
};

type AttachClassicInterruptHandlers = (options: {
  readline: ClassicReadline;
  stdin: EventEmitter;
  clearPresentation(): void;
}) => () => void;

const attachClassicInterruptHandlers = (
  interactiveInterrupt as Record<string, unknown>
).attachClassicInterruptHandlers as AttachClassicInterruptHandlers;

function installClassicInterruptHandlers(options: Parameters<AttachClassicInterruptHandlers>[0]): () => void {
  expect(attachClassicInterruptHandlers).toBeTypeOf("function");
  return attachClassicInterruptHandlers(options);
}

function classicFixture() {
  const readline = Object.assign(new EventEmitter(), {
    line: "abc",
    cursor: 3,
    close: vi.fn()
  }) as ClassicReadline;
  const stdin = new EventEmitter();
  const clearPresentation = vi.fn();
  const parseCtrlC = (chunk: Buffer | string) => {
    for (const byte of Buffer.from(chunk)) {
      if (byte === 3) readline.emit("SIGINT");
    }
  };
  stdin.on("data", parseCtrlC);
  const cleanup = installClassicInterruptHandlers({ readline, stdin, clearPresentation });

  return { readline, stdin, clearPresentation, cleanup, parseCtrlC };
}

describe("nextInterruptAction", () => {
  it("clears before it exits", () => {
    expect(nextInterruptAction(false)).toBe("clear");
    expect(nextInterruptAction(true)).toBe("exit");
  });
});

describe("attachClassicInterruptHandlers", () => {
  it("clears readline's internal line before redrawing presentation", () => {
    const { readline, clearPresentation, cleanup } = classicFixture();

    readline.emit("SIGINT");

    expect(readline.line).toBe("");
    expect(readline.cursor).toBe(0);
    expect(clearPresentation).toHaveBeenCalledTimes(1);
    expect(readline.close).not.toHaveBeenCalled();
    cleanup();
  });

  it("disarms every Ctrl+C decision in a mixed input chunk", () => {
    const { readline, stdin, clearPresentation, cleanup } = classicFixture();

    readline.emit("SIGINT");
    stdin.emit("data", "\u0003x\u0003");

    expect(readline.close).not.toHaveBeenCalled();
    expect(clearPresentation).toHaveBeenCalledTimes(3);
    cleanup();
  });

  it("leaves exit disarmed after a Ctrl+C plus normal-byte chunk completes", () => {
    const { readline, stdin, clearPresentation, cleanup } = classicFixture();

    stdin.emit("data", "\u0003x");
    readline.emit("SIGINT");

    expect(readline.close).not.toHaveBeenCalled();
    expect(clearPresentation).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("closes readline on a second consecutive SIGINT", () => {
    const { readline, clearPresentation, cleanup } = classicFixture();

    readline.emit("SIGINT");
    readline.emit("SIGINT");

    expect(clearPresentation).toHaveBeenCalledTimes(1);
    expect(readline.close).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("removes its SIGINT and stdin listeners during cleanup", () => {
    const { readline, stdin, cleanup, parseCtrlC } = classicFixture();

    expect(readline.listenerCount("SIGINT")).toBe(1);
    expect(stdin.listenerCount("data")).toBe(3);

    cleanup();

    expect(readline.listenerCount("SIGINT")).toBe(0);
    expect(stdin.listeners("data")).toEqual([parseCtrlC]);
  });
});
