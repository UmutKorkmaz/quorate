import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { listLiveRuns, type LiveRunEntry } from "./live-spool.js";

/**
 * Controls for `quorate monitor` surfaces, honest about process boundaries:
 * council runs happen in OTHER processes, so
 * - abort  = SIGINT to the run's recorded owner pid — exactly the run owner's
 *   own Ctrl+C path; runCouncil's abort handling does the rest (lane teardown,
 *   interrupted statuses, spool sealing).
 * - rerun  = respawn the run's recorded argv (written by our own spool sink)
 *   in its original cwd; the new run registers itself in the spool.
 *
 * There is deliberately NO per-tool approve/deny here: Quorate drives its
 * agents headless with stdin closed, so its own runs never present
 * interactive permission prompts. The actionable surface is abort/rerun.
 */

export type ControlAction = "abort" | "rerun";

export interface ControlResult {
  ok: boolean;
  message: string;
}

/** Deterministic gate lanes get first-class "gate" treatment in the UIs. */
export const GATE_PROVIDER_IDS = new Set(["supply-chain", "web3-dd"]);

export function isGateLane(providerId: string): boolean {
  return GATE_PROVIDER_IDS.has(providerId);
}

function findRun(runId: string, dir?: string): LiveRunEntry | undefined {
  return listLiveRuns({ dir }).find((run) => run.runId === runId);
}

/**
 * Best-effort identity check before signaling: the pid's command line must
 * still look like a Node/quorate process. Narrows the pid-reuse window from
 * "any process" to "another node process spawned since" — with SIGINT (the
 * default-Ctrl+C, catchable signal) as the second layer of safety.
 * POSIX only; on Windows `ps` is absent and we fall through to allow.
 */
function pidLooksLikeQuorate(pid: number): boolean {
  if (process.platform === "win32") return true;
  try {
    const result = spawnSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      timeout: 2_000,
      shell: false
    });
    if (result.status !== 0) return false; // pid is gone
    const args = (result.stdout ?? "").trim();
    return /node|quorate/i.test(args);
  } catch {
    return true; // ps itself failed — do not block the user's own abort
  }
}

/**
 * Gracefully interrupt a running council by signaling its owner process.
 * Guards: the registry entry must still say `running` (a dead owner is reaped
 * to `stale` by the same listLiveRuns call), the pid must still identify as a
 * node/quorate process, and we only ever send SIGINT — never SIGKILL.
 */
export function abortLiveRun(runId: string, dir?: string): ControlResult {
  const run = findRun(runId, dir);
  if (!run) return { ok: false, message: `Unknown run: ${runId}` };
  if (run.status !== "running") {
    return { ok: false, message: `Run is ${run.status}; only running runs can be aborted.` };
  }
  if (!pidLooksLikeQuorate(run.pid)) {
    return { ok: false, message: `pid ${run.pid} no longer looks like a Quorate run (reused pid?); not signaling.` };
  }
  try {
    process.kill(run.pid, "SIGINT");
    return { ok: true, message: `Sent SIGINT to pid ${run.pid} (${run.repo} ${run.mode}).` };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Could not signal pid ${run.pid}: ${detail}` };
  }
}

/** The first argv element must be Quorate's own entry script. Later elements
 *  are ordinary CLI args (spawned with shell:false they cannot escape into a
 *  shell), but the entrypoint is what actually executes — pin it. */
function argvLooksLikeQuorate(argv: string[]): boolean {
  const entry = argv[0] ?? "";
  return /quorate|dist\/index\.js/.test(entry) && argv.every((part) => typeof part === "string");
}

/** In-process debounce: one respawn per runId at a time. */
const rerunsInFlight = new Set<string>();
const RERUN_DEBOUNCE_MS = 5_000;

/**
 * Re-run a settled council with its original argv in its original cwd.
 * The child is detached — it outlives the monitor and registers its own
 * spool entry, which the monitor then picks up on the next poll.
 * The meta file is same-user-owned local state; the entrypoint pin above
 * keeps a tampered meta from redirecting execution to an arbitrary script.
 */
export function rerunLiveRun(runId: string, dir?: string): ControlResult {
  const run = findRun(runId, dir);
  if (!run) return { ok: false, message: `Unknown run: ${runId}` };
  if (run.status === "running") {
    return { ok: false, message: "Run is still running; abort it first or wait for it to settle." };
  }
  if (!run.argv || run.argv.length === 0) {
    return { ok: false, message: "This run has no recorded command (pre-rerun spool, or it carried secrets)." };
  }
  if (!argvLooksLikeQuorate(run.argv)) {
    return { ok: false, message: "Recorded command does not look like a Quorate invocation; not respawning." };
  }
  if (!existsSync(run.cwd)) {
    return { ok: false, message: `Original working directory is gone: ${run.cwd}` };
  }
  if (rerunsInFlight.has(runId)) {
    return { ok: false, message: "A rerun for this run was just started; wait for it to register." };
  }
  try {
    const child = spawn(process.execPath, run.argv, {
      cwd: run.cwd,
      detached: true,
      stdio: "ignore",
      shell: false
    });
    rerunsInFlight.add(runId);
    setTimeout(() => rerunsInFlight.delete(runId), RERUN_DEBOUNCE_MS).unref?.();
    child.on("error", () => {
      // Detached fire-and-forget: a spawn failure surfaces as "no new run
      // appears", which the monitor makes visible; nothing to crash here.
      rerunsInFlight.delete(runId);
    });
    child.unref();
    return { ok: true, message: `Re-running ${run.repo} ${run.mode} (pid ${child.pid ?? "?"}).` };
  } catch (error: unknown) {
    rerunsInFlight.delete(runId);
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Could not respawn run: ${detail}` };
  }
}

export function runControl(action: ControlAction, runId: string, dir?: string): ControlResult {
  return action === "abort" ? abortLiveRun(runId, dir) : rerunLiveRun(runId, dir);
}
