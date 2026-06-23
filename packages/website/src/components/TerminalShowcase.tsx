import { useState } from "react";
import { Link } from "react-router-dom";

import {
  EMULATOR_PHASES,
  TerminalEmulator,
  type EmulatorFixture,
  type EmulatorPhase
} from "./TerminalEmulator";

const SHORTCUTS = [
  { keys: "/", action: "Open the command palette" },
  { keys: "Tab", action: "Complete the selected command" },
  { keys: "Shift+Tab", action: "Switch review, plan, and heuristic modes" },
  { keys: "Esc", action: "Stop a running council" },
  { keys: "Ctrl+R", action: "Find a previous command" },
  { keys: "!", action: "Prefix for passthrough shell (e.g. !git status)" }
] as const;

export function TerminalShowcase() {
  const [phase, setPhase] = useState<EmulatorPhase>("welcome");
  const [fixture, setFixture] = useState<EmulatorFixture>("fail");
  const active = EMULATOR_PHASES.find((p) => p.id === phase);

  return (
    <section id="see-it-in-action" className="relative px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center gap-3">
          <span
            className="h-px w-6 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, rgba(110,151,255,0.7), rgba(110,151,255,0.2))"
            }}
            aria-hidden
          />
          <p className="font-mono text-xs tracking-[0.2em] text-quorate-accent uppercase">
            See it in action
          </p>
        </div>
        <h2 className="display-section text-3xl text-white md:text-4xl">
          A review flow you can actually drive
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-quorate-muted">
          The demo mirrors the real shell experience on a Solana escrow app: load a diff,
          choose commands, watch providers run, and land on a single verdict. The same
          shell flow works for every pack. Hover to pause, click a phase to jump, swap
          the diff, or replay the full session.
        </p>

        <div className="mt-12 terminal-showcase-grid">
          <TerminalEmulator
            onPhaseChange={setPhase}
            fixture={fixture}
            onFixtureChange={setFixture}
          />

        <aside className="terminal-showcase-aside">
          <div className="terminal-showcase-panel terminal-showcase-panel--active">
            <p className="terminal-showcase-label">Current phase</p>
            <h3 className="terminal-showcase-phase-title">{active?.label ?? "Welcome"}</h3>
            <p className="terminal-showcase-phase-desc">{active?.caption}</p>

            {/* Phase indicator dots */}
            <div className="mt-4 flex items-center gap-1.5" aria-hidden>
              {EMULATOR_PHASES.map((p) => (
                <span
                  key={p.id}
                  className="h-1 rounded-full transition-all duration-300"
                  style={{
                    width: p.id === phase ? "1.5rem" : "0.375rem",
                    background: p.id === phase
                      ? "rgba(110, 151, 255, 0.9)"
                      : "rgba(42, 51, 72, 0.9)"
                  }}
                />
              ))}
            </div>
          </div>

          <div className="terminal-showcase-panel">
            <p className="terminal-showcase-label">What this proves in the real CLI</p>
            <ul className="terminal-showcase-checklist">
              {phase === "welcome" && (
                <>
                  <li>QUORATE opens with a clear path to the first Solana review</li>
                  <li>Installed agents and active agents are shown separately</li>
                  <li>Role chips reflect the pack-specific council you configured</li>
                </>
              )}
              {phase === "palette" && (
                <>
                  <li>/re + Tab completes the review command predictably</li>
                  <li>Arrow keys move selection; Enter runs the highlighted row</li>
                  <li>The footer keeps keyboard hints visible</li>
                </>
              )}
              {phase === "diff" && (
                <>
                  <li>/git loads the Solana app working tree with file count and +/-</li>
                  <li>The status line names the active diff source</li>
                  <li>/review can load the working tree when no diff is staged</li>
                </>
              )}
              {phase === "running" && (
                <>
                  <li>Each provider reports its own state</li>
                  <li>The status line shows spinner and elapsed time</li>
                  <li>Esc cancels cleanly during a run</li>
                </>
              )}
              {phase === "verdict" && (
                <>
                  <li>PASS / WARN / FAIL appears with the finding count</li>
                  <li>Each card carries severity and file:line evidence</li>
                  <li>Heuristic-only runs are marked as degraded</li>
                </>
              )}
            </ul>
          </div>

          <div className="terminal-showcase-panel">
            <p className="terminal-showcase-label">Keyboard shortcuts</p>
            <dl className="terminal-shortcuts">
              {SHORTCUTS.map((item) => (
                <div key={item.keys} className="terminal-shortcut-row">
                  <dt>
                    <kbd>{item.keys}</kbd>
                  </dt>
                  <dd>{item.action}</dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="terminal-showcase-cta">
            Full hands-on checklist:{" "}
            <Link to="/docs/manual-testing" className="text-quorate-accent hover:underline">
              Manual testing guide →
            </Link>
          </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
