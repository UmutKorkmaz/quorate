import { useCallback, useEffect, useMemo, useState } from "react";

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export type EmulatorPhase = "welcome" | "palette" | "diff" | "running" | "verdict";

export const EMULATOR_PHASES: ReadonlyArray<{
  id: EmulatorPhase;
  label: string;
  caption: string;
}> = [
  {
    id: "welcome",
    label: "Welcome",
    caption: "Shows your council, detected agents, and the fastest path to a first review."
  },
  {
    id: "palette",
    label: "Slash palette",
    caption: "Type /re, press Tab, and run repeatable review workflows without leaving the shell."
  },
  {
    id: "diff",
    label: "Diff loaded",
    caption: "Summarizes the working tree before reviewers spend tokens on it."
  },
  {
    id: "running",
    label: "Council running",
    caption: "Fans out to available providers, tracks progress, and keeps interrupt controls visible."
  },
  {
    id: "verdict",
    label: "Verdict",
    caption: "Combines agreement, severity, and file:line evidence into one action-ready result."
  }
] as const;

const PHASE_MS: Record<EmulatorPhase, number> = {
  welcome: 2800,
  palette: 3400,
  diff: 2200,
  running: 3400,
  verdict: 4200
};

const ROLES = [
  { id: "architect", glyph: "△", color: "text-quorate-architect" },
  { id: "security", glyph: "⬡", color: "text-quorate-security" },
  { id: "qa", glyph: "◇", color: "text-quorate-qa" },
  { id: "performance", glyph: "↯", color: "text-quorate-performance" },
  { id: "maintainer", glyph: "⌥", color: "text-quorate-maintainer" }
] as const;

const PALETTE = [
  { name: "/review", hint: "Review the loaded diff", active: true },
  { name: "/rerun", hint: "Run the last request again", active: false },
  { name: "/resume", hint: "Resume a saved session", active: false }
] as const;

const DIFF_FILES = [
  { path: "src/auth.ts", add: 34, del: 12 },
  { path: "src/middleware/validate.ts", add: 51, del: 8 },
  { path: "tests/auth.test.ts", add: 28, del: 14 },
  { path: "package.json", add: 15, del: 8 }
] as const;

const RUNNING = [
  { id: "heuristic", role: "maintainer", state: "done" as const, note: "2 findings" },
  { id: "claude", role: "security", state: "running" as const, note: "" },
  { id: "codex", role: "qa", state: "queued" as const, note: "" }
] as const;

function formatElapsed(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function nextPhase(current: EmulatorPhase): EmulatorPhase {
  const order = EMULATOR_PHASES.map((p) => p.id);
  const i = order.indexOf(current);
  return order[(i + 1) % order.length] ?? "welcome";
}

function TerminalChrome({ cwd }: { cwd: string }) {
  return (
    <div className="terminal-chrome">
      <div className="terminal-lights" aria-hidden>
        <span className="terminal-light terminal-light--close" />
        <span className="terminal-light terminal-light--min" />
        <span className="terminal-light terminal-light--max" />
      </div>
      <span className="terminal-title">quorate — {cwd}</span>
      <span className="terminal-badge">Council shell</span>
    </div>
  );
}

function RoleChips() {
  return (
    <div className="terminal-roles">
      <span className="terminal-roles-label">Council</span>
      {ROLES.map((role) => (
        <span key={role.id} className={`terminal-role-chip ${role.color}`}>
          {role.glyph} {role.id}
        </span>
      ))}
    </div>
  );
}

function PhaseRail({
  phase,
  paused,
  onSelect
}: {
  phase: EmulatorPhase;
  paused: boolean;
  onSelect: (phase: EmulatorPhase) => void;
}) {
  const phaseIndex = EMULATOR_PHASES.findIndex((p) => p.id === phase);
  const progressPct = Math.round(((phaseIndex + 1) / EMULATOR_PHASES.length) * 100);

  return (
    <div className="terminal-phase-rail" role="tablist" aria-label="Demo phases">
      <div className="terminal-phase-rail-pills">
        {EMULATOR_PHASES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={phase === item.id}
            className={
              phase === item.id
                ? "terminal-phase-pill terminal-phase-pill--active"
                : "terminal-phase-pill"
            }
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </button>
        ))}
        {paused ? <span className="terminal-phase-paused">paused</span> : null}
      </div>
      <div className="terminal-phase-progress" aria-hidden>
        <span
          className="terminal-phase-progress-fill"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

export function TerminalEmulator({
  onPhaseChange,
  showPhaseRail = true
}: {
  onPhaseChange?: (phase: EmulatorPhase) => void;
  showPhaseRail?: boolean;
}) {
  const [phase, setPhase] = useState<EmulatorPhase>("welcome");
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [typed, setTyped] = useState("");
  const [composer, setComposer] = useState("");
  const [paused, setPaused] = useState(false);
  const [loopKey, setLoopKey] = useState(0);

  const cwd = "~/Projects/my-app";

  const goToPhase = useCallback((next: EmulatorPhase) => {
    setPhase(next);
    onPhaseChange?.(next);
  }, [onPhaseChange]);

  const replay = useCallback(() => {
    setLoopKey((k) => k + 1);
    setElapsed(0);
    setTyped("");
    setComposer("");
    goToPhase("welcome");
  }, [goToPhase]);

  useEffect(() => {
    onPhaseChange?.("welcome");
  }, [onPhaseChange]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => {
      setPhase((current) => {
        const next = nextPhase(current);
        onPhaseChange?.(next);
        return next;
      });
    }, PHASE_MS[phase]);
    return () => window.clearTimeout(timer);
  }, [phase, paused, loopKey, onPhaseChange]);

  useEffect(() => {
    if (phase !== "palette") return;
    const input = "/re";
    let i = 0;
    setTyped("");
    const timer = window.setInterval(() => {
      i += 1;
      setTyped(input.slice(0, i));
      if (i >= input.length) window.clearInterval(timer);
    }, 160);
    return () => window.clearInterval(timer);
  }, [phase, loopKey]);

  useEffect(() => {
    if (phase === "diff") {
      setComposer("/review");
      return;
    }
    if (phase === "welcome" || phase === "palette") {
      setComposer(phase === "palette" ? typed : "");
    }
    if (phase === "running" || phase === "verdict") {
      setComposer("");
    }
  }, [phase, typed]);

  useEffect(() => {
    if (phase !== "running" && phase !== "verdict") return;
    const spin = window.setInterval(() => setFrame((f) => (f + 1) % BRAILLE.length), 90);
    const clock = window.setInterval(() => setElapsed((e) => (e >= 12 ? 12 : e + 1)), 1000);
    return () => {
      window.clearInterval(spin);
      window.clearInterval(clock);
    };
  }, [phase, loopKey]);

  useEffect(() => {
    if (phase === "running") setElapsed(0);
  }, [phase, loopKey]);

  const statusLine = useMemo(() => {
    if (phase === "diff") {
      return { mode: "review", agents: "claude+codex+heuristic", diff: "git working tree", hint: "" };
    }
    if (phase === "running" || phase === "verdict") {
      return {
        mode: "review",
        agents: "claude+codex+heuristic",
        diff: "git working tree",
        hint: "esc to interrupt"
      };
    }
    return {
      mode: "review",
      agents: "heuristic",
      diff: "",
      hint: "heuristic only → /use available"
    };
  }, [phase]);

  const activeCaption = EMULATOR_PHASES.find((p) => p.id === phase)?.caption ?? "";

  return (
    <div
      className="terminal-emulator"
      aria-label="Animated Quorate terminal session"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="terminal-emulator-glow" aria-hidden />
      <div className="terminal-window">
        <TerminalChrome cwd={cwd} />
        {showPhaseRail ? (
          <PhaseRail phase={phase} paused={paused} onSelect={goToPhase} />
        ) : null}
        <div className="terminal-body">
          <div className="terminal-scanlines" aria-hidden />

          {(phase === "welcome" || phase === "palette") && (
            <header key={`${phase}-welcome`} className="terminal-welcome terminal-phase-content">
              <div className="terminal-welcome-top">
                <span className="terminal-wordmark">
                  <span className="text-quorate-pass">◆</span> Q U O R A T E
                </span>
                <span className="terminal-meta">node 22 · {cwd}</span>
              </div>
              <p className="terminal-tagline">
                <span className="text-quorate-amber">✦</span> Council convened. A panel of AI reviewers,
                one binding verdict.
              </p>
              <div className="terminal-getting-started">
                <p className="terminal-getting-started-label">GETTING STARTED</p>
                <ul>
                  <li>
                    <code>/git</code>
                    <span>load the working tree as a diff</span>
                  </li>
                  <li>
                    <code>/use available</code>
                    <span>enable every installed agent</span>
                  </li>
                  <li>
                    <code>/review</code>
                    <span>convene the council on the loaded diff</span>
                  </li>
                </ul>
              </div>
              <RoleChips />
              <p className="terminal-agents-line">
                <span className="text-quorate-dim">Installed on PATH</span>{" "}
                <strong>3 of 17 agents</strong>{" "}
                <span className="text-quorate-pass">claude ✔ codex ✔</span>
                <span className="text-quorate-dim"> · heuristic always on</span>
              </p>
              <p className="terminal-agents-line">
                <span className="text-quorate-dim">Active this session</span>{" "}
                <span className="text-quorate-amber">heuristic ●</span>
              </p>
            </header>
          )}

          {phase === "diff" && (
            <div key="diff" className="terminal-diff-card terminal-phase-content">
              <p>
                <span className="text-quorate-pass">⎇ Loaded diff from </span>
                <strong className="text-quorate-pass">git working tree</strong>
              </p>
              <div className="terminal-diff-stats">
                <span>4 files changed</span>
                <span>
                  <span className="text-quorate-pass">+128</span>{" "}
                  <span className="text-quorate-fail">−42</span>
                </span>
              </div>
              <ul className="terminal-diff-files">
                {DIFF_FILES.map((file) => (
                  <li key={file.path}>
                    <span className="text-quorate-muted">{file.path}</span>
                    <span>
                      <span className="text-quorate-pass">+{file.add}</span>{" "}
                      <span className="text-quorate-fail">−{file.del}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-quorate-dim text-xs">next: /review</p>
            </div>
          )}

          {(phase === "running" || phase === "verdict") && (
            <div key={`running-${phase}`} className="terminal-running terminal-phase-content">
              <p className="terminal-running-label">Convening council on git working tree</p>
              {RUNNING.map((row) => (
                <div key={`${row.id}-${row.role}`} className="terminal-run-row">
                  <span className="terminal-run-id">
                    {row.id}
                    <span className="text-quorate-dim">:{row.role}</span>
                  </span>
                  <span className="terminal-run-state">
                    {row.state === "running" ? (
                      <>
                        <span className="text-quorate-amber">{BRAILLE[frame]}</span> running
                      </>
                    ) : row.state === "done" ? (
                      <span className="text-quorate-pass">✔ {row.note}</span>
                    ) : (
                      <span className="text-quorate-dim">queued</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {phase === "verdict" && (
            <div key="verdict" className="terminal-verdict terminal-phase-content">
              <div className="terminal-verdict-header">
                <span className="text-quorate-fail font-bold text-base">FAIL</span>
                <span className="text-quorate-dim">· 3 findings · agreement 67%</span>
              </div>
              <div className="terminal-agreement-bar" aria-hidden>
                <span className="terminal-agreement-fill" style={{ width: "67%" }} />
              </div>
              <div className="terminal-finding">
                <span className="text-quorate-fail">FAIL</span>
                <span className="text-quorate-high">HIGH</span>
                <span className="font-mono text-white">src/auth.ts:42</span>
              </div>
              <p className="terminal-finding-body">
                Missing authorization check — token introspection result is trusted without
                verifying the audience claim.
              </p>
              <p className="terminal-finding-meta text-quorate-dim">
                agreed by claude, codex · confidence 0.82
              </p>
              <div className="terminal-finding terminal-finding--secondary">
                <span className="text-quorate-warn">WARN</span>
                <span className="text-quorate-medium">MED</span>
                <span className="font-mono text-white">tests/auth.test.ts:18</span>
              </div>
              <p className="terminal-finding-body terminal-finding-body--secondary">
                New test omits negative case for expired token — coverage gap on auth edge path.
              </p>
            </div>
          )}

          <div className="terminal-status">
            <span className="text-quorate-dim">◷</span>{" "}
            <span className="text-quorate-command">{statusLine.mode}</span>
            <span className="text-quorate-dim"> ⌘ {statusLine.agents}</span>
            {statusLine.diff ? (
              <span className="text-quorate-dim"> ⎇ {statusLine.diff}</span>
            ) : null}
            {phase === "running" || phase === "verdict" ? (
              <span className="text-quorate-amber">
                {" "}
                {BRAILLE[frame]} {formatElapsed(elapsed)}
              </span>
            ) : statusLine.hint ? (
              <span className="text-quorate-degraded"> {statusLine.hint}</span>
            ) : null}
          </div>

          <div className={`terminal-composer ${phase === "palette" ? "terminal-composer--palette" : ""}`}>
            <span className="text-quorate-command font-bold">›</span>
            <span className="terminal-composer-input">{composer || " "}</span>
            {phase === "palette" || (phase === "diff" && composer) ? (
              <span className="terminal-cursor" aria-hidden />
            ) : null}
            {!composer && phase !== "palette" && phase !== "running" && phase !== "verdict" ? (
              <span className="terminal-placeholder">type a message, or /command</span>
            ) : null}
          </div>

          {phase === "palette" && (
            <div className="terminal-palette">
              {PALETTE.map((item) => (
                <div
                  key={item.name}
                  className={item.active ? "terminal-palette-row terminal-palette-row--active" : "terminal-palette-row"}
                >
                  <span>{item.active ? "▸" : " "}</span>
                  <span className={item.active ? "text-quorate-command" : ""}>{item.name}</span>
                  <span className="text-quorate-dim">{item.hint}</span>
                </div>
              ))}
              <p className="terminal-palette-hint">↑↓ select · Tab complete · ↵ run · Esc close</p>
            </div>
          )}

          {phase !== "palette" && phase !== "running" && phase !== "verdict" && (
            <p className="terminal-footer">
              Enter send · / commands · ! shell · ctrl+c quit
              {phase === "welcome" ? " · heuristic only → /use available" : ""}
            </p>
          )}
        </div>
        <div className="terminal-window-footer">
          <p className="terminal-caption">{activeCaption}</p>
          <button type="button" className="terminal-replay" onClick={replay}>
            ↻ Replay demo
          </button>
        </div>
      </div>
    </div>
  );
}
