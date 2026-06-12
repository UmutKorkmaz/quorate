import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export interface DiffOptions {
  diff?: string;
  base?: string;
  head?: string;
  pr?: string;
}

/**
 * Generated / lock files excluded from git diffs by default. They are large,
 * noisy, and almost never worth a council review — and a single lockfile can be
 * big enough to blow a provider's `maxInputBytes` cap, failing the whole review.
 * `:(exclude,glob)` magic matches the file at the repo root and at any depth.
 */
const DIFF_EXCLUDES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "composer.lock",
  "Cargo.lock",
  "poetry.lock",
  "Gemfile.lock",
  "go.sum"
].map((name) => `:(exclude,glob)**/${name}`);

/** git pathspec that includes everything except the generated files above. */
const DIFF_PATHSPEC = ["--", ".", ...DIFF_EXCLUDES];

export function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    maxBuffer: 50 * 1024 * 1024
  });

  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error(
        `${command} not found on PATH. Install it (e.g. GitHub CLI for 'gh', git for 'git') or load a diff with /diff <file>.`
      );
    }
    throw new Error(`${command} ${args.join(" ")} failed: ${err.message}`);
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }

  return result.stdout;
}

function ensureGitWorkTree(cwd: string): void {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024
  });

  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error("git not found on PATH. Install git or pass --diff <file> to review a saved diff.");
    }
    throw new Error(`git rev-parse failed: ${err.message}`);
  }

  if (result.status !== 0 || result.stdout.trim() !== "true") {
    throw new Error(
      "No git repository found. Run quorate from a git worktree, or pass --diff <file>, --base <ref>, --head <ref>, or --pr <number>."
    );
  }
}

export function readDiff(options: DiffOptions, cwd = process.cwd()): string {
  if (options.diff) {
    return readFileSync(resolve(cwd, options.diff), "utf8");
  }

  if (options.pr) {
    if (!/^\d+$/.test(options.pr)) {
      throw new Error(
        `Invalid PR number: '${options.pr}'. Use a numeric PR id, e.g. /pr 123.`
      );
    }
    return run("gh", ["pr", "diff", options.pr], cwd);
  }

  ensureGitWorkTree(cwd);

  if (options.base && options.head) {
    return run("git", ["diff", `${options.base}...${options.head}`, ...DIFF_PATHSPEC], cwd);
  }

  if (options.base) {
    return run("git", ["diff", options.base, ...DIFF_PATHSPEC], cwd);
  }

  const staged = run("git", ["diff", "--cached", ...DIFF_PATHSPEC], cwd);
  const unstaged = run("git", ["diff", ...DIFF_PATHSPEC], cwd);
  return [staged, unstaged].filter(Boolean).join("\n");
}
