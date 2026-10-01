import { findConfigPath, findExecutable, glyphs, PALETTE, type QuorateConfig } from "@quorate/core";
import { providerSnapshots, type ProviderSnapshot, type ShellState } from "./session.js";
import { bold, dim, paint } from "./term.js";

export interface DoctorFormatOptions {
  /** When true, apply terminal colors via {@link paint}. */
  color?: boolean;
}

export interface DoctorReport {
  schema: 1;
  status: "ready" | "degraded" | "error";
  /** Read-only configuration checks; no model request or authentication probe. */
  verification: "configuration";
  environment: { node: { version: string; supported: boolean }; git?: string; gh?: string };
  providers: ProviderSnapshot[];
  councils: string[];
  configPath: string | null;
  nextSteps: string[];
}

export function buildDoctorReport(state: ShellState): DoctorReport {
  const providers = providerSnapshots(state);
  const runnable = providers.filter((provider) => provider.runnable && provider.type !== "mock");
  const node = { version: process.versions.node, supported: isSupportedNodeVersion(process.versions.node) };
  const ids = runnable.slice(0, 2).map((provider) => provider.id).join(",");
  return {
    schema: 1,
    status: !node.supported ? "error" : runnable.length > 0 ? "ready" : "degraded",
    verification: "configuration",
    environment: { node, git: findExecutable("git"), gh: findExecutable("gh") },
    providers,
    councils: [...state.config.councils],
    configPath: findConfigPath(state.cwd) ?? null,
    nextSteps: runnable.length > 0
      ? [`quorate review --providers ${ids}`, `In shell: /git → /use ${ids} → /review`, "No changes yet? Run quorate setup demo."]
      : ["quorate setup demo", "Install a reviewer, then run quorate doctor.", "In shell: /setup"]
  };
}

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 22;

/** The workspace and website dependency minimum: Node 22.22.0 or newer. */
export function isSupportedNodeVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
}

function doctorRow(
  glyph: string,
  color: string,
  label: string,
  detail: string,
  active = false,
  options: DoctorFormatOptions = {}
): string {
  const tag = active ? (options.color ? paint(PALETTE.accent, " (active)") : " (active)") : "";
  const glyphText = options.color ? paint(color, glyph) : glyph;
  const detailText = options.color ? dim(detail) : detail;
  return `  ${glyphText} ${label.padEnd(12)} ${detailText}${tag}`;
}

/**
 * The verdict-style health checklist behind `quorate doctor` and `/doctor`:
 * environment checks, per-provider state with a copy-paste fix, and a closing
 * verdict that names the next command. Honest by design — heuristic-only is
 * reported as DEGRADED, never a confident green.
 */
export function formatDoctorReport(state: ShellState, options: DoctorFormatOptions = {}): string {
  return renderDoctorReport(buildDoctorReport(state), options);
}

export function renderDoctorReport(report: DoctorReport, options: DoctorFormatOptions = {}): string {
  const g = glyphs();
  const snapshots = report.providers;
  const realRunnable = snapshots.filter((snapshot) => snapshot.runnable && snapshot.type !== "mock");
  const color = options.color ?? false;

  const heading = (text: string): string => (color ? bold(text) : text);
  const muted = (text: string): string => (color ? dim(text) : text);

  const lines: string[] = [
    "",
    color
      ? `  ${paint(["bold", PALETTE.accent], "Quorate doctor")}  ${dim(`${g.separator} council readiness`)}`
      : `  Quorate doctor  ${g.separator} council readiness`
  ];

  lines.push("", `  ${heading("Environment")}`);
  const nodeOk = report.environment.node.supported;
  lines.push(
    doctorRow(
      nodeOk ? g.check : g.cross,
      nodeOk ? PALETTE.ok : PALETTE.missing,
      `Node ${report.environment.node.version}`,
      nodeOk ? "Node >= 22.22.0 — ok" : "Quorate requires Node >= 22.22.0",
      false,
      options
    )
  );
  for (const tool of ["git", "gh"] as const) {
    const path = report.environment[tool];
    const hint = tool === "gh" ? "optional — enables /pr and --pr" : "recommended for git diffs";
    lines.push(
      doctorRow(path ? g.check : g.warn, path ? PALETTE.ok : PALETTE.needsProfile, tool, path ?? hint, false, options)
    );
  }

  lines.push(
    "",
    `  ${heading("Providers")}  ${muted(`${realRunnable.length} runnable ${g.separator} ${snapshots.length} known`)}`
  );
  for (const snapshot of snapshots) {
    let glyph = g.cross;
    let paletteColor = PALETTE.missing;
    let detail: string;
    if (snapshot.id === "heuristic") {
      glyph = g.check;
      paletteColor = PALETTE.ok;
      detail = `built-in ${g.separator} always available`;
    } else if (snapshot.runnable) {
      glyph = g.check;
      paletteColor = PALETTE.ok;
      const kind = snapshot.type === "api" ? "configured api" : "runnable";
      detail = `${kind}${snapshot.installHint ? ` ${g.separator} ${snapshot.installHint}` : ""}`;
    } else if (snapshot.type === "api") {
      // api providers are configured endpoints, not PATH binaries.
      glyph = g.warn;
      paletteColor = PALETTE.needsProfile;
      detail = `api ${g.separator} set a model and its key env ${g.arrow} quorate provider add --preset`;
    } else if (snapshot.available) {
      glyph = g.warn;
      paletteColor = PALETTE.needsProfile;
      detail = `found ${g.separator} needs a headless profile ${g.arrow} see .quorate.example.yml`;
    } else {
      detail = `not installed${snapshot.installHint ? ` ${g.separator} install ${snapshot.installHint}` : ""}`;
    }
    lines.push(doctorRow(glyph, paletteColor, snapshot.id, detail, snapshot.active, options));
  }

  lines.push("", `  ${heading("Verdict")}`);
  if (report.status === "error") {
    lines.push("  Unsupported Node version — upgrade to Node >= 22.22.0.");
  } else if (realRunnable.length > 0) {
    const ready = color
      ? paint(PALETTE.ok, `${g.check} ${realRunnable.length} reviewer profile${realRunnable.length === 1 ? "" : "s"} ready to select.`)
      : `${g.check} ${realRunnable.length} reviewer profile${realRunnable.length === 1 ? "" : "s"} ready to select.`;
    lines.push(`  ${ready}`);
  } else {
    const degraded = color
      ? paint(PALETTE.degraded, `${g.warn} Heuristic-only — reviews report as DEGRADED, never a confident pass.`)
      : `${g.warn} Heuristic-only — reviews report as DEGRADED, never a confident pass.`;
    lines.push(`  ${degraded}`);
  }
  lines.push(muted("  Configuration checks only; authentication and model execution have not been tested."));
  for (const step of report.nextSteps) lines.push(muted(`     ${step}`));
  lines.push(
    "",
    muted(`  Config: ${report.configPath ?? "none — using built-in defaults (run quorate init)"}`)
  );
  return lines.join("\n");
}

export function printDoctor(config: QuorateConfig, cwd: string, state?: ShellState): void {
  const shellState: ShellState =
    state ??
    ({
      cwd,
      config,
      mode: "review",
      transcript: []
    } satisfies ShellState);
  console.log(formatDoctorReport(shellState, { color: true }));
}
