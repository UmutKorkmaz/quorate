import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  applyCustomPackDefinitions,
  customPackScaffold,
  parseCustomPackYaml,
  type CustomPackDefinition,
  type QuorateConfig
} from "@quorate/core";

const CUSTOM_PACK_ROOT = ".quorate/packs";

export function loadWorkspaceCustomPacks(cwd: string): CustomPackDefinition[] {
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

export function applyWorkspaceCustomPacks(config: QuorateConfig, cwd: string): QuorateConfig {
  return applyCustomPackDefinitions(config, loadWorkspaceCustomPacks(cwd));
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
