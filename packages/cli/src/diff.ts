import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export interface DiffOptions {
  diff?: string;
  base?: string;
  head?: string;
  pr?: string;
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    maxBuffer: 50 * 1024 * 1024
  });

  if (result.error) {
    throw new Error(`${command} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout;
}

export function readDiff(options: DiffOptions, cwd = process.cwd()): string {
  if (options.diff) {
    return readFileSync(resolve(cwd, options.diff), "utf8");
  }

  if (options.pr) {
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
