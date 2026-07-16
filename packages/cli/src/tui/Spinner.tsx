import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { PALETTE } from "@quorate/core";

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
  color = PALETTE.spinner
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

/** A steady block caret that keeps the idle prompt from repainting on a timer. */
export function Cursor(): React.ReactElement {
  return <Text color={PALETTE.command}>{"█"}</Text>;
}

const BUSY_STAGES = [
  { atMs: 0, label: "reviewing", color: PALETTE.command },
  { atMs: 10_000, label: "still reviewing", color: PALETTE.warn },
  { atMs: 30_000, label: "taking a while", color: PALETTE.dim }
] as const;

/**
 * The "reviewing" label that escalates with elapsed time — cyan under 10s,
 * amber 10–30s, dim past 30s — mirroring Claude Code's "still working" cue so a
 * slow council never looks hung.
 */
export function BusyLabel({ since }: { since: number }): React.ReactElement {
  const [, setTick] = useState(0);
  useEffect(() => {
    // 500ms matches Elapsed so the label's stage transitions stay in step with
    // the visible mm:ss counter.
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);
  const elapsed = Date.now() - since;
  const stage = [...BUSY_STAGES].reverse().find((entry) => elapsed >= entry.atMs) ?? BUSY_STAGES[0];
  return <Text color={stage.color}>{` ${stage.label}`}</Text>;
}
