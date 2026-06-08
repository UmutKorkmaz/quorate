import React from "react";
import { Box, Text } from "ink";
import { homedir } from "node:os";
import {
  diffStats,
  glyphs,
  PALETTE,
  roleColor,
  roleGlyph,
  SEVERITY_COLOR,
  VERDICT_COLOR,
  type CouncilReport,
  type Finding,
  type ProviderConfig,
  type ProviderResult,
  type ProviderRunStatus,
  type QuorateConfig
} from "@quorate/core";
import type { ProviderSnapshot } from "../session.js";
import { Spinner, Elapsed } from "./Spinner.js";

/** A keycap chip — a key drawn on a dark slate background, like the design. */
export function Keycap({ children }: { children: string }): React.ReactElement {
  return <Text backgroundColor="#2A3142" color="#D7DCE7">{` ${children} `}</Text>;
}

/** A short, ~-relative form of a working directory for the welcome line. */
function shortCwd(cwd: string): string {
  const home = homedir();
  return cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

// Matches CSI SGR color/style escapes so streamed agent output renders as plain text.
const ANSI = /\x1b\[[0-9;]*m/g;

/** Strip ANSI, collapse to a single trimmed line, and hard-truncate to `maxCols`
 *  with a glyph-aware ellipsis. Pure + exported so the truncation rule can be unit
 *  tested without rendering a component. */
export function truncateLine(text: string, maxCols: number): string {
  const segments = text.replace(ANSI, "").replace(/\r/g, "").split("\n");
  const clean = (segments.filter((part) => part.trim().length > 0).pop() ?? "").trim();
  if (maxCols <= 1 || clean.length <= maxCols) return clean;
  const ell = glyphs().separator === "-" ? "..." : "…";
  return clean.slice(0, Math.max(0, maxCols - ell.length)) + ell;
}

/** Strip ANSI from a SINGLE line (unlike truncateLine, which collapses a body to
 *  its last non-blank line) and hard-truncate to `maxCols`. Tabs become two
 *  spaces; carriage returns are dropped. Pure + exported for unit testing the
 *  per-line rendering used by the /logs body. */
export function stripAnsiLine(text: string, maxCols: number): string {
  const clean = text.replace(ANSI, "").replace(/\r/g, "").replace(/\t/g, "  ");
  if (maxCols <= 1 || clean.length <= maxCols) return clean;
  const ell = glyphs().separator === "-" ? "..." : "…";
  return clean.slice(0, Math.max(0, maxCols - ell.length)) + ell;
}

const GETTING_STARTED: Array<[string, string]> = [
  ["/git", "load the working tree as a diff"],
  ["/use available", "enable every installed agent"],
  ["/review", "convene the council on the loaded diff"]
];

/** Rounded, per-role colored chips — the council roster. */
export function RoleChips({ roles }: { roles: string[] }): React.ReactElement {
  return (
    <Box gap={1}>
      {roles.map((role) => (
        <Box key={role} borderStyle="round" borderColor={roleColor(role)} paddingX={1}>
          <Text color={roleColor(role)}>{`${roleGlyph(role)} ${role}`}</Text>
        </Box>
      ))}
    </Box>
  );
}

export interface WelcomeProps {
  version: string;
  cwd: string;
  available: number;
  detected: string[];
  active?: string[];
  totalAgents: number;
  councils: string[];
  firstRun: boolean;
  projectDefaultsLine?: string;
  sessionRecap?: string;
}

/** The first-run hero: wordmark, tagline, getting-started card, role chips, and
 *  the detected-agents line — the design's onboarding splash. */
export function Welcome(props: WelcomeProps): React.ReactElement {
  const g = glyphs();
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between">
        <Text>
          <Text color={PALETTE.accent} bold>{`${g.verdict.pass} `}</Text>
          <Text bold>{"Q U O R A T E"}</Text>
        </Text>
        <Text color={PALETTE.dim}>{`node ${process.versions.node.split(".")[0]} ${g.separator} ${shortCwd(props.cwd)}`}</Text>
      </Box>
      <Text color={PALETTE.spinner}>
        {`${g.sparkle} Council convened. A panel of AI reviewers, one binding verdict.`}
      </Text>

      {props.projectDefaultsLine ? (
        <Text color={PALETTE.pass}>{props.projectDefaultsLine}</Text>
      ) : null}

      {props.sessionRecap ? (
        <Text color={PALETTE.dim}>{props.sessionRecap}</Text>
      ) : null}

      {props.firstRun ? (
        <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
          <Text color={PALETTE.dim}>GETTING STARTED</Text>
          {GETTING_STARTED.map(([cmd, desc]) => (
            <Text key={cmd}>
              <Text color={PALETTE.command} bold>{cmd.padEnd(16)}</Text>
              <Text color={PALETTE.dim}>{`  ${desc}`}</Text>
            </Text>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1} alignItems="center">
        <Text color={PALETTE.dim}>{"Council  "}</Text>
        <RoleChips roles={props.councils} />
      </Box>

      <Box marginTop={1}>
        <Text color={PALETTE.dim}>{"Installed on PATH "}</Text>
        <Text bold>{`${props.detected.length} of ${props.totalAgents} agents `}</Text>
        {props.detected.map((id) => (
          <Text key={id} color={PALETTE.pass}>{`${id} ${g.check}  `}</Text>
        ))}
        <Text color={PALETTE.dim}>{`${g.separator} heuristic always on`}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={PALETTE.dim}>{"Active this session "}</Text>
        {props.active && props.active.length > 0 ? (
          props.active.map((id) => (
            <Text key={id} color={PALETTE.accent}>{`${id} ${g.active}  `}</Text>
          ))
        ) : (
          <Text color={PALETTE.spinner}>{`heuristic ${g.active}`}</Text>
        )}
      </Box>
    </Box>
  );
}

/** The loaded-diff summary card: file count, +/- totals, and per-file stats. */
export function DiffCard({ label, diff }: { label: string; diff: string }): React.ReactElement {
  const g = glyphs();
  const stats = diffStats(diff);
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text color={PALETTE.pass}>{`${g.branch} Loaded diff from `}</Text>
        <Text color={PALETTE.pass} bold>{label}</Text>
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        <Box justifyContent="space-between">
          <Text bold>{`${stats.files.length} file${stats.files.length === 1 ? "" : "s"} changed`}</Text>
          <Text>
            <Text color={PALETTE.pass}>{`+${stats.added} `}</Text>
            <Text color={PALETTE.fail}>{`-${stats.removed}`}</Text>
          </Text>
        </Box>
        {stats.files.slice(0, 12).map((file) => (
          <Box key={file.path} justifyContent="space-between">
            <Text>
              <Text color={PALETTE.dim}>{`${g.file} `}</Text>
              <Text>{file.path}</Text>
            </Text>
            <Text>
              <Text color={PALETTE.pass}>{`+${file.added} `}</Text>
              <Text color={PALETTE.fail}>{`-${file.removed}`}</Text>
            </Text>
          </Box>
        ))}
      </Box>
      <Text>
        <Text color={PALETTE.dim}>{"next "}</Text>
        <Text color={PALETTE.command} bold>{"/review"}</Text>
        <Text color={PALETTE.dim}>{" to convene the council, or "}</Text>
        <Text color={PALETTE.command} bold>{"/roles"}</Text>
        <Text color={PALETTE.dim}>{" to narrow it"}</Text>
      </Text>
    </Box>
  );
}

/** The "runs" attribution footer: each provider with the roles it covered and the
 *  worst status across those roles, so a crashed provider is NOT painted green. */
function runsFooter(
  results: ProviderResult[]
): Array<{ id: string; roles: string[]; status: ProviderRunStatus }> {
  const byProvider = new Map<string, { roles: string[]; status: ProviderRunStatus }>();
  for (const result of results) {
    const entry = byProvider.get(result.providerId) ?? { roles: [], status: "ok" as ProviderRunStatus };
    if (!entry.roles.includes(result.role)) entry.roles.push(result.role);
    if (result.status !== "ok") entry.status = result.status; // surface the worst
    byProvider.set(result.providerId, entry);
  }
  return [...byProvider.entries()].map(([id, value]) => ({ id, roles: value.roles, status: value.status }));
}

/** The verdict hero: the verdict banner, a degraded callout when relevant, the
 *  finding cards, and the runs footer — the design's report view. */
/** Per-finding tier word + color, derived from severity (mock's FAIL/WARN/… prefix). */
const FINDING_TIER: Record<string, { word: string; color: string }> = {
  critical: { word: "FAIL", color: PALETTE.fail },
  high: { word: "FAIL", color: PALETTE.fail },
  medium: { word: "WARN", color: PALETTE.warn },
  low: { word: "NOTE", color: PALETTE.dim },
  info: { word: "INFO", color: PALETTE.dim }
};

const SEVERITY_ABBR: Record<string, string> = {
  critical: "CRIT",
  high: "HIGH",
  medium: "MED",
  low: "LOW",
  info: "INFO"
};

/** A filled amber agreement meter, proportional to the agreement percentage. */
function AgreementBar({ pct }: { pct: number }): React.ReactElement {
  const g = glyphs();
  const width = 28;
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return (
    <Text>
      <Text color={PALETTE.agreement}>{g.barOn.repeat(filled)}</Text>
      <Text color={PALETTE.dim}>{g.barOff.repeat(width - filled)}</Text>
    </Text>
  );
}

/** The verdict card: one verdict-colored box with the verdict header, an
 *  agreement meter, and findings rendered inline — the design's result view. */
export function VerdictReport({ report }: { report: CouncilReport }): React.ReactElement {
  const g = glyphs();
  const total = report.providerResults.length;
  const slowestMs = report.providerResults.reduce((max, r) => Math.max(max, r.durationMs), 0);
  const degraded = report.metadata.degraded;
  const verdict = report.verdict;
  const vColor = degraded ? PALETTE.degraded : VERDICT_COLOR[verdict] ?? "white";
  const findings = report.findings;
  const showAgreement = findings.length > 0 && total > 1;
  const agreementPct = showAgreement
    ? Math.round(
        (findings.reduce((sum, f) => sum + Math.min(f.agreement ?? 1, total) / total, 0) / findings.length) * 100
      )
    : 0;

  return (
    <Box flexDirection="column" marginY={1}>
      <Box flexDirection="column" borderStyle="round" borderColor={vColor} paddingX={1}>
        <Text>
          <Text color={vColor} bold>{verdict.toUpperCase()}</Text>
          <Text color={PALETTE.dim}>
            {` ${g.separator} ${findings.length} finding${findings.length === 1 ? "" : "s"}`}
            {showAgreement ? ` ${g.separator} agreement ${agreementPct}%` : ""}
          </Text>
        </Text>

        {showAgreement ? <AgreementBar pct={agreementPct} /> : null}

        {degraded ? (
          <Text color={PALETTE.degraded}>
            {`${g.warn} heuristic only — not a confident green. Enable real reviewers with `}
            <Text color={PALETTE.command} bold>/use available</Text>
          </Text>
        ) : null}

        {(() => {
          const failed = report.providerResults.filter(
            (result) => result.status !== "ok" && result.status !== "skipped"
          );
          return failed.length > 0 ? (
            <Text color={PALETTE.dim}>
              {`${g.warn} ${failed.length} provider run${failed.length === 1 ? "" : "s"} failed ${g.separator} /logs to inspect`}
            </Text>
          ) : null;
        })()}

        {findings.length === 0 && !degraded ? (
          <Text color={PALETTE.dim}>No findings.</Text>
        ) : (
          findings.map((finding, index) => {
            const tier = FINDING_TIER[finding.severity] ?? { word: finding.severity.toUpperCase(), color: "white" };
            const sev = SEVERITY_COLOR[finding.severity] ?? "white";
            const loc = finding.file ? (finding.line ? `${finding.file}:${finding.line}` : finding.file) : "";
            const detail = finding.body || finding.title;
            return (
              <Box
                key={index}
                flexDirection="column"
                marginTop={1}
                borderStyle="single"
                borderColor={PALETTE.dim}
                borderTop={index > 0}
                borderBottom={false}
                borderLeft={false}
                borderRight={false}
              >
                <Text>
                  <Text color={tier.color} bold>{tier.word}</Text>
                  <Text color={sev} bold>{` ${SEVERITY_ABBR[finding.severity] ?? finding.severity.toUpperCase()}`}</Text>
                  {loc ? <Text bold>{`  ${loc}`}</Text> : null}
                </Text>
                {detail ? <Text>{detail}</Text> : null}
                {finding.agreedBy && finding.agreedBy.length > 0 ? (
                  <Text color={PALETTE.dim}>
                    {`agreed by ${finding.agreedBy.join(", ")}${finding.confidence != null ? ` ${g.separator} confidence ${finding.confidence.toFixed(2)}` : ""}`}
                  </Text>
                ) : null}
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={PALETTE.dim}>{"runs  "}</Text>
        {runsFooter(report.providerResults).map(({ id, roles, status }) => {
          const ok = status === "ok";
          const skipped = status === "skipped";
          const idColor = ok ? PALETTE.pass : skipped ? PALETTE.dim : PALETTE.fail;
          const mark = ok ? g.check : skipped ? g.separator : g.cross;
          return (
            <Text key={id}>
              <Text color={idColor}>{id} </Text>
              <Text color={PALETTE.dim}>{`${roles.join("+")} ${mark}  `}</Text>
            </Text>
          );
        })}
        <Text color={PALETTE.dim}>
          {`${g.separator} ${(slowestMs / 1000).toFixed(1)}s ${g.separator} /markdown <path> to export`}
          {report.providerResults.length > 0 ? ` ${g.separator} /logs to read each agent` : ""}
        </Text>
      </Box>
    </Box>
  );
}

export interface RunRow {
  providerId: string;
  role: string;
  state: "queued" | "running" | "done";
  note?: string;
  /** Latest meaningful stdout line while running — drives the dim activity line. */
  preview?: string;
  /** result.error or the last stderr line — drives the fail line on a failed row. */
  error?: string;
  /** Distinguishes ok from error/interrupted/skipped on a done row. */
  status?: ProviderRunStatus;
}

/** One provider lane in the live running panel: `provider:role` on the left with
 *  the live state right-aligned, plus an optional second line — a dim activity
 *  preview while running, or a fail-red error line when a done row errored. */
function RunRowView({ row, maxWidth }: { row: RunRow; maxWidth: number }): React.ReactElement {
  const g = glyphs();
  const isErr = row.state === "done" && row.status !== undefined && row.status !== "ok";
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" width={maxWidth}>
        <Text>
          <Text bold>{row.providerId}</Text>
          <Text color={PALETTE.dim}>{`:${row.role}`}</Text>
        </Text>
        {row.state === "running" ? (
          <Text>
            <Spinner />
            <Text>{" running"}</Text>
          </Text>
        ) : row.state === "queued" ? (
          <Text color={PALETTE.dim}>queued</Text>
        ) : isErr ? (
          <Text color={PALETTE.fail}>{`${g.cross} ${row.note && row.note.length > 0 ? row.note : row.status}`}</Text>
        ) : (
          <Text color={PALETTE.pass}>{`${g.check} ${row.note && row.note.length > 0 ? row.note : "done"}`}</Text>
        )}
      </Box>
      {row.state === "running" && row.preview ? (
        <Box paddingLeft={2}>
          <Text color={PALETTE.dim}>{truncateLine(row.preview, maxWidth - 2)}</Text>
        </Box>
      ) : null}
      {isErr && row.error ? (
        <Box paddingLeft={2}>
          <Text color={PALETTE.fail}>{truncateLine(row.error, maxWidth - 2)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export interface RunningCardProps {
  rows: RunRow[];
  label: string;
  startedAt: number;
  maxWidth?: number;
}

/** The live "council running" panel: a quiet header, then a per-provider list of
 *  states — the design's running view. The spinner + elapsed live on the status
 *  line below it (rendered by the app), as in the web mock. */
export function RunningCard(props: RunningCardProps): React.ReactElement {
  // Cap the panel width so the right-aligned state sits close to the lane label
  // instead of being flung to the far edge of a wide terminal.
  const maxWidth = Math.min(props.maxWidth ?? 80, 60);
  return (
    <Box flexDirection="column">
      <Text color={PALETTE.dim}>{`Convening council on ${props.label}`}</Text>
      {props.rows.map((row, index) => (
        <RunRowView key={`${row.providerId}-${row.role}-${index}`} row={row} maxWidth={maxWidth} />
      ))}
    </Box>
  );
}

export interface LaneStreamProps {
  providerId: string;
  role: string;
  lines: string[];
  maxWidth: number;
  startedAt: number;
}

/** The drill-in tail view for one focused provider lane. Observe-only — providers
 *  run headless with stdin closed after the prompt, so there is NO composer here.
 *  Renders a live header (spinner + elapsed), the last ~16 raw stdout lines in
 *  arrival order, and an honest footer stating the output-only model. */
export function LaneStream(props: LaneStreamProps): React.ReactElement {
  const g = glyphs();
  const back = g.arrow === "->" ? "<-" : "←";
  const tail = props.lines.slice(-16); // last up to 16 lines
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={roleColor(props.role)} bold>{`${props.providerId}:${props.role}`}</Text>
        <Text>{"  "}</Text>
        <Spinner />
        <Text>{" "}</Text>
        <Elapsed since={props.startedAt} />
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        {tail.length === 0 ? (
          <Text color={PALETTE.dim}>waiting for output…</Text>
        ) : (
          tail.map((line, index) => (
            <Text key={index} color={PALETTE.dim}>{truncateLine(line, props.maxWidth - 4)}</Text>
          ))
        )}
      </Box>
      <Text color={PALETTE.dim}>
        {`watching ${props.providerId}:${props.role} ${g.separator} output only ${g.separator} ${back} or esc back ${g.separator} esc again interrupts`}
      </Text>
    </Box>
  );
}

/* ---------- /providers · doctor grid ---------- */
export function ProvidersGrid({ rows }: { rows: ProviderSnapshot[] }): React.ReactElement {
  const g = glyphs();
  const active = rows.filter((row) => row.active).length;
  const available = rows.filter((row) => row.available).length;
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text color={PALETTE.accent}>{g.active}</Text>
        <Text color={PALETTE.dim}>{" active    "}</Text>
        <Text color={PALETTE.pass}>{g.check}</Text>
        <Text color={PALETTE.dim}>{" available    needs-profile = on PATH but not runnable — edit .quorate.yml, then "}</Text>
        <Text color={PALETTE.command} bold>/use</Text>
        <Text color={PALETTE.dim}>{" <id>"}</Text>
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        <Text color={PALETTE.dim}>{`  ${"AGENT".padEnd(12)}${"LOCAL".padEnd(11)}${"PROFILE".padEnd(15)}COMMAND`}</Text>
        {rows.map((row) => (
          <Text key={row.id}>
            <Text color={PALETTE.accent}>{row.active ? `${g.active} ` : "  "}</Text>
            <Text color={row.active ? PALETTE.accent : undefined} bold={row.active}>{row.id.padEnd(12)}</Text>
            <Text color={row.available ? PALETTE.pass : PALETTE.fail}>{(row.available ? "available" : "missing").padEnd(11)}</Text>
            <Text color={row.runnable ? undefined : PALETTE.dim}>{(row.runnable ? "runnable" : "needs-profile").padEnd(15)}</Text>
            <Text color={PALETTE.dim}>{row.command ?? row.installHint ?? ""}</Text>
          </Text>
        ))}
      </Box>
      <Text>
        <Text color={PALETTE.dim}>{`${active} active ${g.separator} ${available} available ${g.separator} ${rows.length} known.  `}</Text>
        <Text color={PALETTE.command} bold>/use available</Text>
        <Text color={PALETTE.dim}>{" to enable all runnable agents"}</Text>
      </Text>
    </Box>
  );
}

/* ---------- /help · command reference ---------- */
const HELP_GROUPS: Array<[string, Array<[string, string]>]> = [
  [
    "Load",
    [
      ["/git [base] [head]", "load a git diff (default: working tree)"],
      ["/diff <path>", "load a unified diff file"],
      ["/pr <number>", "load a PR diff (gh)"]
    ]
  ],
  [
    "Agents",
    [
      ["/providers (doctor)", "list agents + local availability"],
      ["/plugins (agents)", "browse the agent roster"],
      ["/provider <id>", "show one agent's safety config"],
      ["/inspect <id>", "alias for /provider"],
      ["/use <ids|available>", "set active agents for this session"],
      ["/enable <ids>", "add agents to the session"],
      ["/disable <ids>", "remove agents from the session"],
      ["/route <role> <ids>", "reassign role→provider this session"]
    ]
  ],
  [
    "Review",
    [
      ["/review [subject]", "convene the council on the loaded diff"],
      ["/plan <text> (ask)", "evaluate a plan prompt"],
      ["/mode review|plan", "how bare text in the prompt is read"],
      ["/roles <ids>", "limit which roles review"],
      ["/rerun", "run the last request again"]
    ]
  ],
  [
    "Output",
    [
      ["/last", "show the last report"],
      ["/logs [id|id:role]", "read each agent's full output"],
      ["/markdown <path> (md)", "export Markdown"],
      ["/json <path>", "export JSON"],
      ["/clear (reset)", "reset diff + report"]
    ]
  ],
  [
    "Discover",
    [
      ["/skills (councils)", "show council roles and routing"],
      ["/settings (config)", "show .quorate.yml (read-only)"],
      ["/setup", "create a starter .quorate.yml"],
      ["/theme", "show the palette"],
      ["/help (?)", "show this reference"]
    ]
  ],
  [
    "Session",
    [
      ["/status", "show current session state"],
      ["/history", "show recent shell commands"],
      ["/exit (q, quit)", "leave the shell"]
    ]
  ]
];

export function HelpView(): React.ReactElement {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text bold>Commands</Text>
        <Text color={PALETTE.dim}>{" — type "}</Text>
        <Text color={PALETTE.command} bold>/</Text>
        <Text color={PALETTE.dim}>{" in the prompt to open the palette."}</Text>
      </Text>
      {HELP_GROUPS.map(([title, rows]) => (
        <Box key={title} flexDirection="column" marginTop={1}>
          <Text color={PALETTE.dim}>{title.toUpperCase()}</Text>
          {rows.map(([cmd, desc]) => (
            <Text key={cmd}>
              <Text color={PALETTE.command} bold>{cmd.padEnd(20)}</Text>
              <Text color={PALETTE.dim}>{`  ${desc}`}</Text>
            </Text>
          ))}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={PALETTE.dim}>{"Configure agents: "}</Text>
        <Text color={PALETTE.command}>.quorate.yml</Text>
        <Text color={PALETTE.dim}>{" or "}</Text>
        <Text color={PALETTE.command}>quorate provider add</Text>
        <Text color={PALETTE.dim}>{"  ·  "}</Text>
        <Text color={PALETTE.command}>/route</Text>
        <Text color={PALETTE.dim}>{" assigns roles"}</Text>
      </Box>
      <Box marginTop={1}>
        <Keycap>Esc</Keycap>
        <Text color={PALETTE.dim}>{" interrupt   "}</Text>
        <Keycap>Ctrl+C</Keycap>
        <Text color={PALETTE.dim}>{" clear / exit   "}</Text>
        <Text color={PALETTE.dim}>{"bare text in the prompt → subject (review) or plan (plan mode)"}</Text>
      </Box>
    </Box>
  );
}

/* ---------- /skills · council roles ---------- */
const SKILL_DESC: Record<string, string> = {
  architect: "Boundaries, coupling, and API shape. Flags leaky abstractions and design drift.",
  security: "Authn/z, secrets, injection, unsafe deserialization. The strictest voice.",
  qa: "Test coverage, edge cases, focused/skipped tests, flaky patterns.",
  performance: "Hot paths, N+1s, allocations, blocking I/O on the request path.",
  maintainer: "Readability, naming, dead code, follow-up markers. Owns the heuristic checks."
};

export function SkillsView({ roles }: { roles: Array<{ role: string; providers: string[] }> }): React.ReactElement {
  const g = glyphs();
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text color={PALETTE.spinner}>{`${g.sparkle} `}</Text>
        <Text bold>Roles</Text>
        <Text color={PALETTE.dim}>{" — council perspectives and which agents cover each. Read-only; use "}</Text>
        <Text color={PALETTE.command} bold>/roles</Text>
        <Text color={PALETTE.dim}>{" to change the active set."}</Text>
      </Text>
      {roles.map(({ role, providers }) => {
        const on = providers.length > 0;
        return (
          <Box key={role} flexDirection="column" borderStyle="round" borderColor={on ? roleColor(role) : PALETTE.dim} paddingX={1} marginTop={1}>
            <Box justifyContent="space-between">
              <Text>
                <Text color={roleColor(role)}>{`${roleGlyph(role)} `}</Text>
                <Text color={roleColor(role)} bold>{role}</Text>
              </Text>
              <Text color={on ? PALETTE.pass : PALETTE.dim}>{on ? `${g.check} on` : "off"}</Text>
            </Box>
            <Text color={PALETTE.dim}>{SKILL_DESC[role] ?? "A council voice."}</Text>
            <Text>
              <Text color={PALETTE.dim}>{"agents "}</Text>
              <Text color={PALETTE.roles.maintainer}>{providers.join(" + ") || "—"}</Text>
              {role === "maintainer" ? (
                <Text color={PALETTE.dim}>{` ${g.separator} 4 static checks: focused-test ${g.separator} secret ${g.separator} console.log ${g.separator} TODO`}</Text>
              ) : null}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/* ---------- /plugins · agent roster ---------- */
export function PluginsView({ items }: { items: Array<{ id: string; name: string; status: string; roles: string[] }> }): React.ReactElement {
  const g = glyphs();
  const statusEl = (status: string): React.ReactElement => {
    if (status === "installed") return <Text color={PALETTE.pass}>{`${g.check} installed`}</Text>;
    if (status === "enabled") return <Text color={PALETTE.accent}>{`${g.active} enabled`}</Text>;
    if (status === "available") return <Text color={PALETTE.spinner}>{"+ enable"}</Text>;
    return <Text color={PALETTE.dim}>{`${g.arrow} install`}</Text>;
  };
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text color={PALETTE.accent}>{"⧉ "}</Text>
        <Text bold>Agents</Text>
        <Text color={PALETTE.dim}>{" — the agent CLIs Quorate drives. No API keys; it uses what's on your machine."}</Text>
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        {items.map((item) => (
          <Box key={item.id} justifyContent="space-between">
            <Text>
              <Text bold>{item.id.padEnd(14)}</Text>
              <Text color={PALETTE.dim}>{`roles ${g.separator} ${item.roles.join(", ") || "—"}`}</Text>
            </Text>
            {statusEl(item.status)}
          </Box>
        ))}
      </Box>
      <Text>
        <Text color={PALETTE.dim}>{`spawned without a shell ${g.separator} headless args only ${g.separator} byte + time caps ${g.separator} dangerous-flag denylist.  `}</Text>
        <Text color={PALETTE.command} bold>/use available</Text>
        <Text color={PALETTE.dim}>{" to enable every runnable agent"}</Text>
      </Text>
    </Box>
  );
}

/* ---------- /provider <id> · safety config ---------- */
export function ProviderDetailView({
  provider,
  available,
  enabled
}: {
  provider: ProviderConfig;
  available: boolean;
  enabled: boolean;
}): React.ReactElement {
  const g = glyphs();
  const fields: Array<[string, string]> = [
    ["type", provider.type],
    ["command", provider.command ?? "—"],
    ["inputMode", provider.inputMode ?? "—"],
    ["roles", (provider.roles ?? []).join(", ") || "—"],
    ["timeoutMs", String(provider.timeoutMs ?? "")],
    ["maxOutputBytes", String(provider.maxOutputBytes ?? "")],
    ["allowDangerousArgs", String(provider.allowDangerousArgs ?? false)]
  ];
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text bold>{provider.id}</Text>
        <Text color={available ? PALETTE.pass : PALETTE.fail}>{`   ${available ? `${g.check} available` : `${g.cross} missing`}`}</Text>
        {enabled ? <Text color={PALETTE.accent}>{`   ${g.active} enabled`}</Text> : null}
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        <Text color={PALETTE.dim}>{"# .quorate.yml — providers[]"}</Text>
        <Text>{`  - id: ${provider.id}`}</Text>
        <Text>{`    type: ${provider.type}`}</Text>
        {provider.command ? <Text>{`    command: ${provider.command}`}</Text> : null}
        {provider.args && provider.args.length > 0 ? <Text>{`    args: [${provider.args.join(", ")}]`}</Text> : null}
        {provider.inputMode ? <Text>{`    inputMode: ${provider.inputMode}`}</Text> : null}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {fields.map(([key, value]) => (
          <Text key={key}>
            <Text color={PALETTE.dim}>{key.padEnd(20)}</Text>
            <Text bold>{value}</Text>
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.accent} paddingX={1} marginTop={1}>
        <Text color={PALETTE.accent} bold>{`${g.check} Safe by design`}</Text>
        <Text color={PALETTE.dim}>
          {"Empty args are refused. Session/resume and --yolo-style flags are rejected unless allowDangerousArgs is set. Caps kill a run that overruns time or bytes."}
        </Text>
      </Box>
    </Box>
  );
}

/* ---------- /settings · current configuration (read-only) ---------- */
export function SettingsView({ config }: { config: QuorateConfig }): React.ReactElement {
  const g = glyphs();
  const github = config.github;
  const enabledRole = (role: string): boolean => config.councils.includes(role);
  const allRoles = ["architect", "security", "qa", "performance", "maintainer"];
  const onOff = (value: boolean): React.ReactElement => (
    <Text color={value ? PALETTE.pass : PALETTE.dim}>{value ? `${g.check} on` : "off"}</Text>
  );
  const valueText = (value: string): React.ReactElement => (
    <Text color={PALETTE.accent} bold>{value}</Text>
  );
  const row = (label: string, control: React.ReactElement): React.ReactElement => (
    <Box key={label} justifyContent="space-between">
      <Text color={PALETTE.dim}>{label}</Text>
      {control}
    </Box>
  );
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text bold>Settings</Text>
        <Text color={PALETTE.dim}>{" — read-only snapshot of .quorate.yml in the repo root."}</Text>
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        <Text color={PALETTE.dim}>ROLES</Text>
        {allRoles.map((role) => row(role, onOff(enabledRole(role))))}
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        <Text color={PALETTE.dim}>GATE</Text>
        {row("fail-on", valueText(String(github.failOn)))}
        {row("fail on degraded", onOff(github.failOnDegraded === true))}
        {row("min agreement", valueText(String(github.gate?.minAgreement ?? "—")))}
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        <Text color={PALETTE.dim}>GITHUB ACTION</Text>
        {row("comment mode", valueText(github.commentMode))}
        {row("inline comments", onOff(github.inlineComments === true))}
        {row("runner mode", valueText(github.runnerMode))}
      </Box>
      <Text color={PALETTE.dim}>
        {`Edit .quorate.yml to change settings ${g.separator} /setup creates a starter file`}
      </Text>
    </Box>
  );
}

/* ---------- /theme · palette (the design language) ---------- */
export function ThemeView(): React.ReactElement {
  const g = glyphs();
  const swatches: Array<[string, string]> = [
    ["brand", PALETTE.accent],
    ["council", PALETTE.spinner],
    ["pass", PALETTE.pass],
    ["warn", PALETTE.warn],
    ["fail", PALETTE.fail]
  ];
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text color={PALETTE.spinner}>{`${g.sparkle} `}</Text>
        <Text bold>Theme</Text>
        <Text color={PALETTE.dim}>{" — the council reads the same diff in any palette. Indigo brand, amber council."}</Text>
      </Text>
      <Box gap={2} marginTop={1}>
        {swatches.map(([label, color]) => (
          <Box key={label} flexDirection="column">
            <Text color={color}>{g.barOn.repeat(8)}</Text>
            <Text color={PALETTE.dim}>{label}</Text>
            <Text color={PALETTE.dim}>{color}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={PALETTE.dim}>{"severity  "}</Text>
        {(["critical", "high", "medium", "low", "info"] as const).map((sev) => (
          <Text key={sev} color={SEVERITY_COLOR[sev]} bold>{`${sev.toUpperCase()} `}</Text>
        ))}
      </Box>
      <Text color={PALETTE.dim}>
        {`respects NO_COLOR ${g.separator} QUORATE_ASCII swaps Unicode for ASCII ${g.separator} truecolor, downsamples on limited terminals`}
      </Text>
    </Box>
  );
}

/* ---------- /logs · per-agent output review ---------- */

/** A status chip — glyph, color, and word — for one provider run. */
function statusChip(status: ProviderRunStatus): { glyph: string; color: string; label: string } {
  const g = glyphs();
  switch (status) {
    case "ok":
      return { glyph: g.check, color: PALETTE.pass, label: "ok" };
    case "error":
      return { glyph: g.cross, color: PALETTE.fail, label: "errored" };
    case "interrupted":
      return { glyph: g.cross, color: PALETTE.warn, label: "interrupted" };
    default:
      return { glyph: g.separator, color: PALETTE.dim, label: "skipped" };
  }
}

/** The /logs overview: one row per lane from the last report, each a status chip,
 *  `provider:role`, duration, finding count, and a per-row hint pointing at the
 *  detail view (or flagging an error / empty output). */
export function LogsOverview({ lanes }: { lanes: ProviderResult[] }): React.ReactElement {
  const g = glyphs();
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text color={PALETTE.spinner}>{`${g.sparkle} `}</Text>
        <Text bold>Logs</Text>
        <Text color={PALETTE.dim}>{" — each agent's full captured output from the last run."}</Text>
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        {lanes.length === 0 ? (
          <Text color={PALETTE.dim}>No provider runs in the last report.</Text>
        ) : (
          lanes.map((lane, index) => {
            const chip = statusChip(lane.status);
            const count = lane.findings.length;
            const hint =
              lane.status !== "ok"
                ? `errored — /logs ${lane.providerId} for the error`
                : !lane.rawOutput || !lane.rawOutput.trim()
                  ? "no output captured"
                  : `/logs ${lane.providerId}:${lane.role} to read`;
            return (
              <Text key={`${lane.providerId}:${lane.role}:${index}`}>
                <Text color={chip.color}>{`${chip.glyph} `}</Text>
                <Text color={roleColor(lane.role)} bold>{`${lane.providerId}:${lane.role}`}</Text>
                <Text color={PALETTE.dim}>
                  {` ${g.separator} (${(lane.durationMs / 1000).toFixed(1)}s) ${g.separator} ${count} finding${count === 1 ? "" : "s"} ${g.separator} ${hint}`}
                </Text>
              </Text>
            );
          })
        )}
      </Box>
      <Text color={PALETTE.dim}>
        {"/logs <provider:role> to read one lane's full output"}
      </Text>
    </Box>
  );
}

/** The /logs detail: one lane's full rawOutput in a framed box, ANSI stripped, the
 *  real error shown prominently and unwrapped at the top for error/interrupted
 *  lanes, the last ~400 lines of output below. */
export function LogsDetailView({
  result,
  maxWidth
}: {
  result: ProviderResult;
  maxWidth: number;
}): React.ReactElement {
  const g = glyphs();
  const chip = statusChip(result.status);
  const count = result.findings.length;
  const failed = result.status === "error" || result.status === "interrupted";
  const body = result.rawOutput && result.rawOutput.trim() ? result.rawOutput.split("\n").slice(-400) : [];
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text color={roleColor(result.role)} bold>{`${result.providerId}:${result.role}`}</Text>
        <Text color={chip.color}>{`  ${chip.glyph} ${chip.label}`}</Text>
        <Text color={PALETTE.dim}>
          {` ${g.separator} (${(result.durationMs / 1000).toFixed(1)}s) ${g.separator} ${count} finding${count === 1 ? "" : "s"} ${g.separator} ${result.providerType}`}
        </Text>
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        {failed && result.error ? (
          <Text color={PALETTE.fail}>{`${g.cross} ${result.error}`}</Text>
        ) : null}
        {body.length === 0 ? (
          <>
            <Text color={PALETTE.dim} italic>{"(no output captured)"}</Text>
            {result.status === "ok" ? (
              <Text color={PALETTE.dim}>
                {"the agent returned no text — check its headless args with /provider <id>"}
              </Text>
            ) : null}
          </>
        ) : (
          body.map((line, index) => (
            <Text key={index} color={PALETTE.dim}>{stripAnsiLine(line, maxWidth - 4)}</Text>
          ))
        )}
      </Box>
      <Text color={PALETTE.dim}>
        {`full captured stdout+stderr ${g.separator} ANSI stripped ${g.separator} /logs for the list`}
      </Text>
    </Box>
  );
}

/* ---------- /route · session role→provider routing ---------- */

/** The /route view: one card per council role with the providers covering it.
 *  Overridden roles are accent-colored and flagged; a role with no provider is
 *  called out as won't-run. Mirrors the SkillsView card look. */
export function RouteView({
  rows
}: {
  rows: Array<{ role: string; providers: string[]; overridden: boolean }>;
}): React.ReactElement {
  const g = glyphs();
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text color={PALETTE.spinner}>{`${g.sparkle} `}</Text>
        <Text bold>Route</Text>
        <Text color={PALETTE.dim}>{" — which agents cover each council role for this session."}</Text>
      </Text>
      {rows.map(({ role, providers, overridden }) => {
        const on = providers.length > 0;
        const idColor = overridden ? PALETTE.accent : PALETTE.roles.maintainer;
        return (
          <Box
            key={role}
            flexDirection="column"
            borderStyle="round"
            borderColor={on ? roleColor(role) : PALETTE.dim}
            paddingX={1}
            marginTop={1}
          >
            <Box justifyContent="space-between">
              <Text>
                <Text color={roleColor(role)}>{`${roleGlyph(role)} `}</Text>
                <Text color={roleColor(role)} bold>{role}</Text>
              </Text>
              {overridden ? (
                <Text color={PALETTE.accent}>{`${g.active} session override`}</Text>
              ) : (
                <Text color={PALETTE.dim}>config</Text>
              )}
            </Box>
            <Text>
              <Text color={PALETTE.dim}>{"agents "}</Text>
              {on ? (
                <Text color={idColor}>{providers.join(" + ")}</Text>
              ) : (
                <Text color={PALETTE.dim}>{`— ${g.separator} this role won't run`}</Text>
              )}
            </Text>
          </Box>
        );
      })}
      <Text color={PALETTE.dim}>
        {`/route <role> <provider...> to reassign ${g.separator} /route reset to restore config ${g.separator} edit .quorate.yml roles: to persist`}
      </Text>
    </Box>
  );
}
