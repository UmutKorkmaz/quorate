import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  applyCustomPackDefinitions,
  customPackScaffold,
  parseCustomPackYaml,
  type CustomPackDefinition,
  type QuorateConfig
} from "@quorate/core";
import { workspaceCommandsTrusted } from "./custom-commands.js";

const CUSTOM_PACK_ROOT = ".quorate/packs";

/**
 * Discover workspace custom packs from `.quorate/packs/*.yml`.
 *
 * Workspace packs are attacker-controlled content in a cloned/untrusted repo —
 * their roleGuidance is merged into reviewer prompts sent to real AI agent CLIs
 * and their regexes run over the diff. The trust signal must come from OUTSIDE
 * the repo (a repo must not be able to enable its own packs), so it is an env
 * opt-in (QUORATE_TRUST_WORKSPACE, see workspaceCommandsTrusted), never a
 * config flag.
 */
export function loadWorkspaceCustomPacks(
  cwd: string,
  trusted: boolean = workspaceCommandsTrusted()
): CustomPackDefinition[] {
  // Untrusted by default: never load repo-authored packs unless the user has
  // explicitly opted in with QUORATE_TRUST_WORKSPACE.
  if (!trusted) return [];
  const root = resolve(cwd, CUSTOM_PACK_ROOT);
  if (!existsSync(root)) return [];
  const definitions: CustomPackDefinition[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const full = join(root, entry.name);
    definitions.push(parseCustomPackYaml(readFileSync(full, "utf8"), relative(cwd, full)));
  }
  return definitions.sort((a, b) => a.pack.id.localeCompare(b.pack.id));
}

export function applyWorkspaceCustomPacks(
  config: QuorateConfig,
  cwd: string,
  trusted: boolean = workspaceCommandsTrusted()
): QuorateConfig {
  return applyCustomPackDefinitions(config, loadWorkspaceCustomPacks(cwd, trusted));
}

export function writeCustomPackScaffold(cwd: string, id: string, force = false): string {
  const target = resolve(cwd, CUSTOM_PACK_ROOT, `${id}.yml`);
  if (existsSync(target) && !force) {
    throw new Error(`${relative(cwd, target)} already exists. Use --force to overwrite it.`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, customPackScaffold(id), "utf8");
  return target;
}
