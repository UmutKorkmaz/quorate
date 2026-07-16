import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SPECIALIZED_FRONT_COPY = /\b(?:solana|anchor|web3|evm|escrow)\b/i;

function resolveSourceImport(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function collectTransitiveSource(entry: string, seen = new Set<string>()): string {
  if (seen.has(entry)) return "";
  seen.add(entry);

  const source = readFileSync(entry, "utf8");
  const imports = [...source.matchAll(/from\s+["'](\.[^"']+)["']/g)]
    .map((match) => resolveSourceImport(entry, match[1] ?? ""))
    .filter((path): path is string => path !== null);

  return [source, ...imports.map((path) => collectTransitiveSource(path, seen))].join("\n");
}

describe("public positioning", () => {
  it("keeps the GitHub Pages homepage general-purpose", () => {
    const homepage = collectTransitiveSource(
      resolve(REPO_ROOT, "packages/website/src/pages/Home.tsx")
    );

    expect(homepage).not.toMatch(SPECIALIZED_FRONT_COPY);
  });

  it("keeps specialized blockchain packs out of the README introduction", () => {
    const readme = readFileSync(resolve(REPO_ROOT, "README.md"), "utf8");
    const introduction = readme.split("## Domain packs", 1)[0] ?? readme;

    expect(introduction).not.toMatch(SPECIALIZED_FRONT_COPY);
  });
});
