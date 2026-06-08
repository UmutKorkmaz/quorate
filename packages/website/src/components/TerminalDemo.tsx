import { useEffect, useMemo, useState } from "react";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type DemoPhase = "palette" | "reviewing" | "findings";

const PALETTE_LINES = [
  " ╭──────────────────────────────────────────────────────────────╮",
  " │ › /re                                                         │",
  " ╰──────────────────────────────────────────────────────────────╯",
  "   ▸ /review     Review the loaded/current diff   [subject]",
  "     /rerun      Run the last request again",
  "     /roles      Limit council roles",
  "   ↑/↓ select · Tab complete · Enter run · Esc close"
] as const;

const STATUS_TEMPLATE =
  "  {spinner} reviewing · review · claude+codex · diff loaded · {elapsed} · esc to interrupt";

const FINDING_LINES = [
  "",
  "   FAIL  src/auth.ts:42",
  "   HIGH  Missing authorization check — token introspection result is trusted",
  "         without verifying the audience claim."
] as const;

function formatElapsed(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TerminalDemo() {
  const [phase, setPhase] = useState<DemoPhase>("palette");
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [typedInput, setTypedInput] = useState("");

  useEffect(() => {
    const input = "/re";
    let i = 0;
    const typeTimer = window.setInterval(() => {
      i += 1;
      setTypedInput(input.slice(0, i));
      if (i >= input.length) window.clearInterval(typeTimer);
    }, 180);
    return () => window.clearInterval(typeTimer);
  }, []);

  useEffect(() => {
    const paletteTimer = window.setTimeout(() => setPhase("reviewing"), 4200);
    return () => window.clearTimeout(paletteTimer);
  }, []);

  useEffect(() => {
    if (phase !== "reviewing") return;
    const findingsTimer = window.setTimeout(() => setPhase("findings"), 3200);
    return () => window.clearTimeout(findingsTimer);
  }, [phase]);

  useEffect(() => {
    if (phase === "palette") return;
    const spinTimer = window.setInterval(() => {
      setFrame((f) => (f + 1) % BRAILLE_FRAMES.length);
    }, 90);
    return () => window.clearInterval(spinTimer);
  }, [phase]);

  useEffect(() => {
    if (phase === "palette") return;
    const elapsedTimer = window.setInterval(() => {
      setElapsed((e) => (e >= 8 ? 8 : e + 1));
    }, 1000);
    return () => window.clearInterval(elapsedTimer);
  }, [phase]);

  const statusLine = useMemo(() => {
    const spinner = BRAILLE_FRAMES[frame];
    return STATUS_TEMPLATE.replace("{spinner}", spinner).replace(
      "{elapsed}",
      formatElapsed(elapsed)
    );
  }, [frame, elapsed]);

  return (
    <div className="relative mx-auto max-w-3xl">
      <div className="absolute -inset-4 rounded-2xl bg-quorate-accent/10 blur-3xl" aria-hidden />
      <div className="relative overflow-hidden rounded-xl border border-quorate-border bg-quorate-surface shadow-(--shadow-terminal)">
        <div className="flex items-center gap-2 border-b border-quorate-border bg-quorate-elevated/60 px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-quorate-fail/80" />
          <span className="h-3 w-3 rounded-full bg-quorate-warn/80" />
          <span className="h-3 w-3 rounded-full bg-quorate-pass/80" />
          <span className="ml-2 font-mono text-xs text-quorate-dim">quorate — council shell</span>
        </div>
        <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed md:text-sm">
          {phase === "palette" ? (
            <>
              <span className="text-quorate-dim">
                {PALETTE_LINES[0]}
                {"\n"}
                {PALETTE_LINES[1].replace("/re", "")}
              </span>
              <span className="text-quorate-accent">{typedInput}</span>
              <span className="animate-pulse-soft text-quorate-accent">▌</span>
              <span className="text-quorate-dim">
                {"                                                         │\n"}
                {PALETTE_LINES[2]}
                {"\n"}
                <span className="text-quorate-accent">{PALETTE_LINES[3]}</span>
                {"\n"}
                {PALETTE_LINES[4]}
                {"\n"}
                {PALETTE_LINES[5]}
                {"\n"}
                {PALETTE_LINES[6]}
              </span>
            </>
          ) : (
            <>
              <span className="text-quorate-amber">{statusLine}</span>
              {phase === "findings" ? (
                <span>
                  {FINDING_LINES.map((line, i) => (
                    <span key={i}>
                      {"\n"}
                      {line.startsWith("   FAIL") ? (
                        <span className="text-quorate-fail">{line}</span>
                      ) : line.startsWith("   HIGH") ? (
                        <span className="text-quorate-high">{line}</span>
                      ) : line ? (
                        <span className="text-quorate-muted">{line}</span>
                      ) : null}
                    </span>
                  ))}
                </span>
              ) : null}
            </>
          )}
        </pre>
      </div>
    </div>
  );
}