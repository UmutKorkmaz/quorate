export type InterruptAction = "clear" | "exit";

export function nextInterruptAction(armed: boolean): InterruptAction {
  return armed ? "exit" : "clear";
}
