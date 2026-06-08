import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export interface ProjectMemory {
  /** Absolute path to the loaded QUORATE.md file. */
  path: string;
  /** Display-friendly path (e.g. `QUORATE.md` or `.quorate/QUORATE.md`). */
  label: string;
  roles?: string[];
  agents?: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const SECTION_ROLES_RE = /^##\s*default\s+roles?\s*$/im;
const SECTION_AGENTS_RE = /^##\s*(?:preferred\s+)?agents?\s*$/im;

function parseListValue(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean);
}

function parseFrontmatter(block: string): { roles?: string[]; agents?: string[] } {
  const result: { roles?: string[]; agents?: string[] } = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s*(roles|agents|providers)\s*:\s*(.+)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const values = parseListValue(match[2]);
    if (values.length === 0) continue;
    if (key === "roles") result.roles = values;
    else result.agents = values;
  }
  return result;
}

function sectionBody(content: string, headingRe: RegExp): string | undefined {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => headingRe.test(line.trim()));
  if (start < 0) return undefined;

  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/.test(line)) break;
    body.push(line);
  }
  const text = body.join("\n").trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Parse default roles and preferred agents from QUORATE.md frontmatter or
 * lightweight markdown sections. Regex-only — no YAML parser dependency.
 */
export function parseProjectMemory(content: string): Pick<ProjectMemory, "roles" | "agents"> {
  const parsed: Pick<ProjectMemory, "roles" | "agents"> = {};
  const frontmatter = content.match(FRONTMATTER_RE);
  if (frontmatter) {
    Object.assign(parsed, parseFrontmatter(frontmatter[1]));
  }

  const body = frontmatter ? content.slice(frontmatter[0].length) : content;
  if (!parsed.roles) {
    const section = sectionBody(body, SECTION_ROLES_RE);
    if (section) parsed.roles = parseListValue(section);
  }
  if (!parsed.agents) {
    const section = sectionBody(body, SECTION_AGENTS_RE);
    if (section) parsed.agents = parseListValue(section);
  }

  return parsed;
}

/** Resolve QUORATE.md or .quorate/QUORATE.md under `cwd`, preferring the root file. */
export function findProjectMemoryPath(cwd: string): string | undefined {
  for (const relative of ["QUORATE.md", ".quorate/QUORATE.md"]) {
    const path = resolve(cwd, relative);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/** Load project memory from disk when a QUORATE.md file is present. */
export function loadProjectMemory(cwd: string): ProjectMemory | undefined {
  const path = findProjectMemoryPath(cwd);
  if (!path) return undefined;

  const content = readFileSync(path, "utf8");
  const parsed = parseProjectMemory(content);
  const label = path.endsWith(".quorate/QUORATE.md") ? ".quorate/QUORATE.md" : basename(path);

  if (!parsed.roles?.length && !parsed.agents?.length) {
    return { path, label };
  }

  return { path, label, roles: parsed.roles, agents: parsed.agents };
}

/** True when the file defines at least one default role or preferred agent. */
export function hasProjectDefaults(memory: ProjectMemory | undefined): memory is ProjectMemory {
  if (!memory) return false;
  return Boolean(memory.roles?.length || memory.agents?.length);
}

/** One-line welcome/status hint when project defaults were loaded. */
export function projectDefaultsLine(memory: ProjectMemory | undefined): string | undefined {
  if (!hasProjectDefaults(memory)) return undefined;
  return "project defaults loaded";
}

/** Apply QUORATE.md defaults to a shell session when CLI flags did not override them. */
export function applyProjectMemoryDefaults<T extends { activeProviders?: string[]; activeRoles?: string[] }>(
  state: T,
  memory: ProjectMemory | undefined,
  options: { providersFromCli?: boolean } = {}
): T {
  if (!hasProjectDefaults(memory)) return state;

  const next = { ...state };
  if (!options.providersFromCli && memory.agents?.length && next.activeProviders === undefined) {
    next.activeProviders = memory.agents;
  }
  if (memory.roles?.length && next.activeRoles === undefined) {
    next.activeRoles = memory.roles;
  }
  return next;
}

/** Project-memory lines appended to `/inspect` output. */
export function projectMemoryInspectLines(memory: ProjectMemory | undefined): string[] {
  if (!memory) {
    return ["Project memory: not found (add QUORATE.md or .quorate/QUORATE.md)"];
  }

  const lines = [
    `Project memory: ${memory.label}`,
    `Default roles: ${memory.roles?.join(", ") ?? "(none)"}`,
    `Preferred agents: ${memory.agents?.join(", ") ?? "(none)"}`
  ];
  if (hasProjectDefaults(memory)) {
    lines.push("Project defaults: loaded");
  }
  return lines;
}