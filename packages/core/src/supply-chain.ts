import { posix as path } from "node:path";
import type { DiffLine } from "./heuristics.js";
import { computeReviewId, fingerprintFinding } from "./identity.js";
import type {
  CouncilReport,
  CouncilRequest,
  Finding,
  ProviderResult,
  QuorateConfig,
  Severity,
  Verdict
} from "./types.js";

const PROVIDER_ID = "supply-chain";
const ROLE = "supply-chain";
const NPM_LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb"
]);
const DEPENDENCY_SECTIONS = new Set([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies"
]);
const WORKFLOW_RE = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;
const FULL_SHA_RE = /^[a-f0-9]{40}$/i;
const FULL_SHA256_DIGEST_RE = /@sha256:[a-f0-9]{64}$/i;
const INCOMPLETE_DIFF_MARKER_RE = /^# quorate-supply-chain-incomplete:/m;
const PACKAGE_AUTH_RE =
  /(?:\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b|\b[A-Z0-9_]*(?:NPM|PUBLISH|REGISTRY)[A-Z0-9_]*TOKEN\b|_authToken\b|npmrc)/i;
const PACKAGE_PUBLISH_RE =
  /\b(?:(?:npm|pnpm|bun)\s+publish|yarn(?:\s+npm)?\s+publish)\b/i;
const INDIRECT_PUBLISH_RE =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:publish|release|deploy)\b/i;
const NPM_PROVENANCE_RE =
  /(?:^|\s)--provenance(?:=true)?(?=\s|$)|\bprovenance\s*[:=]\s*true\b/im;
const ID_TOKEN_WRITE_RE = /\bid-token\s*:\s*write\b/;
const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

type SupplyChainRule =
  | "dependencyWithoutLockfile"
  | "unpinnedActions"
  | "mutableBaseImage"
  | "npmPublishWithoutProvenance";

type DiffKind = "added" | "removed" | "context";

interface ParsedDiffLine extends DiffLine {
  kind: DiffKind;
}

interface ParsedDiffFile {
  file: string;
  oldFile?: string;
  deleted?: boolean;
  newFile?: boolean;
  incomplete?: boolean;
  lines: ParsedDiffLine[];
}

interface DependencyAddition {
  name: string;
  value: string;
  section: string;
  file: string;
  line?: number;
}

function parseDiff(diff: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = [];
  let current: ParsedDiffFile | undefined;
  let oldLine: number | undefined;
  let newLine: number | undefined;
  let oldRemaining: number | undefined;
  let newRemaining: number | undefined;
  let inHunk = false;

  const finishHunkIfComplete = (): void => {
    if (oldRemaining === 0 && newRemaining === 0) inHunk = false;
  };

  const markIncompleteHunk = (): void => {
    if (
      current &&
      inHunk &&
      (oldRemaining === undefined ||
        newRemaining === undefined ||
        oldRemaining !== 0 ||
        newRemaining !== 0)
    ) {
      current.incomplete = true;
    }
  };

  const headerPath = (raw: string): string | undefined => {
    const value = raw.slice(4).split("\t", 1)[0].trim();
    if (!value || value === "/dev/null") return undefined;
    return value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;
  };

  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("diff --git ")) {
      markIncompleteHunk();
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(raw);
      current = { file: match?.[2] ?? "", oldFile: match?.[1], lines: [] };
      files.push(current);
      oldLine = undefined;
      newLine = undefined;
      oldRemaining = undefined;
      newRemaining = undefined;
      inHunk = false;
      continue;
    }

    if (!inHunk && raw.startsWith("--- ")) {
      const oldHeader = raw.slice(4).split("\t", 1)[0].trim();
      const oldFile = headerPath(raw);
      if (!current || current.lines.length > 0 || current.deleted) {
        current = {
          file: oldFile ?? "",
          oldFile,
          newFile: oldHeader === "/dev/null",
          lines: []
        };
        files.push(current);
      } else {
        current.oldFile = oldFile;
        current.newFile = oldHeader === "/dev/null";
      }
      oldLine = undefined;
      newLine = undefined;
      oldRemaining = undefined;
      newRemaining = undefined;
      continue;
    }

    if (!current) continue;

    if (!inHunk && raw.startsWith("+++ ")) {
      const newFile = headerPath(raw);
      if (newFile) current.file = newFile;
      else current.deleted = true;
      continue;
    }

    if (raw.startsWith("@@")) {
      const match = /-(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))?/.exec(raw);
      oldLine = match ? Number(match[1]) : undefined;
      newLine = match ? Number(match[3]) : undefined;
      oldRemaining = match ? Number(match[2] ?? "1") : undefined;
      newRemaining = match ? Number(match[4] ?? "1") : undefined;
      if (oldLine === 0 && oldRemaining === 0) current.newFile = true;
      inHunk = true;
      finishHunkIfComplete();
      continue;
    }

    if (raw.startsWith("+") && (inHunk || !raw.startsWith("+++"))) {
      current.lines.push({ kind: "added", file: current.file, line: newLine, text: raw.slice(1) });
      if (newLine !== undefined) newLine += 1;
      if (newRemaining !== undefined) newRemaining -= 1;
      finishHunkIfComplete();
      continue;
    }

    if (raw.startsWith("-") && (inHunk || !raw.startsWith("---"))) {
      current.lines.push({ kind: "removed", file: current.file, line: oldLine, text: raw.slice(1) });
      if (oldLine !== undefined) oldLine += 1;
      if (oldRemaining !== undefined) oldRemaining -= 1;
      finishHunkIfComplete();
      continue;
    }

    if (raw.startsWith(" ")) {
      current.lines.push({ kind: "context", file: current.file, line: newLine, text: raw.slice(1) });
      if (oldLine !== undefined) oldLine += 1;
      if (newLine !== undefined) newLine += 1;
      if (oldRemaining !== undefined) oldRemaining -= 1;
      if (newRemaining !== undefined) newRemaining -= 1;
      finishHunkIfComplete();
    }
  }

  markIncompleteHunk();

  return files.filter((file) => file.file && file.file !== "/dev/null");
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const candidate of text) {
    if (candidate === char) count += 1;
  }
  return count;
}

function jsonPropertyName(text: string): string | undefined {
  return /^\s*"([^"]+)"\s*:/.exec(text)?.[1];
}

function dependencyEntry(text: string): { name: string; value: string } | undefined {
  const match = /^\s*"([^"]+)"\s*:\s*"([^"]+)"\s*,?\s*$/.exec(text);
  return match ? { name: match[1], value: match[2] } : undefined;
}

function looksLikeDependencySpec(value: string): boolean {
  const candidate = value.trim();
  return (
    /^(?:[\^~<>=*]|v?\d|workspace:|npm:|file:|link:|git(?:\+https)?:|https?:|github:|catalog:)/i.test(
      candidate
    ) ||
    /^[a-z][a-z0-9._-]*$/i.test(candidate) ||
    /^(?:@?[\w.-]+)\/[\w.-]+(?:#.*)?$/.test(candidate)
  );
}

function looksLikeStrongDependencySpec(value: string): boolean {
  const candidate = value.trim();
  return /^(?:[\^~<>=*]|v?\d|workspace:|npm:|file:|link:|git(?:\+https)?:|https?:|github:|catalog:)/i.test(
    candidate
  );
}

function hasNearbyDependencyEntry(lines: ParsedDiffLine[], index: number): boolean {
  const start = Math.max(0, index - 3);
  const end = Math.min(lines.length, index + 4);
  for (let i = start; i < end; i += 1) {
    if (i === index) continue;
    const entry = dependencyEntry(lines[i].text);
    if (entry && looksLikeStrongDependencySpec(entry.value)) return true;
  }
  return false;
}

function changedNpmLockfiles(files: ParsedDiffFile[]): ParsedDiffFile[] {
  return files.filter(
    (file) =>
      !file.deleted &&
      NPM_LOCKFILES.has(path.basename(file.file)) &&
      file.lines.some((line) => line.kind === "added")
  );
}

function ruleEnabled(config: QuorateConfig | undefined, rule: SupplyChainRule): boolean {
  if (rule === "dependencyWithoutLockfile" && config?.supplyChain?.lockfiles?.onMissing === "off") {
    return false;
  }
  return config?.supplyChain?.rules?.[rule]?.enabled !== false;
}

function ecosystemEnabled(config: QuorateConfig | undefined, aliases: string[]): boolean {
  const configured = config?.supplyChain?.ecosystems;
  if (!configured || configured.length === 0) return true;
  const selected = new Set(configured.map((entry) => entry.toLowerCase()));
  return aliases.some((alias) => selected.has(alias));
}

function lockfileRequiredFor(config: QuorateConfig | undefined, aliases: string[]): boolean {
  const configured = config?.supplyChain?.lockfiles?.requireFor;
  if (!configured || configured.length === 0) return true;
  const required = new Set(configured.map((entry) => entry.toLowerCase()));
  return aliases.some((alias) => required.has(alias));
}

function ruleSeverity(
  config: QuorateConfig | undefined,
  rule: SupplyChainRule,
  fallback: Severity
): Severity {
  return config?.supplyChain?.rules?.[rule]?.severity ?? fallback;
}

function dependencyMissingLockfileSeverity(config: QuorateConfig | undefined): Severity {
  const configured = config?.supplyChain?.rules?.dependencyWithoutLockfile?.severity;
  if (configured) return configured;
  return config?.supplyChain?.lockfiles?.onMissing === "warn" ? "medium" : "high";
}

function allowlisted(values: string[] | undefined, candidates: string[]): boolean {
  if (!values || values.length === 0) return false;
  return candidates.some((candidate) => values.includes(candidate));
}

function isAncestorOrSame(ancestor: string, descendant: string): boolean {
  if (ancestor === "." || ancestor === "") return true;
  return descendant === ancestor || descendant.startsWith(`${ancestor}/`);
}

function versionTuple(value: string): [number, number, number] | undefined {
  const match = /(?:^|[^\d])(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(value);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2] ?? 0) || 0, Number(match[3] ?? 0) || 0];
}

function compareVersion(
  left: [number, number, number],
  right: [number, number, number]
): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function versionSatisfiesVisibleSpec(spec: string, resolved: string): boolean {
  const actual = versionTuple(resolved);
  if (!actual) return false;

  const trimmed = spec.trim();
  if (trimmed.includes("||")) {
    return trimmed.split("||").some((part) => versionSatisfiesVisibleSpec(part, resolved));
  }

  const hyphenRange = /^(v?\d+(?:\.\d+){0,2})\s+-\s+(v?\d+(?:\.\d+){0,2})$/.exec(trimmed);
  if (hyphenRange) {
    const lower = versionTuple(hyphenRange[1]);
    const upper = versionTuple(hyphenRange[2]);
    return Boolean(
      lower && upper && compareVersion(actual, lower) >= 0 && compareVersion(actual, upper) <= 0
    );
  }

  if (/\s/.test(trimmed)) {
    const comparators = trimmed.split(/\s+/).filter(Boolean);
    if (comparators.every((part) => /^(?:[<>]=?|=)?v?\d+(?:\.\d+){0,2}$/.test(part))) {
      return comparators.every((part) => versionSatisfiesVisibleSpec(part, resolved));
    }
    return false;
  }

  const wildcard = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(trimmed);
  if (wildcard && (wildcard[2] === "x" || wildcard[2] === "*" || wildcard[3] === "x" || wildcard[3] === "*")) {
    if (actual[0] !== Number(wildcard[1])) return false;
    if (wildcard[2] && wildcard[2] !== "x" && wildcard[2] !== "*") {
      return actual[1] === Number(wildcard[2]);
    }
    return true;
  }

  const requested = versionTuple(trimmed);
  if (!requested) return false;

  const comparison = compareVersion(actual, requested);
  if (trimmed.startsWith("^")) {
    if (requested[0] > 0) return actual[0] === requested[0] && comparison >= 0;
    return actual[0] === 0 && actual[1] === requested[1] && comparison >= 0;
  }
  if (trimmed.startsWith("~")) {
    return actual[0] === requested[0] && actual[1] === requested[1] && comparison >= 0;
  }
  if (trimmed.startsWith(">=")) return comparison >= 0;
  if (trimmed.startsWith(">")) return comparison > 0;
  if (trimmed.startsWith("<=")) return comparison <= 0;
  if (trimmed.startsWith("<")) return comparison < 0;
  if (trimmed.startsWith("=")) return comparison === 0;
  if (/^v?\d+(?:\.\d+){0,2}(?:-[\w.-]+)?$/.test(trimmed)) {
    const dotCount = (trimmed.match(/\./g) ?? []).length;
    if (actual[0] !== requested[0]) return false;
    if (dotCount >= 1 && actual[1] !== requested[1]) return false;
    return dotCount < 2 || actual[2] === requested[2];
  }
  return false;
}

function jsonObjectBlock(lines: ParsedDiffLine[], start: number): ParsedDiffLine[] | undefined {
  const first = lines[start]?.text;
  if (!first) return undefined;
  let depth = countChar(first, "{") - countChar(first, "}");
  if (depth < 0) return undefined;
  const block = [lines[start]];
  if (depth === 0) return block;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    block.push(line);
    depth += countChar(line.text, "{") - countChar(line.text, "}");
    if (depth === 0) return block;
    if (depth < 0) return undefined;
  }
  return undefined;
}

function jsonArrayBlock(lines: ParsedDiffLine[], start: number): ParsedDiffLine[] | undefined {
  const first = lines[start]?.text;
  if (!first) return undefined;
  let depth = countChar(first, "[") - countChar(first, "]");
  if (depth < 0) return undefined;
  const block = [lines[start]];
  if (depth === 0) return block;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    block.push(line);
    depth += countChar(line.text, "[") - countChar(line.text, "]");
    if (depth === 0) return block;
    if (depth < 0) return undefined;
  }
  return undefined;
}

function indentedBlock(lines: ParsedDiffLine[], start: number): ParsedDiffLine[] {
  const baseIndent = indentation(lines[start]?.text ?? "");
  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.text.trim() && !line.text.trimStart().startsWith("#") && indentation(line.text) <= baseIndent) {
      break;
    }
    block.push(line);
  }
  return block;
}

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

function lockfileManager(file: string): PackageManager | undefined {
  const basename = path.basename(file);
  if (basename === "package-lock.json" || basename === "npm-shrinkwrap.json") return "npm";
  if (basename === "pnpm-lock.yaml") return "pnpm";
  if (basename === "yarn.lock") return "yarn";
  if (basename === "bun.lock" || basename === "bun.lockb") return "bun";
  return undefined;
}

function declaredPackageManager(file: ParsedDiffFile): PackageManager | undefined {
  for (const line of file.lines) {
    if (line.kind !== "context") continue;
    const match = /^\s*"packageManager"\s*:\s*"(npm|pnpm|yarn|bun)@/i.exec(line.text);
    if (match) return match[1].toLowerCase() as PackageManager;
  }
  return undefined;
}

function expectedPackageManager(
  packageJson: ParsedDiffFile,
  files: ParsedDiffFile[],
  repositoryFiles: ReadonlySet<string>
): PackageManager | "ambiguous" | undefined {
  const packageDir = path.dirname(packageJson.file);
  const candidates = new Set<PackageManager>();
  const declared = declaredPackageManager(packageJson);
  if (declared) candidates.add(declared);

  for (const file of files) {
    const manager = lockfileManager(file.file);
    if (!manager || file.newFile === true) continue;
    const lockDir = path.dirname(file.file);
    if (lockDir === packageDir || isAncestorOrSame(lockDir, packageDir)) {
      candidates.add(manager);
    }
  }

  if (!path.isAbsolute(packageJson.file) && packageDir !== ".." && !packageDir.startsWith("../")) {
    let directory = packageDir;
    while (true) {
      for (const lockfile of NPM_LOCKFILES) {
        const relative = directory === "." ? lockfile : path.join(directory, lockfile);
        const changed = files.find((file) => file.file === relative);
        if (changed?.newFile === true || changed?.deleted === true) continue;
        if (repositoryFiles.has(relative)) {
          const manager = lockfileManager(relative);
          if (manager) candidates.add(manager);
        }
      }
      if (directory === ".") break;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  if (candidates.size > 1) return "ambiguous";
  return candidates.values().next().value;
}

function lockfileHasResolvedDependency(
  lockfile: ParsedDiffFile,
  dependency: DependencyAddition
): boolean {
  const basename = path.basename(lockfile.file);
  const escapedName = dependency.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const visibleLines = lockfile.lines.filter((line) => line.kind !== "removed");

  if (basename === "package-lock.json" || basename === "npm-shrinkwrap.json") {
    const header = new RegExp(`"node_modules/${escapedName}"\\s*:`);
    const headerIndex = visibleLines.findIndex((line) => header.test(line.text));
    if (headerIndex < 0) return false;
    const blockLines = jsonObjectBlock(visibleLines, headerIndex);
    if (!blockLines || !blockLines.some((line) => line.kind === "added")) return false;
    const block = blockLines.map((line) => line.text).join("\n");
    const resolvedVersion = /"version"\s*:\s*"([^"]+)"/.exec(block)?.[1];
    const resolvedUrl = /"resolved"\s*:\s*"([^"]+)"/.exec(block)?.[1];
    const integrity = /"integrity"\s*:\s*"(sha(?:256|512)-[A-Za-z0-9+/=_-]+)"/i.exec(block)?.[1];
    return (
      resolvedVersion !== undefined &&
      versionSatisfiesVisibleSpec(dependency.value, resolvedVersion) &&
      resolvedUrl !== undefined &&
      /^https?:\/\//i.test(resolvedUrl) &&
      resolvedUrl.includes(resolvedVersion) &&
      integrity !== undefined
    );
  }

  if (basename === "pnpm-lock.yaml") {
    const importerEntry = new RegExp(`^\\s+["']?${escapedName}["']?:\\s*$`);
    const importerIndex = visibleLines.findIndex((line) => importerEntry.test(line.text));
    if (importerIndex < 0) return false;
    const importerBlock = indentedBlock(visibleLines, importerIndex);
    if (!importerBlock.some((line) => line.kind === "added")) return false;
    const importerText = importerBlock.map((line) => line.text).join("\n");
    const specifier = /^\s*specifier:\s*["']?([^\s"']+)/m.exec(importerText)?.[1];
    const resolvedVersion = /^\s*version:\s*["']?([^\s"']+)/m.exec(importerText)?.[1];
    if (
      specifier === undefined ||
      specifier !== dependency.value ||
      resolvedVersion === undefined ||
      !versionSatisfiesVisibleSpec(dependency.value, resolvedVersion)
    ) {
      return false;
    }

    const packageEntry = new RegExp(
      `^\\s*["']?/?${escapedName}@${resolvedVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\([^)]*\\))?["']?:\\s*$`
    );
    const packageIndex = visibleLines.findIndex((line) => packageEntry.test(line.text));
    if (packageIndex < 0) return false;
    const packageBlock = indentedBlock(visibleLines, packageIndex);
    if (!packageBlock.some((line) => line.kind === "added")) return false;
    const packageText = packageBlock.map((line) => line.text).join("\n");
    return (
      /integrity:\s*sha(?:256|512)-[A-Za-z0-9+/=_-]+/i.test(packageText)
    );
  }

  if (basename === "yarn.lock") {
    const header = new RegExp(`^["']?${escapedName}@[^:]+["']?:\\s*$`, "m");
    const headerIndex = visibleLines.findIndex((line) => header.test(line.text));
    if (headerIndex < 0) return false;
    const blockLines = indentedBlock(visibleLines, headerIndex);
    if (!blockLines.some((line) => line.kind === "added")) return false;
    const block = blockLines.map((line) => line.text).join("\n");
    const resolvedVersion = /^\s*version:?\s*["']?([^\s"']+)/m.exec(block)?.[1];
    const resolved =
      /^\s*resolved\s+["'](https?:\/\/[^"']+)["']/m.exec(block)?.[1] ??
      /^\s*resolution:\s*["']?([^\s"']+)/m.exec(block)?.[1];
    return (
      resolvedVersion !== undefined &&
      versionSatisfiesVisibleSpec(dependency.value, resolvedVersion) &&
      resolved !== undefined &&
      resolved.includes(resolvedVersion) &&
      /(?:integrity\s+sha(?:256|512)-[A-Za-z0-9+/=_-]+|checksum:\s*[A-Za-z0-9/+=_-]+)/im.test(block)
    );
  }

  if (basename === "bun.lock") {
    const entryPattern = new RegExp(
      `"${escapedName}"\\s*:\\s*\\[\\s*"${escapedName}@(\\d+(?:\\.\\d+){1,2}[^"]*)"`
    );
    const entryIndex = visibleLines.findIndex((line) => entryPattern.test(line.text));
    if (entryIndex < 0) return false;
    const blockLines = jsonArrayBlock(visibleLines, entryIndex);
    if (!blockLines || !blockLines.some((line) => line.kind === "added")) return false;
    const block = blockLines.map((line) => line.text).join("\n");
    const entry = entryPattern.exec(block);
    return (
      entry !== null &&
      versionSatisfiesVisibleSpec(dependency.value, entry[1]) &&
      /sha(?:256|512)-[A-Za-z0-9+/=_-]+/i.test(block)
    );
  }

  return false;
}

function hasCorrespondingLockfile(
  packageJson: ParsedDiffFile,
  dependency: DependencyAddition,
  locks: ParsedDiffFile[],
  manager: PackageManager | "ambiguous" | undefined
): boolean {
  const packageDir = path.dirname(packageJson.file);
  if (manager === "ambiguous") return false;
  return locks.some((lockfile) => {
    const lockDir = path.dirname(lockfile.file);
    const coversPackage = lockDir === packageDir || isAncestorOrSame(lockDir, packageDir);
    const lockManager = lockfileManager(lockfile.file);
    const managerMatches = manager ? lockManager === manager : lockfile.newFile !== true;
    return coversPackage && managerMatches && lockfileHasResolvedDependency(lockfile, dependency);
  });
}

function dependencyAdditions(file: ParsedDiffFile): DependencyAddition[] {
  if (path.basename(file.file) !== "package.json") return [];

  const additions: DependencyAddition[] = [];
  let section: string | undefined;
  let depth = 0;

  for (let index = 0; index < file.lines.length; index += 1) {
    const line = file.lines[index];
    if (line.kind === "removed") continue;

    const property = jsonPropertyName(line.text);
    if (property) {
      const propertyDepth = countChar(line.text, "{") - countChar(line.text, "}");
      if (propertyDepth > 0) {
        section = property;
        depth = propertyDepth;
        continue;
      }
    }

    if (!section) {
      const entry = line.kind === "added" ? dependencyEntry(line.text) : undefined;
      if (entry && looksLikeDependencySpec(entry.value) && hasNearbyDependencyEntry(file.lines, index)) {
        additions.push({
          name: entry.name,
          value: entry.value,
          section: "dependency block",
          file: file.file,
          line: line.line
        });
      }
      continue;
    }

    if (line.kind === "added" && DEPENDENCY_SECTIONS.has(section)) {
      const entry = dependencyEntry(line.text);
      if (entry) {
        additions.push({
          name: entry.name,
          value: entry.value,
          section,
          file: file.file,
          line: line.line
        });
      }
    }

    depth += countChar(line.text, "{") - countChar(line.text, "}");
    if (depth <= 0) {
      section = undefined;
      depth = 0;
    }
  }

  return additions;
}

function isWorkflowFile(file: string): boolean {
  return WORKFLOW_RE.test(file);
}

function actionRef(text: string): { name: string; spec: string; ref: string } | undefined {
  const match = /^\s*(?:-\s*)?uses:\s*["']?([^"'\s#]+)["']?/.exec(text);
  if (!match) return undefined;

  const spec = match[1];
  if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("docker://")) return undefined;
  if (spec.includes("${{")) return undefined;

  const at = spec.lastIndexOf("@");
  if (at <= 0 || at === spec.length - 1) return undefined;

  return { name: spec.slice(0, at), spec, ref: spec.slice(at + 1) };
}

function dockerActionImage(text: string): string | undefined {
  const match = /^\s*(?:-\s*)?uses:\s*["']?docker:\/\/([^"'\s#]+)["']?/.exec(text);
  return match?.[1];
}

function dockerFromImage(text: string): string | undefined {
  const parts = text.trim().split(/\s+/);
  if (parts[0]?.toUpperCase() !== "FROM") return undefined;

  let index = 1;
  while (parts[index]?.startsWith("--")) index += 1;
  const image = parts[index];
  if (!image || image.toLowerCase() === "scratch") return undefined;
  return image;
}

function imageTag(image: string): string | undefined {
  const withoutDigest = image.split("@")[0];
  const lastSegment = withoutDigest.split("/").at(-1) ?? withoutDigest;
  const tagIndex = lastSegment.lastIndexOf(":");
  return tagIndex >= 0 ? lastSegment.slice(tagIndex + 1) : undefined;
}

function isDockerfile(file: string): boolean {
  return /(^|\/)(Dockerfile(?:\.[^/]*)?|[^/]+\.Dockerfile)$/.test(file);
}

function isSupplyChainRelevantFile(file: string): boolean {
  return path.basename(file) === "package.json" || isWorkflowFile(file) || isDockerfile(file);
}

interface WorkflowJobScope {
  inheritedLines: ParsedDiffLine[];
  lines: ParsedDiffLine[];
}

function indentation(text: string): number {
  return /^\s*/.exec(text)?.[0].length ?? 0;
}

function workflowJobScopes(file: ParsedDiffFile): WorkflowJobScope[] {
  const visible = file.lines.filter((line) => line.kind !== "removed");
  const jobsIndex = visible.findIndex((line) => /^\s*jobs:\s*(?:#.*)?$/.test(line.text));
  if (jobsIndex < 0) return [{ inheritedLines: [], lines: visible }];

  const jobsIndent = indentation(visible[jobsIndex].text);
  const headerCandidates = visible
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line, index }) =>
        index > jobsIndex &&
        indentation(line.text) > jobsIndent &&
        /^\s*[A-Za-z0-9_.-]+:\s*(?:#.*)?$/.test(line.text)
    );
  const jobIndent = Math.min(...headerCandidates.map(({ line }) => indentation(line.text)));
  if (!Number.isFinite(jobIndent)) return [{ inheritedLines: [], lines: visible }];

  const jobHeaders = headerCandidates.filter(({ line }) => indentation(line.text) === jobIndent);
  if (jobHeaders.length === 0) return [{ inheritedLines: [], lines: visible }];

  const inheritedLines = visible.slice(0, jobsIndex);
  return jobHeaders.map(({ index }, position) => ({
    inheritedLines,
    lines: visible.slice(index, jobHeaders[position + 1]?.index ?? visible.length)
  }));
}

function packagePublishScriptFindings(file: ParsedDiffFile, config?: QuorateConfig): Finding[] {
  if (path.basename(file.file) !== "package.json") return [];
  if (!ruleEnabled(config, "npmPublishWithoutProvenance")) return [];
  if (!ecosystemEnabled(config, ["npm", "node", "javascript"])) return [];

  const publishLine = file.lines.find(
    (line) =>
      line.kind === "added" &&
      PACKAGE_PUBLISH_RE.test(line.text) &&
      !NPM_PROVENANCE_RE.test(line.text)
  );
  if (!publishLine) return [];

  return [
    {
      providerId: PROVIDER_ID,
      role: ROLE,
      severity: ruleSeverity(config, "npmPublishWithoutProvenance", "medium"),
      title: "npm publish script lacks provenance context",
      body:
        "This package.json change adds a publish command without explicit provenance. An unchanged workflow can invoke the script outside the visible diff, so SupplyChainGate cannot prove an attributable release path.",
      file: file.file,
      line: publishLine.line,
      suggestion:
        "Add --provenance to the publish command and ensure the trusted workflow grants id-token: write."
    }
  ];
}

function npmPublishFindings(file: ParsedDiffFile, config?: QuorateConfig): Finding[] {
  if (!ruleEnabled(config, "npmPublishWithoutProvenance")) return [];
  if (!ecosystemEnabled(config, ["npm", "node", "javascript", "github-actions", "actions"])) return [];
  if (!isWorkflowFile(file.file)) return [];

  const removedHardening = file.lines.find(
    (line) =>
      line.kind === "removed" &&
      (ID_TOKEN_WRITE_RE.test(line.text) || NPM_PROVENANCE_RE.test(line.text))
  );
  if (removedHardening) {
    return [
      {
        providerId: PROVIDER_ID,
        role: ROLE,
        severity: ruleSeverity(config, "npmPublishWithoutProvenance", "medium"),
        title: "npm provenance hardening was removed",
        body:
          "This workflow removes an id-token: write permission or an enabled npm provenance setting. " +
          "Because the publish job may be outside the diff hunk, SupplyChainGate cannot prove that releases remain attributable.",
        file: file.file,
        line: removedHardening.line,
        suggestion:
          "Keep OIDC/provenance hardening, or provide a complete workflow change that proves the replacement publishing path."
      }
    ];
  }

  const visibleText = file.lines
    .filter((line) => line.kind !== "removed")
    .map((line) => line.text)
    .join("\n");
  const addedToken = file.lines.find(
    (line) => line.kind === "added" && PACKAGE_AUTH_RE.test(line.text)
  );
  const visibleHardening =
    ID_TOKEN_WRITE_RE.test(visibleText) && NPM_PROVENANCE_RE.test(visibleText);
  if (
    addedToken &&
    file.newFile !== true &&
    !PACKAGE_PUBLISH_RE.test(visibleText) &&
    !visibleHardening
  ) {
    return [
      {
        providerId: PROVIDER_ID,
        role: ROLE,
        severity: ruleSeverity(config, "npmPublishWithoutProvenance", "medium"),
        title: "npm token added without visible provenance context",
        body:
          "This partial workflow diff adds an npm authentication token, but the publish step and its " +
          "provenance controls are not visible. SupplyChainGate cannot prove that the token is limited to non-publishing use.",
        file: file.file,
        line: addedToken.line,
        suggestion:
          "Keep tokenless trusted publishing, or include id-token: write and explicit provenance in the publishing job."
      }
    ];
  }

  const findings: Finding[] = [];
  for (const scope of workflowJobScopes(file)) {
    const inheritedText = scope.inheritedLines.map((line) => line.text).join("\n");
    const jobText = scope.lines.map((line) => line.text).join("\n");
    const visibleText = `${inheritedText}\n${jobText}`;
    const addedLines = [...scope.inheritedLines, ...scope.lines].filter(
      (line) => line.kind === "added"
    );

    const usesToken = PACKAGE_AUTH_RE.test(visibleText);
    const publishesNpm = PACKAGE_PUBLISH_RE.test(jobText) || INDIRECT_PUBLISH_RE.test(jobText);
    const touchedPublishAuth = addedLines.some(
      (line) =>
        PACKAGE_AUTH_RE.test(line.text) ||
        PACKAGE_PUBLISH_RE.test(line.text) ||
        INDIRECT_PUBLISH_RE.test(line.text)
    );
    const provenanceEnabled = NPM_PROVENANCE_RE.test(visibleText);
    const idTokenEnabled = ID_TOKEN_WRITE_RE.test(visibleText);
    const hardeningProven =
      (provenanceEnabled && idTokenEnabled) ||
      (file.newFile === true && !usesToken && idTokenEnabled);

    const addedJobToken = scope.lines.find(
      (line) => line.kind === "added" && PACKAGE_AUTH_RE.test(line.text)
    );
    if (addedJobToken && file.newFile !== true && !publishesNpm) {
      findings.push({
        providerId: PROVIDER_ID,
        role: ROLE,
        severity: ruleSeverity(config, "npmPublishWithoutProvenance", "medium"),
        title: "npm token added without visible provenance context",
        body:
          "This workflow job adds npm authentication, but no publish step and provenance controls are visible in the same job. SupplyChainGate does not borrow hardening from another job.",
        file: file.file,
        line: addedJobToken.line,
        suggestion:
          "Keep tokenless trusted publishing, or show the publishing command, id-token: write, and explicit provenance in this job."
      });
      continue;
    }

    if (!publishesNpm || !touchedPublishAuth || hardeningProven) {
      continue;
    }

    const anchor =
      scope.lines.find(
        (line) =>
          line.kind === "added" &&
          (PACKAGE_PUBLISH_RE.test(line.text) || INDIRECT_PUBLISH_RE.test(line.text))
      ) ??
      scope.lines.find(
        (line) => line.kind === "added" && PACKAGE_AUTH_RE.test(line.text)
      ) ??
      addedLines[0];

    findings.push({
      providerId: PROVIDER_ID,
      role: ROLE,
      severity: ruleSeverity(config, "npmPublishWithoutProvenance", "medium"),
      title: "npm publish workflow lacks provenance hardening",
      body:
        "This changed workflow job publishes to npm, but the visible job context does not prove a safe " +
        (usesToken
          ? "token-based path with both id-token: write and npm provenance. "
          : "complete tokenless trusted-publishing path. ") +
        "SupplyChainGate fails closed when the required context is outside the diff hunk.",
      file: file.file,
      line: anchor?.line,
      suggestion:
        "Use trusted publishing with id-token: write, or grant id-token: write and enable provenance for token-based publishing."
    });
  }

  return findings;
}

function pushFinding(findings: Finding[], finding: Finding, seen: Set<string>): void {
  const key = `${finding.title}:${finding.file ?? ""}:${finding.line ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(finding);
}

export function supplyChainReviewEnabled(request: CouncilRequest, config?: QuorateConfig): boolean {
  if (config && config.supplyChain?.enabled !== true) return false;
  const diff = request.fullDiff ?? request.diff;
  if (request.mode !== "review" || !diff?.trim()) return false;
  return (
    INCOMPLETE_DIFF_MARKER_RE.test(diff) ||
    parseDiff(diff).some((file) => isSupplyChainRelevantFile(file.file))
  );
}

export function runSupplyChainReview(request: CouncilRequest, config?: QuorateConfig): ProviderResult | undefined {
  if (!supplyChainReviewEnabled(request, config)) return undefined;

  const startedAt = Date.now();
  const diff = request.fullDiff ?? request.diff ?? "";
  const files = parseDiff(diff);
  const locks = changedNpmLockfiles(files);
  const repositoryFiles = new Set(
    (request.repositoryFiles ?? []).map((file) => file.replaceAll("\\", "/").replace(/^\.\//, ""))
  );
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const npmEnabled = ecosystemEnabled(config, ["npm", "node", "javascript"]);
  const actionsEnabled = ecosystemEnabled(config, ["github-actions", "actions"]);
  const dockerEnabled = ecosystemEnabled(config, ["docker", "container", "containers"]);

  const incompleteFile = files.find((file) => file.incomplete);
  if (INCOMPLETE_DIFF_MARKER_RE.test(diff) || incompleteFile) {
    pushFinding(
      findings,
      {
        providerId: PROVIDER_ID,
        role: ROLE,
        severity: "high",
        title: "Supply-chain scan evidence is incomplete",
        body:
          "The supplied diff omitted or truncated file content, so SupplyChainGate cannot prove that all " +
          "dependency, workflow, and container changes were inspected.",
        ...(incompleteFile ? { file: incompleteFile.file } : {}),
        suggestion:
          "Provide a complete diff. In GitHub Actions, reduce the PR size or ensure changed files expose textual patches before merging."
      },
      seen
    );
  }

  for (const file of files) {
    for (const finding of packagePublishScriptFindings(file, config)) {
      pushFinding(findings, finding, seen);
    }

    const addedDependencies =
      npmEnabled &&
      lockfileRequiredFor(config, ["npm", "node", "javascript"]) &&
      ruleEnabled(config, "dependencyWithoutLockfile")
        ? dependencyAdditions(file).filter(
            (dependency) => !allowlisted(config?.supplyChain?.allowlist?.packages, [dependency.name])
          )
        : [];
    const manager =
      addedDependencies.length > 0
        ? expectedPackageManager(file, files, repositoryFiles)
        : undefined;
    const missingLockfileEvidence = addedDependencies.filter(
      (dependency) =>
        !hasCorrespondingLockfile(file, dependency, locks, manager)
    );
    if (missingLockfileEvidence.length > 0) {
      const first = missingLockfileEvidence[0];
      const names = missingLockfileEvidence
        .map((dependency) => `${dependency.name} (${dependency.section})`)
        .join(", ");
      pushFinding(
        findings,
        {
          providerId: PROVIDER_ID,
          role: ROLE,
          severity: dependencyMissingLockfileSeverity(config),
          title: "Dependency added without lockfile update",
          body:
            `${names} added in ${file.file}, but this diff does not change a corresponding package lockfile. ` +
            "Reviewers cannot verify the resolved transitive dependency graph from the PR alone.",
          file: file.file,
          line: first.line,
          suggestion:
            "Commit the package-lock.json, npm-shrinkwrap.json, yarn.lock, or pnpm-lock.yaml update generated by the package manager."
        },
        seen
      );
    }

    for (const line of file.lines) {
      if (line.kind !== "added") continue;

      if (actionsEnabled && ruleEnabled(config, "unpinnedActions") && isWorkflowFile(file.file)) {
        const containerImage = dockerActionImage(line.text);
        if (
          containerImage &&
          !FULL_SHA256_DIGEST_RE.test(containerImage) &&
          !allowlisted(config?.supplyChain?.allowlist?.images, [
            containerImage,
            containerImage.split("@")[0]
          ])
        ) {
          pushFinding(
            findings,
            {
              providerId: PROVIDER_ID,
              role: ROLE,
              severity: ruleSeverity(config, "unpinnedActions", "medium"),
              title: "Container action is not pinned by digest",
              body:
                `${containerImage} is a mutable container action reference. The workflow may execute ` +
                "different image content than the content reviewed in this PR.",
              file: file.file,
              line: line.line,
              suggestion: "Use docker://image@sha256:<digest> for reproducible container actions."
            },
            seen
          );
        }

        const ref = actionRef(line.text);
        if (
          ref &&
          !FULL_SHA_RE.test(ref.ref) &&
          !allowlisted(config?.supplyChain?.allowlist?.actions, [ref.spec, ref.name])
        ) {
          pushFinding(
            findings,
            {
              providerId: PROVIDER_ID,
              role: ROLE,
              severity: ruleSeverity(config, "unpinnedActions", "medium"),
              title: "Action not pinned to a commit SHA",
              body:
                `${ref.spec} uses a mutable action ref. Tags and branches can be moved by the upstream ` +
                "repository, so the workflow may execute code that was not reviewed in this PR.",
              file: file.file,
              line: line.line,
              suggestion: "Pin third-party GitHub Actions to a full 40-character commit SHA."
            },
            seen
          );
        }
      }

      if (dockerEnabled && ruleEnabled(config, "mutableBaseImage") && isDockerfile(file.file)) {
        const image = dockerFromImage(line.text);
        if (
          image &&
          !FULL_SHA256_DIGEST_RE.test(image) &&
          !allowlisted(config?.supplyChain?.allowlist?.images, [image, image.split("@")[0]])
        ) {
          const tag = imageTag(image);
          pushFinding(
            findings,
            {
              providerId: PROVIDER_ID,
              role: ROLE,
              severity: ruleSeverity(config, "mutableBaseImage", "medium"),
              title: "Docker base image is not pinned by digest",
              body:
                image.includes("$")
                  ? `${image} is resolved from a build argument, so this diff does not prove an immutable base-image digest.`
                  : tag === "latest" || !tag
                  ? `${image} resolves through a mutable Docker tag. Builds may pull a different base image than the one reviewed.`
                  : `${image} is pinned only by tag, not by digest. Tags can be repointed after this PR is reviewed.`,
              file: file.file,
              line: line.line,
              suggestion: "Use FROM image@sha256:<digest> for reproducible Docker builds."
            },
            seen
          );
        }
      }
    }

    for (const npmPublish of npmPublishFindings(file, config)) {
      pushFinding(findings, npmPublish, seen);
    }
  }

  return {
    providerId: PROVIDER_ID,
    role: ROLE,
    providerType: "mock",
    status: "ok",
    summary: `SupplyChainGate produced ${findings.length} finding${findings.length === 1 ? "" : "s"}.`,
    findings,
    durationMs: Date.now() - startedAt
  };
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    const severityDelta = SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity];
    if (severityDelta !== 0) return severityDelta;
    return left.title.localeCompare(right.title);
  });
}

function supplyChainVerdict(findings: Finding[], providerResult: ProviderResult): Verdict {
  if (providerResult.status === "error") return "warn";
  if (
    findings.some(
      (finding) =>
        finding.status !== "suppressed" && SEVERITY_WEIGHT[finding.severity] >= SEVERITY_WEIGHT.high
    )
  ) {
    return "fail";
  }
  return findings.some((finding) => finding.status !== "suppressed") ? "warn" : "pass";
}

export function buildSupplyChainReport(
  request: CouncilRequest,
  config?: QuorateConfig
): CouncilReport {
  const scanConfig: QuorateConfig | undefined = config
    ? {
        ...config,
        supplyChain: {
          ...config.supplyChain,
          enabled: true
        }
      }
    : undefined;
  const providerResult =
    runSupplyChainReview(request, scanConfig) ??
    ({
      providerId: PROVIDER_ID,
      role: ROLE,
      providerType: "mock",
      status: "ok",
      summary: "SupplyChainGate found no supply-chain relevant changes.",
      findings: [],
      durationMs: 0
    } satisfies ProviderResult);
  const findings = sortFindings(providerResult.findings).map((finding) => ({
    ...finding,
    fingerprint: fingerprintFinding(finding)
  }));
  const verdict = supplyChainVerdict(findings, providerResult);
  const issueCount = findings.length;

  return {
    verdict,
    summary:
      issueCount > 0
        ? `SupplyChainGate found ${issueCount} finding${issueCount === 1 ? "" : "s"}.`
        : "SupplyChainGate found no findings.",
    findings,
    providerResults: [{ ...providerResult, findings }],
    metadata: {
      generatedAt: new Date().toISOString(),
      mode: request.mode,
      subject: request.subject,
      providers: [`${PROVIDER_ID}:${ROLE}`],
      requestedProviders: [`${PROVIDER_ID}:${ROLE}`],
      ranProviders: [`${PROVIDER_ID}:${ROLE}`],
      degraded: false,
      reviewId: computeReviewId({
        mode: request.mode,
        subject: request.subject,
        diff: request.fullDiff ?? request.diff,
        providerIds: [PROVIDER_ID],
        councils: [ROLE]
      })
    }
  };
}
