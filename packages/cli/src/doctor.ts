import { findConfigPath, findExecutable, glyphs, PALETTE, type QuorateConfig } from "@quorate/core";
import { providerSnapshots, type ShellState } from "./session.js";
import { bold, dim, paint } from "./term.js";

export interface DoctorFormatOptions {
  /** When true, apply terminal colors via {@link paint}. */
  color?: boolean;
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
  const g = glyphs();
  const snapshots = providerSnapshots(state);
  const realRunnable = snapshots.filter((snapshot) => snapshot.runnable && snapshot.id !== "heuristic");
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
  const nodeOk = Number(process.versions.node.split(".")[0]) >= 22;
  lines.push(
    doctorRow(
      nodeOk ? g.check : g.cross,
      nodeOk ? PALETTE.ok : PALETTE.missing,
      `Node ${process.versions.node}`,
      nodeOk ? "Node >= 22 — ok" : "Quorate requires Node >= 22",
      false,
      options
    )
  );
  for (const tool of ["git", "gh"] as const) {
    const path = findExecutable(tool);
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
  if (realRunnable.length > 0) {
    const ids = realRunnable.slice(0, 2).map((snapshot) => snapshot.id).join(",");
    const ready = color
      ? paint(PALETTE.ok, `${g.check} Council ready — ${realRunnable.length} real reviewer${realRunnable.length === 1 ? "" : "s"} runnable.`)
      : `${g.check} Council ready — ${realRunnable.length} real reviewer${realRunnable.length === 1 ? "" : "s"} runnable.`;
    lines.push(`  ${ready}`);
    lines.push(muted(`     Try:  quorate review --providers ${ids} --base main`));
    lines.push(muted(`     Or in shell:  /git main HEAD  →  /use available  →  /review`));
  } else {
    const degraded = color
      ? paint(PALETTE.degraded, `${g.warn} Heuristic-only — reviews report as DEGRADED, never a confident pass.`)
      : `${g.warn} Heuristic-only — reviews report as DEGRADED, never a confident pass.`;
    lines.push(`  ${degraded}`);
    lines.push(muted("     Install a reviewer (claude, codex, qwen …), then:"));
    lines.push(muted("       quorate init      # write .quorate.yml"));
    lines.push(muted("       quorate doctor    # confirm it is runnable"));
    lines.push(muted("     Or in shell:  /setup"));
  }
  lines.push(
    "",
    muted(`  Config: ${findConfigPath(state.cwd) ?? "none — using built-in defaults (run quorate init)"}`)
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