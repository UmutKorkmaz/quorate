import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

export type DiffSource =
  | { kind: "working" }
  | { kind: "staged" }
  | { kind: "branch"; base: string }
  | { kind: "pr"; number: number }
  | { kind: "file"; path: string };

export function diffSourceLabel(source: DiffSource): string {
  switch (source.kind) {
    case "working":
      return "Working tree";
    case "staged":
      return "Staged changes";
    case "branch":
      return `Branch vs ${source.base}`;
    case "pr":
      return `Pull request #${source.number}`;
    case "file":
      return `Diff file: ${path.basename(source.path)}`;
  }
}

/**
 * Turn a DiffSource into `quorate review` arguments. "staged" has no native flag,
 * so we capture `git diff --cached` into a temp file and pass it as `--diff`.
 */
export async function toReviewArgs(source: DiffSource, cwd: string): Promise<string[]> {
  switch (source.kind) {
    case "working":
      return []; // CLI default git diff = working tree
    case "branch":
      return ["--base", source.base];
    case "pr":
      return ["--pr", String(source.number)];
    case "file":
      return ["--diff", source.path];
    case "staged": {
      const diff = await gitDiffCached(cwd);
      if (!diff.trim()) throw new Error("No staged changes to review.");
      const tmp = path.join(os.tmpdir(), `quorate-staged-${Date.now()}.diff`);
      await fs.writeFile(tmp, diff, "utf8");
      return ["--diff", tmp];
    }
  }
}

function gitDiffCached(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["diff", "--cached"], { cwd, maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/** Multi-step QuickPick to choose what to review. */
export async function pickDiffSource(current: DiffSource): Promise<DiffSource | undefined> {
  const items: Array<vscode.QuickPickItem & { source?: DiffSource }> = [
    { label: "$(git-commit) Working tree", detail: "Uncommitted changes in the working tree (default)", source: { kind: "working" } },
    { label: "$(diff-added) Staged changes", detail: "git diff --cached", source: { kind: "staged" } },
    { label: "$(git-branch) Branch vs base…", detail: "Diff the current branch against a base ref" },
    { label: "$(git-pull-request) Pull request…", detail: "Review a PR diff (uses gh)" },
    { label: "$(file) Diff file…", detail: "Review a unified .diff file" }
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: "Quorate — what should the council review?",
    placeHolder: diffSourceLabel(current)
  });
  if (!picked) return undefined;
  if (picked.source) return picked.source;

  if (picked.label.includes("Branch")) {
    const base = await vscode.window.showInputBox({
      title: "Base ref to diff against",
      value: current.kind === "branch" ? current.base : "main",
      prompt: "e.g. main, develop, origin/main"
    });
    return base ? { kind: "branch", base } : undefined;
  }
  if (picked.label.includes("Pull request")) {
    const raw = await vscode.window.showInputBox({
      title: "Pull request number",
      validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : "Enter a PR number")
    });
    return raw ? { kind: "pr", number: Number(raw.trim()) } : undefined;
  }
  // Diff file
  const uris = await vscode.window.showOpenDialog({
    title: "Select a unified diff file",
    canSelectMany: false,
    filters: { Diff: ["diff", "patch", "txt"] }
  });
  return uris?.[0] ? { kind: "file", path: uris[0].fsPath } : undefined;
}
