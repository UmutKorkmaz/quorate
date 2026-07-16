export type InterruptAction = "clear" | "exit";

export function nextInterruptAction(armed: boolean): InterruptAction {
  return armed ? "exit" : "clear";
}

export interface ClassicReadlineInterruptTarget {
  line: string;
  cursor: number;
  close(): void;
  on(event: "SIGINT", listener: () => void): unknown;
  off(event: "SIGINT", listener: () => void): unknown;
}

export interface ClassicStdinInterruptTarget {
  prependListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

export function attachClassicInterruptHandlers(options: {
  readline: ClassicReadlineInterruptTarget;
  stdin: ClassicStdinInterruptTarget;
  clearPresentation(): void;
}): () => void {
  let exitArmed = false;
  let disarmCurrentChunk = false;
  const onInput = (chunk: Buffer | string) => {
    disarmCurrentChunk = Buffer.from(chunk).some((byte) => byte !== 3);
    if (disarmCurrentChunk) exitArmed = false;
  };
  const afterInput = () => {
    if (disarmCurrentChunk) exitArmed = false;
    disarmCurrentChunk = false;
  };
  const onSigint = () => {
    if (disarmCurrentChunk) exitArmed = false;
    if (nextInterruptAction(exitArmed) === "exit") {
      options.readline.close();
      return;
    }
    options.readline.line = "";
    options.readline.cursor = 0;
    options.clearPresentation();
    exitArmed = true;
  };

  options.stdin.prependListener("data", onInput);
  options.readline.on("SIGINT", onSigint);
  options.stdin.on("data", afterInput);

  return () => {
    options.stdin.off("data", onInput);
    options.stdin.off("data", afterInput);
    options.readline.off("SIGINT", onSigint);
  };
}
