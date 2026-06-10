import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { Finding } from "@quorate/core";

/**
 * Fix snapshot/revert engine. Before a write-mode agent touches the tree we pin
 * the current uncommitted state (`git stash create` + `git stash store`, which
 * mutates nothing in the worktree) and record the untracked-file list. Revert
 * restores tracked files to HEAD, deletes agent-created untracked files, and
 * re-applies the pre-fix stash — refusing when the tree changed since the fix.
 */
export interface FixMeta {
  fixId: string;
  findingTitle: string;
  findingFile?: string;
  findingLine?: number;
  agentId: string;
  stashSha?: string;
  snapshotAt: string;
  treeDirty: boolean;
  status: "pending" | "applied" | "reverted" | "revert-conflict";
  /** Hash of `git diff HEAD` right after the agent finished — revert guard. */
  postFixDiffHash?: string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export function fixRootDir(cwd: string): string {
  return resolve(cwd, ".quorate", "fix");
}

function fixDir(cwd: string, fixId: string): string {
  return join(fixRootDir(cwd), fixId);
}

function metaPath(cwd: string, fixId: string): string {
  return join(fixDir(cwd, fixId), "meta.json");
}

export function readFixMeta(cwd: string, fixId: string): FixMeta | undefined {
  const path = metaPath(cwd, fixId);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as FixMeta;
}

function writeFixMeta(cwd: string, meta: FixMeta): void {
  writeFileSync(metaPath(cwd, meta.fixId), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

export function listFixes(cwd: string): FixMeta[] {
  const root = fixRootDir(cwd);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((id) => readFixMeta(cwd, id))
    .filter((meta): meta is FixMeta => meta !== undefined)
    .sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt));
}

export function latestFix(cwd: string): FixMeta | undefined {
  return listFixes(cwd).at(-1);
}

function untrackedFiles(cwd: string): string[] {
  return git(cwd, ["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean)
    // Quorate's own metadata is never part of a fix (it may not be gitignored yet).
    .filter((file) => !file.startsWith(".quorate/"));
}

function diffHash(cwd: string): string {
  return createHash("sha256").update(git(cwd, ["diff", "HEAD"])).digest("hex");
}

/** Pin the pre-fix state. Mutates nothing in the worktree. */
export function createFixSnapshot(cwd: string, finding: Finding, agentId: string): FixMeta {
  const fixId = randomUUID().slice(0, 8);
  mkdirSync(fixDir(cwd, fixId), { recursive: true });

  const stashSha = git(cwd, ["stash", "create", `quorate/pre-fix/${fixId}`]).trim();
  if (stashSha) {
    git(cwd, ["stash", "store", "-m", `quorate/pre-fix/${fixId}`, stashSha]);
  }
  writeFileSync(join(fixDir(cwd, fixId), "untracked-before.txt"), `${untrackedFiles(cwd).join("\n")}\n`, "utf8");
  writeFileSync(join(fixDir(cwd, fixId), "finding.json"), `${JSON.stringify(finding, null, 2)}\n`, "utf8");

  const meta: FixMeta = {
    fixId,
    findingTitle: finding.title,
    findingFile: finding.file,
    findingLine: finding.line,
    agentId,
    stashSha: stashSha || undefined,
    snapshotAt: new Date().toISOString(),
    treeDirty: Boolean(stashSha),
    status: "pending"
  };
  writeFixMeta(cwd, meta);
  return meta;
}

/** Record what the agent changed: untracked annex + the post-fix tree hash. */
export function finalizeFix(cwd: string, fixId: string): { changedStat: string; newUntracked: string[] } {
  const meta = readFixMeta(cwd, fixId);
  if (!meta) throw new Error(`No fix "${fixId}" found under .quorate/fix.`);

  const before = new Set(
    readFileSync(join(fixDir(cwd, fixId), "untracked-before.txt"), "utf8").split("\n").filter(Boolean)
  );
  const after = untrackedFiles(cwd);
  const newUntracked = after.filter((file) => !before.has(file));
  writeFileSync(join(fixDir(cwd, fixId), "untracked-after.txt"), `${after.join("\n")}\n`, "utf8");
  for (const file of newUntracked) {
    const target = join(fixDir(cwd, fixId), "untracked", file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(cwd, file), target);
  }

  writeFixMeta(cwd, { ...meta, status: "applied", postFixDiffHash: diffHash(cwd) });
  const changedStat = git(cwd, ["diff", "--stat", "HEAD"]).trim();
  return { changedStat, newUntracked };
}

/**
 * Undo a fix: tracked files back to HEAD, agent-created untracked files deleted,
 * the pre-fix stash re-applied. Refuses when the tree changed since the fix
 * (unless force), when already reverted, or when the snapshot is gone.
 */
export function revertFix(cwd: string, fixId?: string, options: { force?: boolean } = {}): FixMeta {
  const meta = fixId ? readFixMeta(cwd, fixId) : latestFix(cwd);
  if (!meta) throw new Error(fixId ? `No fix "${fixId}" found.` : "No fixes recorded yet.");
  if (meta.status === "reverted") throw new Error(`Fix ${meta.fixId} is already reverted.`);
  if (meta.status === "pending") throw new Error(`Fix ${meta.fixId} never finished — nothing recorded to revert.`);

  if (meta.postFixDiffHash && diffHash(cwd) !== meta.postFixDiffHash && !options.force) {
    throw new Error(
      `The working tree changed since fix ${meta.fixId} was applied — reverting now could destroy newer edits. Re-run with --force to revert anyway.`
    );
  }
  if (meta.stashSha) {
    try {
      git(cwd, ["cat-file", "-e", `${meta.stashSha}^{commit}`]);
    } catch {
      throw new Error(`The pre-fix snapshot for ${meta.fixId} was garbage-collected — cannot restore the previous uncommitted state.`);
    }
  }

  // 1. Tracked files back to HEAD.
  git(cwd, ["restore", "--worktree", "--staged", "--source=HEAD", "--", "."]);
  // 2. Remove untracked files the agent created.
  const before = new Set(
    readFileSync(join(fixDir(cwd, meta.fixId), "untracked-before.txt"), "utf8").split("\n").filter(Boolean)
  );
  const afterPath = join(fixDir(cwd, meta.fixId), "untracked-after.txt");
  const after = existsSync(afterPath) ? readFileSync(afterPath, "utf8").split("\n").filter(Boolean) : [];
  for (const file of after) {
    if (!before.has(file) && existsSync(resolve(cwd, file))) unlinkSync(resolve(cwd, file));
  }
  // 3. Re-apply the pre-fix uncommitted state.
  let status: FixMeta["status"] = "reverted";
  if (meta.stashSha) {
    try {
      git(cwd, ["stash", "apply", "--index", meta.stashSha]);
      dropStoredStash(cwd, meta.stashSha);
    } catch {
      status = "revert-conflict";
    }
  }

  const next: FixMeta = { ...meta, status };
  writeFixMeta(cwd, next);
  if (status === "revert-conflict") {
    throw new Error(
      `Tracked files were restored to HEAD, but re-applying your pre-fix changes hit a conflict. Your pre-fix state is preserved in stash ${meta.stashSha} — resolve with \`git stash apply ${meta.stashSha}\`.`
    );
  }
  return next;
}

function dropStoredStash(cwd: string, sha: string): void {
  const list = git(cwd, ["stash", "list", "--format=%H %gd"]).split("\n").filter(Boolean);
  const hit = list.find((line) => line.startsWith(sha));
  const ref = hit?.split(" ")[1];
  if (ref) git(cwd, ["stash", "drop", ref]);
}

/** Remove a fix record (housekeeping). */
export function discardFixRecord(cwd: string, fixId: string): void {
  rmSync(fixDir(cwd, fixId), { recursive: true, force: true });
}
