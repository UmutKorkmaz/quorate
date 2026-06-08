import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import YAML from "yaml";
import type { CouncilMode } from "@quorate/core";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface CustomCommandDefinition {
  name: string;
  description: string;
  body: string;
  argHint?: string;
  mode?: CouncilMode;
  path: string;
}

export function parseCustomCommandFile(content: string, name: string, path: string): CustomCommandDefinition {
  const match = content.match(FRONTMATTER_RE);
  let body = content.trim();
  let meta: Record<string, unknown> = {};

  if (match) {
    body = content.slice(match[0].length).trim();
    try {
      const parsed = YAML.parse(match[1]);
      meta = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      meta = {};
    }
  }

  const description =
    typeof meta.description === "string" && meta.description.trim()
      ? meta.description.trim()
      : (body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? name);

  const argHintRaw = meta["argument-hint"] ?? meta.argumentHint;
  let argHint: string | undefined;
  if (typeof argHintRaw === "string" && argHintRaw.trim()) {
    argHint = argHintRaw.trim();
  } else if (Array.isArray(argHintRaw) && argHintRaw.length > 0) {
    argHint = `[${argHintRaw.map(String).join(", ")}]`;
  }
  const mode = meta.mode === "plan" || meta.mode === "review" ? meta.mode : undefined;

  return { name, description, body, argHint, mode, path };
}

/** Map a path under `.quorate/commands/` to a slash command name (supports `ns:cmd` namespacing). */
export function commandNameFromRelativePath(relativePath: string): string {
  const withoutExt = relativePath.replace(/\.md$/i, "");
  const parts = withoutExt.split(/[/\\]/);
  if (parts.length === 1) return parts[0];
  const namespace = parts.slice(0, -1).join(":");
  const command = parts[parts.length - 1] ?? "";
  return `${namespace}:${command}`;
}

function walkCommandsDir(dir: string, commandsRoot: string, results: CustomCommandDefinition[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkCommandsDir(full, commandsRoot, results);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const rel = relative(commandsRoot, full);
    const name = commandNameFromRelativePath(rel);
    const content = readFileSync(full, "utf8");
    results.push(parseCustomCommandFile(content, name, full));
  }
}

/** Discover workspace slash commands from `.quorate/commands/` markdown files. */
/**
 * Whether to trust workspace-defined slash commands. `.quorate/commands/*.md`
 * is attacker-controlled content in a cloned/untrusted repo — its body is fed
 * straight into a council prompt and its name becomes a runnable command. The
 * trust signal must come from OUTSIDE the repo (a repo must not be able to
 * enable its own commands), so it is an env opt-in, never a config flag.
 */
export function workspaceCommandsTrusted(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.QUORATE_TRUST_WORKSPACE;
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

export function discoverCustomCommands(
  cwd: string,
  trusted: boolean = workspaceCommandsTrusted()
): CustomCommandDefinition[] {
  // Untrusted by default: never load repo-authored commands unless the user has
  // explicitly opted in with QUORATE_TRUST_WORKSPACE.
  if (!trusted) return [];
  const commandsRoot = resolve(cwd, ".quorate", "commands");
  if (!existsSync(commandsRoot)) return [];
  const results: CustomCommandDefinition[] = [];
  walkCommandsDir(commandsRoot, commandsRoot, results);
  return results.sort((left, right) => left.name.localeCompare(right.name));
}

/** Expand `{{args}}` in the prompt body, or append trailing user args. */
export function renderCustomPrompt(body: string, args: string): string {
  if (!args) return body;
  if (body.includes("{{args}}")) return body.replace(/\{\{args\}\}/g, args);
  return `${body}\n\n${args}`;
}