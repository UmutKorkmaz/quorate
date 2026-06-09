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

type Verdict = "pass" | "warn" | "fail";

export type EmulatorFixture = Verdict;

interface RunRow {
  id: string;
  role: string;
  state: "done" | "running" | "queued";
  note: string;
}

interface Finding {
  verdict: Verdict;
  severity: string;
  severityColor: string;
  location: string;
  body: string;
  meta?: string;
}

interface FixtureData {
  label: string;
  files: ReadonlyArray<{ path: string; add: number; del: number }>;
  added: number;
  removed: number;
  running: ReadonlyArray<RunRow>;
  verdict: Verdict;
  findingCount: number;
  agreement: number;
  findings: ReadonlyArray<Finding>;
}

export const EMULATOR_FIXTURES: Record<EmulatorFixture, FixtureData> = {
  pass: {
    label: "Clean refactor",
    files: [
      { path: "src/format/date.ts", add: 22, del: 19 },
      { path: "tests/format/date.test.ts", add: 31, del: 4 }
    ],
    added: 53,
    removed: 23,
    running: [
      { id: "heuristic", role: "maintainer", state: "done", note: "0 findings" },
      { id: "claude", role: "security", state: "running", note: "" },
      { id: "codex", role: "qa", state: "queued", note: "" }
    ],
    verdict: "pass",
    findingCount: 0,
    agreement: 100,
    findings: [
      {
        verdict: "pass",
        severity: "OK",
        severityColor: "text-quorate-pass",
        location: "src/format/date.ts",
        body: "Pure refactor with full coverage — every reviewer agrees the change is safe to merge.",
        meta: "agreed by claude, codex, heuristic · confidence 0.94"
      }
    ]
  },
  warn: {
    label: "New endpoint",
    files: [
      { path: "src/api/orders.ts", add: 47, del: 6 },
      { path: "src/api/schema.ts", add: 19, del: 2 },
      { path: "tests/api/orders.test.ts", add: 12, del: 0 }
    ],
    added: 78,
    removed: 8,
    running: [
      { id: "heuristic", role: "maintainer", state: "done", note: "1 finding" },
      { id: "claude", role: "security", state: "running", note: "" },
      { id: "codex", role: "qa", state: "queued", note: "" }
    ],
    verdict: "warn",
    findingCount: 1,
    agreement: 83,
    findings: [
      {
        verdict: "warn",
        severity: "MED",
        severityColor: "text-quorate-medium",
        location: "src/api/orders.ts:61",
        body: "Pagination limit is unbounded — large result sets could pressure the database under load.",
        meta: "agreed by claude · confidence 0.71"
      }
    ]
  },
  fail: {
    label: "Auth change",
    files: [
      { path: "src/auth.ts", add: 34, del: 12 },
      { path: "src/middleware/validate.ts", add: 51, del: 8 },
      { path: "tests/auth.test.ts", add: 28, del: 14 },
      { path: "package.json", add: 15, del: 8 }
    ],
    added: 128,
    removed: 42,
    running: [
      { id: "heuristic", role: "maintainer", state: "done", note: "2 findings" },
      { id: "claude", role: "security", state: "running", note: "" },
      { id: "codex", role: "qa", state: "queued", note: "" }
    ],
    verdict: "fail",
    findingCount: 3,
    agreement: 67,
    findings: [
      {
        verdict: "fail",
        severity: "HIGH",
        severityColor: "text-quorate-high",
        location: "src/auth.ts:42",
        body: "Missing authorization check — token introspection result is trusted without verifying the audience claim.",
        meta: "agreed by claude, codex · confidence 0.82"
      },
      {
        verdict: "warn",
        severity: "MED",
        severityColor: "text-quorate-medium",
        location: "tests/auth.test.ts:18",
        body: "New test omits negative case for expired token — coverage gap on auth edge path."
      }
    ]
  }
};

const VERDICT_CHIP: Record<Verdict, string> = {
  pass: "verdict-chip verdict-chip--pass",
  warn: "verdict-chip verdict-chip--warn",
  fail: "verdict-chip verdict-chip--fail"
};

const VERDICT_TEXT: Record<Verdict, string> = {
  pass: "text-quorate-pass",
  warn: "text-quorate-warn",
  fail: "text-quorate-fail"
};

const AGREEMENT_FILL: Record<Verdict, string> = {
  pass: "color-mix(in srgb, var(--color-verdict-pass) 80%, transparent)",
  warn: "color-mix(in srgb, var(--color-verdict-warn) 80%, transparent)",
  fail: "color-mix(in srgb, var(--color-verdict-fail) 80%, transparent)"
};

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
  showPhaseRail = true,
  fixture = "fail",
  onFixtureChange
}: {
  onPhaseChange?: (phase: EmulatorPhase) => void;
  showPhaseRail?: boolean;
  fixture?: EmulatorFixture;
  onFixtureChange?: (fixture: EmulatorFixture) => void;
}) {
  const data = EMULATOR_FIXTURES[fixture];
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

  const selectFixture = useCallback(
    (next: EmulatorFixture) => {
      if (next === fixture) return;
      onFixtureChange?.(next);
      replay();
    },
    [fixture, onFixtureChange, replay]
  );

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
  const findingLabel = `${data.findingCount} ${data.findingCount === 1 ? "finding" : "findings"}`;

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
                <span>{data.files.length} files changed</span>
                <span>
                  <span className="text-quorate-pass">+{data.added}</span>{" "}
                  <span className="text-quorate-fail">−{data.removed}</span>
                </span>
              </div>
              <ul className="terminal-diff-files">
                {data.files.map((file) => (
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
              {data.running.map((row) => (
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
            <div
              key={`verdict-${fixture}`}
              className={
                data.verdict === "fail"
                  ? "terminal-verdict terminal-phase-content"
                  : "terminal-phase-content rounded-xl border border-quorate-border bg-quorate-surface/80 px-3 py-3 shadow-terminal"
              }
            >
              <div className="terminal-verdict-header">
                <span className={VERDICT_CHIP[data.verdict]}>
                  {data.verdict.toUpperCase()}
                </span>
                <span className="text-quorate-dim">
                  · {findingLabel} · agreement {data.agreement}%
                </span>
              </div>
              <div className="terminal-agreement-bar" aria-hidden>
                <span
                  className="terminal-agreement-fill"
                  style={{ width: `${data.agreement}%`, background: AGREEMENT_FILL[data.verdict] }}
                />
              </div>
              {data.findings.map((finding, index) => (
                <div key={finding.location}>
                  <div
                    className={
                      index === 0
                        ? "terminal-finding"
                        : "terminal-finding terminal-finding--secondary"
                    }
                  >
                    <span className={VERDICT_TEXT[finding.verdict]}>
                      {finding.verdict.toUpperCase()}
                    </span>
                    <span className={finding.severityColor}>{finding.severity}</span>
                    <span className="font-mono text-white">{finding.location}</span>
                  </div>
                  <p
                    className={
                      index === 0
                        ? "terminal-finding-body"
                        : "terminal-finding-body terminal-finding-body--secondary"
                    }
                  >
                    {finding.body}
                  </p>
                  {finding.meta ? (
                    <p className="terminal-finding-meta text-quorate-dim">{finding.meta}</p>
                  ) : null}
                </div>
              ))}
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
        <div className="flex flex-wrap items-center gap-2 border-t border-quorate-border bg-quorate-elevated/30 px-4 py-2.5">
          <span className="font-mono text-[10px] tracking-[0.18em] text-quorate-dim uppercase">
            Try another diff
          </span>
          {(Object.keys(EMULATOR_FIXTURES) as EmulatorFixture[]).map((key) => {
            const item = EMULATOR_FIXTURES[key];
            const isActive = key === fixture;
            return (
              <button
                key={key}
                type="button"
                className={
                  isActive
                    ? "inline-flex items-center gap-1.5 rounded-full border border-quorate-accent/60 bg-quorate-accent/12 px-2.5 py-0.5 font-mono text-[10px] text-quorate-accent transition cursor-pointer"
                    : "inline-flex items-center gap-1.5 rounded-full border border-quorate-border bg-quorate-elevated/50 px-2.5 py-0.5 font-mono text-[10px] text-quorate-dim transition hover:border-quorate-accent/40 hover:text-quorate-muted cursor-pointer"
                }
                aria-pressed={isActive}
                onClick={() => selectFixture(key)}
              >
                <span className={`text-[8px] leading-none ${VERDICT_TEXT[item.verdict]}`} aria-hidden>
                  ●
                </span>
                {item.label}
              </button>
            );
          })}
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
