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
  type CouncilReport,
  type Finding,
  type ProviderConfig,
  type ProviderResult,
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

const GETTING_STARTED: Array<[string, string]> = [
  ["/git main HEAD", "load the current branch as a diff"],
  ["/use available", "enable every detected agent for this session"],
  ["/review", "convene the council on the loaded diff"],
  ["just type", "your message becomes the review subject"]
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
  totalAgents: number;
  councils: string[];
  firstRun: boolean;
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
        <Text color={PALETTE.dim}>{`node ${process.versions.node} ${g.separator} ${shortCwd(props.cwd)}`}</Text>
      </Box>
      <Text color={PALETTE.spinner}>
        {`${g.sparkle} Council convened. A panel of AI reviewers, one binding verdict.`}
      </Text>

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
        <Text color={PALETTE.dim}>{"Detected "}</Text>
        <Text bold>{`${props.detected.length} of ${props.totalAgents} agents `}</Text>
        {props.detected.map((id) => (
          <Text key={id} color={PALETTE.pass}>{`${id} ${g.check}  `}</Text>
        ))}
        <Text color={PALETTE.dim}>{`${g.separator} heuristic always on`}</Text>
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

/** The solid verdict banner: dark text on a verdict-colored block. */
function VerdictBlock({ verdict, degraded }: { verdict: CouncilReport["verdict"]; degraded: boolean }): React.ReactElement {
  const g = glyphs();
  if (degraded) {
    return (
      <Text color={PALETTE.degraded} bold>{`[ ${g.verdict[verdict]} ${verdict.toUpperCase()} ${g.separator} heuristic ]`}</Text>
    );
  }
  const color = verdict === "pass" ? PALETTE.pass : verdict === "warn" ? PALETTE.warn : PALETTE.fail;
  return <Text backgroundColor={color} color="black" bold>{` ${verdict.toUpperCase()} `}</Text>;
}

/** A single finding card: a severity-colored left bar, a severity label,
 *  location, the amber agreement meter, title, body, fix, and attribution. */
function FindingCard({ finding, total }: { finding: Finding; total: number }): React.ReactElement {
  const g = glyphs();
  const sev = SEVERITY_COLOR[finding.severity] ?? "white";
  const loc = finding.file ? (finding.line ? `${finding.file}:${finding.line}` : finding.file) : "";
  const agreed = Math.max(0, Math.min(finding.agreement ?? 1, total));
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={sev}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={1}
      marginTop={1}
    >
      <Box justifyContent="space-between">
        <Text>
          <Text color={sev} bold>{finding.severity.toUpperCase()}</Text>
          {loc ? <Text color={PALETTE.dim}>{`  ${loc}`}</Text> : null}
        </Text>
        {total > 1 ? (
          <Text>
            <Text color={PALETTE.agreement}>{g.active.repeat(agreed)}</Text>
            <Text color={PALETTE.dim}>{`${g.dotOff.repeat(total - agreed)} ${agreed}/${total}`}</Text>
          </Text>
        ) : null}
      </Box>
      <Text bold>{finding.title}</Text>
      <Text>{finding.body}</Text>
      {finding.suggestion ? (
        <Text>
          <Text color={PALETTE.pass}>{`${g.caret} fix `}</Text>
          <Text color={PALETTE.dim}>{finding.suggestion}</Text>
        </Text>
      ) : null}
      {finding.agreedBy && finding.agreedBy.length > 0 ? (
        <Text color={PALETTE.dim}>
          {`raised by ${finding.agreedBy.join(", ")}${finding.confidence != null ? ` ${g.separator} confidence ${finding.confidence.toFixed(2)}` : ""}`}
        </Text>
      ) : null}
    </Box>
  );
}

/** The "runs" attribution footer: each provider with the roles it covered. */
function runsFooter(results: ProviderResult[]): Array<{ id: string; roles: string[] }> {
  const byProvider = new Map<string, string[]>();
  for (const result of results) {
    const roles = byProvider.get(result.providerId) ?? [];
    if (!roles.includes(result.role)) roles.push(result.role);
    byProvider.set(result.providerId, roles);
  }
  return [...byProvider.entries()].map(([id, roles]) => ({ id, roles }));
}

/** The verdict hero: the verdict banner, a degraded callout when relevant, the
 *  finding cards, and the runs footer — the design's report view. */
export function VerdictReport({ report }: { report: CouncilReport }): React.ReactElement {
  const g = glyphs();
  const total = report.providerResults.length;
  const slowestMs = report.providerResults.reduce((max, r) => Math.max(max, r.durationMs), 0);
  return (
    <Box flexDirection="column" marginY={1}>
      <VerdictBlock verdict={report.verdict} degraded={report.metadata.degraded} />
      <Text>{report.summary}</Text>

      {report.metadata.degraded ? (
        <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.degraded} paddingX={1} marginTop={1}>
          <Text color={PALETTE.degraded} bold>{`${g.warn} Degraded review`}</Text>
          <Text>
            {"Only the built-in heuristic ran — no AI agents were enabled. This is "}
            <Text color={PALETTE.degraded}>not</Text>
            {" a confident green. Enable real reviewers with "}
            <Text color={PALETTE.command} bold>/use available</Text>
            {"."}
          </Text>
        </Box>
      ) : null}

      {report.findings.length === 0 && !report.metadata.degraded ? (
        <Text color={PALETTE.dim}>{"  No findings."}</Text>
      ) : (
        report.findings.map((finding, index) => <FindingCard key={index} finding={finding} total={total} />)
      )}

      <Box marginTop={1}>
        <Text color={PALETTE.dim}>{"runs  "}</Text>
        {runsFooter(report.providerResults).map(({ id, roles }) => (
          <Text key={id}>
            <Text color={PALETTE.pass}>{id} </Text>
            <Text color={PALETTE.dim}>{`${roles.join("+")} ${g.check}  `}</Text>
          </Text>
        ))}
        <Text color={PALETTE.dim}>{`${g.separator} ${(slowestMs / 1000).toFixed(1)}s ${g.separator} /markdown to export`}</Text>
      </Box>
    </Box>
  );
}

export interface RunRow {
  providerId: string;
  role: string;
  state: "queued" | "running" | "done";
  note?: string;
}

/** A short indeterminate amber bar for an in-flight provider row. */
function RunBar(): React.ReactElement {
  const g = glyphs();
  return <Text color={PALETTE.spinner}>{g.barOn.repeat(8) + g.barOff.repeat(8)}</Text>;
}

/** One provider row in the live running card. */
function RunRowView({ row }: { row: RunRow }): React.ReactElement {
  const g = glyphs();
  return (
    <Box>
      <Text color={roleColor(row.role)}>{`${roleGlyph(row.role)} `}</Text>
      <Text color={roleColor(row.role)} bold>{row.role.padEnd(13)}</Text>
      <Text color={PALETTE.dim}>{row.providerId.padEnd(11)}</Text>
      <Box width={12}>
        {row.state === "running" ? (
          <Text color={PALETTE.spinner}>{`${g.severity} running`}</Text>
        ) : row.state === "queued" ? (
          <Text color={PALETTE.dim}>queued</Text>
        ) : (
          <Text color={PALETTE.pass}>{`${g.check} done`}</Text>
        )}
      </Box>
      {row.state === "running" ? <RunBar /> : <Text color={PALETTE.dim}>{row.note ?? ""}</Text>}
    </Box>
  );
}

export interface RunningCardProps {
  rows: RunRow[];
  label: string;
  startedAt: number;
}

/** The live "council running" card: a header line with the spinner + elapsed,
 *  then a per-provider grid of states and progress. */
export function RunningCard(props: RunningCardProps): React.ReactElement {
  const g = glyphs();
  const done = props.rows.filter((row) => row.state === "done").length;
  const total = props.rows.length;
  return (
    <Box flexDirection="column">
      <Text>
        <Spinner />
        <Text color={PALETTE.spinner} bold>{" reviewing"}</Text>
        <Text color={PALETTE.dim}>{` ${g.separator} ${total} runs ${g.separator} ${props.label} ${g.separator} `}</Text>
        <Elapsed since={props.startedAt} />
        <Text color={PALETTE.dim}>{` ${g.separator} esc to interrupt`}</Text>
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1}>
        {props.rows.map((row, index) => (
          <RunRowView key={`${row.providerId}-${row.role}-${index}`} row={row} />
        ))}
      </Box>
      <Text color={PALETTE.dim}>
        {`aggregating findings ${g.separator} dedupe + rank ${g.arrow} one verdict ${g.separator} ${done} of ${total} runs complete`}
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
        <Text color={PALETTE.dim}>{" available    needs-profile = enable in config"}</Text>
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        <Text color={PALETTE.dim}>{`  ${"PROVIDER".padEnd(12)}${"LOCAL".padEnd(11)}${"PROFILE".padEnd(15)}COMMAND`}</Text>
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
  ["Load", [["/diff <path>", "load a unified diff"], ["/git [base] [head]", "load a git diff"], ["/pr <number>", "load a PR diff (gh)"]]],
  ["Review", [["/review [subject]", "review the loaded diff"], ["/plan <text>", "evaluate a plan"], ["/mode review|plan", "how bare text is read"], ["/rerun", "run the last request again"]]],
  ["Council", [["/use available", "enable all runnable agents"], ["/enable <ids>", "add agents"], ["/roles <ids>", "limit roles"], ["/providers", "list agents + availability"]]],
  ["Output", [["/last", "show the last report"], ["/markdown <path>", "export Markdown"], ["/json <path>", "export JSON"], ["/clear", "reset diff + report"]]]
];

export function HelpView(): React.ReactElement {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text bold>Commands</Text>
        <Text color={PALETTE.dim}>{" — type "}</Text>
        <Text color={PALETTE.command} bold>/</Text>
        <Text color={PALETTE.dim}>{" anywhere to open the palette."}</Text>
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
        <Keycap>Esc</Keycap>
        <Text color={PALETTE.dim}>{" interrupt   "}</Text>
        <Keycap>Ctrl+C</Keycap>
        <Text color={PALETTE.dim}>{" clear / exit   "}</Text>
        <Keycap>↑</Keycap>
        <Text color={PALETTE.dim}>{" history   bare text → subject (review) or plan (plan mode)"}</Text>
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
        <Text bold>Skills</Text>
        <Text color={PALETTE.dim}>{" — the voices on the council. Toggle which perspectives review your code."}</Text>
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
              <Text color={PALETTE.dim}>{"routed to "}</Text>
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
        <Text bold>Plugins</Text>
        <Text color={PALETTE.dim}>{" — the agent CLIs Quorate drives. No API keys; it uses what's on your machine."}</Text>
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        {items.map((item) => (
          <Box key={item.id} justifyContent="space-between">
            <Text>
              <Text bold>{item.id.padEnd(12)}</Text>
              <Text color={PALETTE.dim}>{item.name.padEnd(26)}</Text>
              <Text color={PALETTE.dim}>{`roles ${g.separator} ${item.roles.join(", ") || "—"}`}</Text>
            </Text>
            {statusEl(item.status)}
          </Box>
        ))}
      </Box>
      <Text color={PALETTE.dim}>
        {`spawned without a shell ${g.separator} headless args only ${g.separator} byte + time caps ${g.separator} dangerous-flag denylist`}
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
function Seg({ options, on }: { options: string[]; on: string }): React.ReactElement {
  return (
    <Box gap={1}>
      {options.map((option) => (
        <Text key={option} color={option === on ? PALETTE.accent : PALETTE.dim} bold={option === on}>
          {option === on ? `[${option}]` : option}
        </Text>
      ))}
    </Box>
  );
}

export function SettingsView({ config }: { config: QuorateConfig }): React.ReactElement {
  const g = glyphs();
  const github = config.github;
  const enabledRole = (role: string): boolean => config.councils.includes(role);
  const allRoles = ["architect", "security", "qa", "performance", "maintainer"];
  const onOff = (value: boolean): React.ReactElement => (
    <Text color={value ? PALETTE.pass : PALETTE.dim}>{value ? `${g.check} on` : "off"}</Text>
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
        <Text color={PALETTE.dim}>{" — persisted to .quorate.yml in the repo root."}</Text>
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        <Text color={PALETTE.dim}>COUNCIL</Text>
        {allRoles.map((role) => row(role, onOff(enabledRole(role))))}
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        <Text color={PALETTE.dim}>GATE</Text>
        {row("fail-on", <Seg options={["info", "low", "medium", "high", "critical", "never"]} on={String(github.failOn)} />)}
        {row("fail on degraded", onOff(github.failOnDegraded === true))}
        {row("min agreement", <Text color={PALETTE.accent} bold>{String(github.gate?.minAgreement ?? "—")}</Text>)}
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.dim} paddingX={1} marginTop={1}>
        <Text color={PALETTE.dim}>GITHUB ACTION</Text>
        {row("comment mode", <Seg options={["update", "new", "off"]} on={github.commentMode} />)}
        {row("inline comments", onOff(github.inlineComments === true))}
        {row("runner mode", <Seg options={["auto", "cli", "api"]} on={github.runnerMode} />)}
      </Box>
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
