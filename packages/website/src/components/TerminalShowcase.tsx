import { useState } from "react";
import { Link } from "react-router-dom";

import { Section } from "./Section";
import { EMULATOR_PHASES, TerminalEmulator, type EmulatorPhase } from "./TerminalEmulator";

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
  const active = EMULATOR_PHASES.find((p) => p.id === phase);

  return (
    <Section
      id="see-it-in-action"
      eyebrow="See it in action"
      title="A review flow you can actually drive"
      description="The demo mirrors the real shell experience: load a diff, choose commands, watch providers run, and land on a single verdict. Hover to pause, click a phase to jump, or replay the full session."
    >
      <div className="terminal-showcase-grid">
        <TerminalEmulator onPhaseChange={setPhase} />

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
                  <li>QUORATE opens with a clear path to the first review</li>
                  <li>Installed agents and active agents are shown separately</li>
                  <li>Role chips reflect the council you configured</li>
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
                  <li>/git loads the working tree with file count and +/-</li>
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
    </Section>
  );
}
