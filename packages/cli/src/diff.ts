import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export interface DiffOptions {
  diff?: string;
  base?: string;
  head?: string;
  pr?: string;
}

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

  if (options.base && options.head) {
    return run("git", ["diff", `${options.base}...${options.head}`], cwd);
  }

  if (options.base) {
    return run("git", ["diff", options.base], cwd);
  }

  const staged = run("git", ["diff", "--cached"], cwd);
  const unstaged = run("git", ["diff"], cwd);
  return [staged, unstaged].filter(Boolean).join("\n");
}
