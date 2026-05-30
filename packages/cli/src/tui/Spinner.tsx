import React, { useEffect, useState } from "react";
import { Text } from "ink";

/** Braille spinner frame sets. `braille` is the default running indicator. */
export const SPINNERS: Record<string, string[]> = {
  braille: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  dots: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"],
  pulse: ["⢎⡰", "⢎⡡", "⢎⡑", "⢎⠱", "⠎⡱", "⢊⡱", "⢌⡱", "⢆⡱"],
  bounce: ["⠁", "⠂", "⠄", "⠂"],
  orbit: ["⠈", "⠐", "⠠", "⢀", "⡀", "⠄", "⠂", "⠁"]
};

export interface SpinnerProps {
  frames?: string[];
  intervalMs?: number;
  color?: string;
}

/** An animated braille spinner. Re-renders only its own frame on a timer. */
export function Spinner({
  frames = SPINNERS.braille,
  intervalMs = 90,
  color = "cyan"
}: SpinnerProps): React.ReactElement {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % frames.length), intervalMs);
    return () => clearInterval(id);
  }, [frames, intervalMs]);
  return <Text color={color}>{frames[index % frames.length]}</Text>;
}

/** Format a millisecond duration as mm:ss. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** A live mm:ss counter that ticks while mounted. */
export function Elapsed({ since }: { since: number }): React.ReactElement {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);
  return <Text>{formatElapsed(Date.now() - since)}</Text>;
}
