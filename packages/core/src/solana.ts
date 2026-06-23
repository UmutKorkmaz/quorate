import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import YAML from "yaml";
import { findConfigPath, loadConfig } from "./config.js";
import { PACKS } from "./packs.js";
import type { QuorateConfig } from "./types.js";

export type SolanaGateStatus = "pass" | "warn" | "fail";

export interface SolanaProgramId {
  cluster: string;
  programId: string;
  valid: boolean;
}

export interface SolanaIdlInfo {
  path: string;
  name: string;
  address?: string;
  parseError?: string;
}

export interface SolanaProgramInfo {
  name: string;
  programIds: SolanaProgramId[];
  cargoManifests: string[];
  idl?: SolanaIdlInfo;
  idlMatchesProgramId?: boolean;
  deployArtifacts: string[];
}

export interface SolanaReleaseCheck {
  id: string;
  title: string;
  status: SolanaGateStatus;
  detail: string;
  evidence?: string[];
  nextStep?: string;
}

export interface SolanaReleaseGate {
  cwd: string;
  generatedAt: string;
  anchorToml?: string;
  cargoTomls: string[];
  idlFiles: SolanaIdlInfo[];
  provider: {
    cluster?: string;
    wallet?: string;
  };
  quorate: {
    configPath?: string;
    hasSolanaPack: boolean;
  };
  programs: SolanaProgramInfo[];
  evidence: {
    upgradeAuthority: string[];
    verifiableBuild: string[];
  };
  checks: SolanaReleaseCheck[];
  summary: {
    gate: SolanaGateStatus;
    pass: number;
    warn: number;
    fail: number;
  };
}

export interface SolanaTestPlanItem {
  id: string;
  title: string;
  kind: "required" | "recommended" | "manual";
  command: string;
  reason: string;
}

export interface SolanaTestPlan {
  cwd: string;
  generatedAt: string;
  gate: SolanaGateStatus;
  items: SolanaTestPlanItem[];
}

export interface BuildSolanaReleaseGateOptions {
  cwd?: string;
  config?: QuorateConfig;
  configPath?: string;
  now?: Date;
}

interface TomlDoc {
  sections: Map<string, Record<string, string>>;
}

interface AnchorManifest {
  programs: SolanaProgramId[];
  provider: {
    cluster?: string;
    wallet?: string;
  };
  scripts: Record<string, string>;
}

interface CargoManifest {
  path: string;
  packageName?: string;
}

const BASE58_PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SKIP_DIRS = new Set(["node_modules", ".git", ".quorate/sessions"]);
const SOLANA_COUNCILS = new Set(PACKS.solana.councils.filter((council) => council !== "maintainer"));
const CLUSTER_ALIASES: Record<string, string[]> = {
  localnet: ["localnet"],
  devnet: ["devnet"],
  testnet: ["testnet"],
  mainnet: ["mainnet", "mainnet-beta"],
  "mainnet-beta": ["mainnet", "mainnet-beta"]
};

function rel(cwd: string, path: string): string {
  return relative(cwd, path) || ".";
}

function normalizeProgramName(name: string): string {
  return name.replace(/\.json$/i, "").replace(/-keypair$/i, "").replace(/-/g, "_");
}

function isLikelySolanaPublicKey(value: string): boolean {
  return BASE58_PUBLIC_KEY.test(value);
}

function providerClusterAliases(cluster?: string): string[] | undefined {
  if (!cluster) return undefined;
  const key = cluster.trim().toLowerCase();
  return CLUSTER_ALIASES[key];
}

function programIdMatchesProviderCluster(entry: SolanaProgramId, clusterAliases?: string[]): boolean {
  if (!clusterAliases) return true;
  return clusterAliases.includes(entry.cluster.toLowerCase());
}

function stripTomlComment(line: string): string {
  let quote: "\"" | "'" | undefined;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if ((char === "\"" || char === "'") && line[i - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
      continue;
    }
    if (char === "#" && !quote) return line.slice(0, i);
  }
  return line;
}

function parseTomlValue(value: string): string {
  const trimmed = value.trim().replace(/,$/, "");
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseTomlLite(source: string): TomlDoc {
  const sections = new Map<string, Record<string, string>>();
  let section = "";
  sections.set(section, {});

  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1]?.trim() ?? "";
      if (!sections.has(section)) sections.set(section, {});
      continue;
    }

    const pairMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!pairMatch) continue;
    sections.get(section)![pairMatch[1]!] = parseTomlValue(pairMatch[2]!);
  }

  return { sections };
}

function parseAnchorManifest(path: string): AnchorManifest {
  const doc = parseTomlLite(readFileSync(path, "utf8"));
  const programs: SolanaProgramId[] = [];
  const providerSection = doc.sections.get("provider") ?? {};
  const scripts = doc.sections.get("scripts") ?? {};

  for (const [section, values] of doc.sections) {
    if (!section.startsWith("programs.")) continue;
    const cluster = section.slice("programs.".length);
    for (const [name, programId] of Object.entries(values)) {
      programs.push({
        cluster,
        programId,
        valid: isLikelySolanaPublicKey(programId)
      });
    }
  }

  return {
    programs,
    provider: {
      cluster: providerSection.cluster,
      wallet: providerSection.wallet
    },
    scripts
  };
}

function parseCargoManifest(path: string): CargoManifest {
  const doc = parseTomlLite(readFileSync(path, "utf8"));
  const pkg = doc.sections.get("package") ?? {};
  return { path, packageName: pkg.name };
}

function collectCargoTomls(cwd: string): CargoManifest[] {
  const manifests: CargoManifest[] = [];
  const root = resolve(cwd, "Cargo.toml");
  if (existsSync(root)) manifests.push(parseCargoManifest(root));

  const programsDir = resolve(cwd, "programs");
  if (!existsSync(programsDir)) return manifests;

  const visit = (dir: string, depth: number): void => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(full, depth + 1);
      } else if (entry.isFile() && entry.name === "Cargo.toml" && full !== root) {
        manifests.push(parseCargoManifest(full));
      }
    }
  };

  visit(programsDir, 0);
  return manifests;
}

function parseIdlFile(path: string): SolanaIdlInfo {
  const name = normalizeProgramName(basename(path, ".json"));
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      address?: unknown;
      metadata?: { address?: unknown };
    };
    const address =
      typeof parsed.address === "string"
        ? parsed.address
        : typeof parsed.metadata?.address === "string"
          ? parsed.metadata.address
          : undefined;
    return { path, name, address };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { path, name, parseError: message };
  }
}

function collectIdlFiles(cwd: string): SolanaIdlInfo[] {
  const idlDir = resolve(cwd, "target", "idl");
  if (!existsSync(idlDir)) return [];
  try {
    return readdirSync(idlDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => parseIdlFile(join(idlDir, entry.name)))
      .sort((a, b) => a.path.localeCompare(b.path));
  } catch {
    return [];
  }
}

function collectDeployArtifacts(cwd: string): string[] {
  const deployDir = resolve(cwd, "target", "deploy");
  if (!existsSync(deployDir)) return [];
  try {
    return readdirSync(deployDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(so|json)$/i.test(entry.name))
      .map((entry) => join(deployDir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function collectEvidencePaths(cwd: string): string[] {
  const roots = [resolve(cwd, "target"), resolve(cwd, ".quorate")].filter((path) => existsSync(path));
  const evidence: string[] = [];
  const matches = /(verifiable|attestation|provenance|buildinfo|build-info)/i;

  const visit = (dir: string, depth: number): void => {
    if (depth > 5 || evidence.length >= 100) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const relativePath = rel(cwd, full);
      if (matches.test(relativePath)) evidence.push(full);
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) visit(full, depth + 1);
    }
  };

  for (const root of roots) visit(root, 0);
  return [...new Set(evidence)].sort();
}

function collectPackageScriptEvidence(cwd: string): string[] {
  const packageJson = resolve(cwd, "package.json");
  if (!existsSync(packageJson)) return [];
  try {
    const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as { scripts?: Record<string, unknown> };
    return Object.entries(parsed.scripts ?? {})
      .filter(([, value]) => typeof value === "string" && /(upgrade-authority|set-upgrade-authority|program show|anchor upgrade)/i.test(value))
      .map(([name, value]) => `package.json script ${name}: ${value as string}`);
  } catch {
    return [];
  }
}

function loadOptionalSolanaEvidence(cwd: string): { upgradeAuthority: string[]; verifiableBuild: string[] } {
  const paths = [
    resolve(cwd, ".quorate", "solana-release.json"),
    resolve(cwd, ".quorate", "solana-release.yml"),
    resolve(cwd, ".quorate", "solana-release.yaml")
  ].filter((path) => existsSync(path));
  const upgradeAuthority: string[] = [];
  const verifiableBuild: string[] = [];

  for (const path of paths) {
    try {
      const text = readFileSync(path, "utf8");
      const parsed = path.endsWith(".json") ? JSON.parse(text) : YAML.parse(text);
      if (typeof parsed?.upgradeAuthority === "string") {
        upgradeAuthority.push(`${rel(cwd, path)}: ${parsed.upgradeAuthority}`);
      }
      if (typeof parsed?.verifiableBuild === "string") {
        verifiableBuild.push(`${rel(cwd, path)}: ${parsed.verifiableBuild}`);
      }
      if (Array.isArray(parsed?.evidence)) {
        for (const item of parsed.evidence) {
          if (typeof item === "string" && /upgrade|authority/i.test(item)) {
            upgradeAuthority.push(`${rel(cwd, path)}: ${item}`);
          }
          if (typeof item === "string" && /verifiable|attestation|provenance/i.test(item)) {
            verifiableBuild.push(`${rel(cwd, path)}: ${item}`);
          }
        }
      }
    } catch {
      // Evidence files are advisory; malformed files are covered by missing evidence warnings.
    }
  }

  return { upgradeAuthority, verifiableBuild };
}

function hasSolanaPack(config?: QuorateConfig): boolean {
  if (!config) return false;
  if (config.councils.some((council) => SOLANA_COUNCILS.has(council))) return true;
  return Object.keys(config.roleGuidance ?? {}).some((role) => SOLANA_COUNCILS.has(role));
}

function statusSummary(checks: SolanaReleaseCheck[]): SolanaReleaseGate["summary"] {
  const pass = checks.filter((check) => check.status === "pass").length;
  const warn = checks.filter((check) => check.status === "warn").length;
  const fail = checks.filter((check) => check.status === "fail").length;
  return {
    gate: fail > 0 ? "fail" : warn > 0 ? "warn" : "pass",
    pass,
    warn,
    fail
  };
}

function check(
  checks: SolanaReleaseCheck[],
  status: SolanaGateStatus,
  id: string,
  title: string,
  detail: string,
  options: Pick<SolanaReleaseCheck, "evidence" | "nextStep"> = {}
): void {
  checks.push({ id, title, status, detail, ...options });
}

export function buildSolanaReleaseGate(options: BuildSolanaReleaseGateOptions = {}): SolanaReleaseGate {
  const cwd = resolve(options.cwd ?? process.cwd());
  const generatedAt = (options.now ?? new Date()).toISOString();
  const anchorToml = resolve(cwd, "Anchor.toml");
  const anchorManifest = existsSync(anchorToml) ? parseAnchorManifest(anchorToml) : undefined;
  const cargoManifests = collectCargoTomls(cwd);
  const idlFiles = collectIdlFiles(cwd);
  const idlsByName = new Map(idlFiles.map((idl) => [normalizeProgramName(idl.name), idl]));
  const deployArtifacts = collectDeployArtifacts(cwd);
  const configPath = options.configPath ?? findConfigPath(cwd);
  const config = options.config ?? (configPath ? loadConfig(configPath, cwd) : undefined);
  const optionalEvidence = loadOptionalSolanaEvidence(cwd);
  const verifiableEvidence = [...collectEvidencePaths(cwd), ...optionalEvidence.verifiableBuild];
  const providerCluster = anchorManifest?.provider.cluster;
  const clusterAliases = providerClusterAliases(providerCluster);

  const names = new Map<string, string>();
  const anchorProgramsByName = new Map<string, SolanaProgramId[]>();
  if (anchorManifest) {
    const doc = parseTomlLite(readFileSync(anchorToml, "utf8"));
    for (const [section, values] of doc.sections) {
      if (!section.startsWith("programs.")) continue;
      const cluster = section.slice("programs.".length);
      for (const [rawName, programId] of Object.entries(values)) {
        const normalized = normalizeProgramName(rawName);
        names.set(normalized, rawName);
        const list = anchorProgramsByName.get(normalized) ?? [];
        list.push({ cluster, programId, valid: isLikelySolanaPublicKey(programId) });
        anchorProgramsByName.set(normalized, list);
      }
    }
  }

  const cargoByName = new Map<string, CargoManifest[]>();
  for (const cargo of cargoManifests) {
    if (!cargo.packageName) continue;
    const normalized = normalizeProgramName(cargo.packageName);
    names.set(normalized, cargo.packageName);
    const list = cargoByName.get(normalized) ?? [];
    list.push(cargo);
    cargoByName.set(normalized, list);
  }
  for (const idl of idlFiles) names.set(normalizeProgramName(idl.name), idl.name);

  const programs = [...names.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([normalized, displayName]) => {
    const programIds = anchorProgramsByName.get(normalized) ?? [];
    const comparableProgramIds = programIds.filter((entry) => programIdMatchesProviderCluster(entry, clusterAliases));
    const idl = idlsByName.get(normalized);
    const idlMatchesProgramId =
      idl?.address && comparableProgramIds.length > 0
        ? comparableProgramIds.some((entry) => entry.programId === idl.address)
        : undefined;
    const artifacts = deployArtifacts.filter((artifact) => {
      const file = basename(artifact).replace(/\.so$/i, "").replace(/-keypair\.json$/i, "");
      return normalizeProgramName(file) === normalized;
    });

    return {
      name: displayName,
      programIds,
      cargoManifests: (cargoByName.get(normalized) ?? []).map((cargo) => cargo.path),
      idl,
      idlMatchesProgramId,
      deployArtifacts: artifacts
    };
  });

  const upgradeAuthorityEvidence = [
    ...(anchorManifest?.provider.wallet ? [`Anchor provider.wallet: ${anchorManifest.provider.wallet}`] : []),
    ...Object.entries(anchorManifest?.scripts ?? {})
      .filter(([, value]) => /(upgrade-authority|set-upgrade-authority|program show|anchor upgrade)/i.test(value))
      .map(([name, value]) => `Anchor.toml script ${name}: ${value}`),
    ...collectPackageScriptEvidence(cwd),
    ...optionalEvidence.upgradeAuthority
  ];

  const checks: SolanaReleaseCheck[] = [];
  check(
    checks,
    anchorManifest ? "pass" : "fail",
    "anchor_manifest",
    "Anchor manifest",
    anchorManifest ? `Found ${rel(cwd, anchorToml)}` : "No Anchor.toml found at the project root.",
    { nextStep: anchorManifest ? undefined : "Run this from the Anchor workspace root or add Anchor.toml." }
  );

  check(
    checks,
    cargoManifests.length > 0 ? "pass" : "fail",
    "cargo_manifest",
    "Cargo manifests",
    cargoManifests.length > 0
      ? `Found ${cargoManifests.length} Cargo.toml file(s).`
      : "No Cargo.toml files found at the root or under programs/.",
    { evidence: cargoManifests.map((manifest) => rel(cwd, manifest.path)) }
  );

  const programIdRows = [...anchorProgramsByName.values()].flat();
  const invalidProgramIds = programIdRows.filter((entry) => !entry.valid);
  const activeClusterProgramIds = programIdRows.filter((entry) => programIdMatchesProviderCluster(entry, clusterAliases));
  if (!anchorManifest || programIdRows.length === 0) {
    check(checks, "fail", "program_ids", "Program IDs", "No [programs.<cluster>] program IDs were found in Anchor.toml.", {
      nextStep: "Run anchor keys list and commit the intended program IDs under [programs.<cluster>]."
    });
  } else if (invalidProgramIds.length > 0) {
    check(
      checks,
      "fail",
      "program_ids",
      "Program IDs",
      `${invalidProgramIds.length} configured program ID(s) do not look like Solana public keys.`,
      { evidence: invalidProgramIds.map((entry) => `${entry.cluster}: ${entry.programId}`) }
    );
  } else if (clusterAliases && activeClusterProgramIds.length === 0) {
    check(
      checks,
      "fail",
      "program_ids",
      "Program IDs",
      `No configured program IDs match provider.cluster "${providerCluster}".`,
      { nextStep: `Add a [programs.${providerCluster}] entry or align provider.cluster with the intended release cluster.` }
    );
  } else {
    const activeDetail =
      clusterAliases && activeClusterProgramIds.length > 0
        ? ` ${activeClusterProgramIds.length} match provider.cluster ${providerCluster}.`
        : "";
    check(checks, "pass", "program_ids", "Program IDs", `Found ${programIdRows.length} configured program ID(s).${activeDetail}`);
  }

  if (!anchorManifest?.provider.cluster) {
    check(checks, "warn", "provider_cluster", "Cluster/provider", "No [provider].cluster value found in Anchor.toml.", {
      nextStep: "Set provider.cluster to localnet, devnet, mainnet, or an explicit RPC URL before release."
    });
  } else if (!anchorManifest.provider.wallet) {
    check(
      checks,
      "warn",
      "provider_cluster",
      "Cluster/provider",
      `Provider cluster is ${anchorManifest.provider.cluster}, but provider.wallet is not set.`,
      { nextStep: "Set provider.wallet or pass the release wallet explicitly in CI." }
    );
  } else {
    check(
      checks,
      "pass",
      "provider_cluster",
      "Cluster/provider",
      `Provider cluster ${anchorManifest.provider.cluster} with wallet ${anchorManifest.provider.wallet}.`
    );
  }

  const parseErrors = idlFiles.filter((idl) => idl.parseError);
  const missingIdls = programs.filter((program) => program.programIds.length > 0 && !program.idl);
  const mismatchedIdls = programs.filter((program) => program.idlMatchesProgramId === false);
  const idlsWithoutAddress = programs.filter((program) => program.idl && !program.idl.address);
  if (idlFiles.length === 0) {
    check(checks, "fail", "idl", "IDL artifacts", "No target/idl/*.json files found.", {
      nextStep: "Run anchor build and commit or publish the generated IDL artifact expected by your release flow."
    });
  } else if (parseErrors.length > 0) {
    check(checks, "fail", "idl", "IDL artifacts", `${parseErrors.length} IDL file(s) could not be parsed as JSON.`, {
      evidence: parseErrors.map((idl) => `${rel(cwd, idl.path)}: ${idl.parseError}`)
    });
  } else if (missingIdls.length > 0) {
    check(checks, "fail", "idl", "IDL artifacts", `${missingIdls.length} configured program(s) have no matching IDL file.`, {
      evidence: missingIdls.map((program) => program.name),
      nextStep: "Run anchor build and confirm target/idl/<program>.json exists for every configured program."
    });
  } else if (mismatchedIdls.length > 0) {
    check(checks, "fail", "idl", "IDL artifacts", `${mismatchedIdls.length} IDL address value(s) do not match Anchor.toml.`, {
      evidence: mismatchedIdls.map((program) => `${program.name}: ${program.idl?.address ?? "(missing address)"}`)
    });
  } else if (idlsWithoutAddress.length > 0) {
    check(checks, "warn", "idl", "IDL artifacts", `${idlsWithoutAddress.length} IDL file(s) have no metadata.address to compare.`, {
      evidence: idlsWithoutAddress.map((program) => rel(cwd, program.idl!.path))
    });
  } else {
    check(checks, "pass", "idl", "IDL artifacts", `Found ${idlFiles.length} parseable IDL file(s).`);
  }

  const hasSolana = hasSolanaPack(config);
  if (!configPath) {
    check(checks, "warn", "quorate_config", "Quorate config", "No .quorate.yml config found.", {
      nextStep: "Run quorate init --pack solana before relying on Quorate as a release gate."
    });
  } else if (!hasSolana) {
    check(checks, "warn", "quorate_config", "Quorate config", `${rel(cwd, configPath)} does not include Solana pack councils.`, {
      nextStep: "Run quorate init --pack solana or add the Solana councils to the existing config."
    });
  } else {
    check(checks, "pass", "quorate_config", "Quorate config", `${rel(cwd, configPath)} includes Solana pack councils.`);
  }

  const explicitUpgradeEvidence = upgradeAuthorityEvidence.filter((line) => /upgrade-authority|set-upgrade-authority|program show|anchor upgrade/i.test(line));
  if (explicitUpgradeEvidence.length > 0) {
    check(checks, "pass", "upgrade_authority", "Upgrade authority", "Found local upgrade-authority verification hints.", {
      evidence: explicitUpgradeEvidence
    });
  } else if (upgradeAuthorityEvidence.length > 0) {
    check(
      checks,
      "warn",
      "upgrade_authority",
      "Upgrade authority",
      "Provider wallet is configured, but on-chain upgrade authority still needs live RPC verification.",
      {
        evidence: upgradeAuthorityEvidence,
        nextStep: "Run solana program show <PROGRAM_ID> --url <cluster> and compare Upgrade Authority."
      }
    );
  } else {
    check(checks, "warn", "upgrade_authority", "Upgrade authority", "No local upgrade-authority evidence found.", {
      nextStep: "Record the intended authority and verify it with solana program show before release."
    });
  }

  if (verifiableEvidence.length > 0) {
    check(checks, "pass", "verifiable_build", "Verifiable build", "Found local verifiable/provenance evidence.", {
      evidence: verifiableEvidence.map((path) => (path.startsWith(cwd) ? rel(cwd, path) : path))
    });
  } else if (deployArtifacts.some((path) => path.endsWith(".so"))) {
    check(checks, "warn", "verifiable_build", "Verifiable build", "SBF artifacts exist, but no verifiable build evidence was found.", {
      evidence: deployArtifacts.filter((path) => path.endsWith(".so")).map((path) => rel(cwd, path)),
      nextStep: "Run anchor build --verifiable and store the provenance/attestation expected by your release process."
    });
  } else {
    check(checks, "warn", "verifiable_build", "Verifiable build", "No target/deploy/*.so or verifiable build evidence found.", {
      nextStep: "Run anchor build --verifiable before release."
    });
  }

  return {
    cwd,
    generatedAt,
    anchorToml: anchorManifest ? anchorToml : undefined,
    cargoTomls: cargoManifests.map((manifest) => manifest.path),
    idlFiles,
    provider: anchorManifest?.provider ?? {},
    quorate: {
      configPath,
      hasSolanaPack: hasSolana
    },
    programs,
    evidence: {
      upgradeAuthority: upgradeAuthorityEvidence,
      verifiableBuild: verifiableEvidence
    },
    checks,
    summary: statusSummary(checks)
  };
}

function firstProgramId(report: SolanaReleaseGate): string | undefined {
  const clusterAliases = providerClusterAliases(report.provider.cluster);
  const ids = report.programs.flatMap((program) => program.programIds).filter((entry) => entry.valid);
  if (clusterAliases) {
    return ids.find((entry) => programIdMatchesProviderCluster(entry, clusterAliases))?.programId;
  }
  return ids[0]?.programId;
}

export function buildSolanaTestPlan(report: SolanaReleaseGate): SolanaTestPlan {
  const items: SolanaTestPlanItem[] = [];
  const programNames = report.programs.map((program) => program.name).filter(Boolean);
  const idlCheck =
    programNames.length > 0
      ? programNames.map((name) => `test -f target/idl/${normalizeProgramName(name)}.json`).join(" && ")
      : "ls target/idl/*.json";
  const programId = firstProgramId(report) ?? "<PROGRAM_ID>";
  const cluster = report.provider.cluster ?? "<cluster>";

  items.push({
    id: "unit-integration",
    title: "Run Anchor tests",
    kind: "required",
    command: "anchor test",
    reason: "Exercises program instructions against a local validator before the release gate is evaluated."
  });

  items.push({
    id: "build-idl",
    title: "Build program and IDL",
    kind: "required",
    command: `anchor build && ${idlCheck}`,
    reason: "Regenerates SBF and IDL artifacts, then proves the expected IDL files exist."
  });

  items.push({
    id: "program-ids",
    title: "Compare program IDs",
    kind: "required",
    command: "anchor keys list",
    reason: "Confirms the keypairs generated by Anchor match the program IDs committed in Anchor.toml."
  });

  items.push({
    id: "verifiable-build",
    title: "Create verifiable build evidence",
    kind: report.summary.gate === "pass" ? "recommended" : "required",
    command: "anchor build --verifiable",
    reason: "Produces reproducible build evidence that can be archived with the release."
  });

  if (!report.quorate.hasSolanaPack) {
    items.push({
      id: "quorate-config",
      title: "Enable the Quorate Solana council",
      kind: "required",
      command: "quorate init --pack solana",
      reason: "Adds Solana-specific reviewers before Quorate is used as a merge/release gate."
    });
  }

  items.push({
    id: "quorate-review",
    title: "Run Solana-focused Quorate review",
    kind: "required",
    command: "quorate review --base main",
    reason: "Runs the configured Solana council on the release diff."
  });

  items.push({
    id: "upgrade-authority",
    title: "Verify upgrade authority",
    kind: "manual",
    command: `solana program show ${programId} --url ${cluster}`,
    reason: "Requires live RPC; compare the Upgrade Authority with the release wallet or intended governance address."
  });

  return {
    cwd: report.cwd,
    generatedAt: report.generatedAt,
    gate: report.summary.gate,
    items
  };
}

export function formatSolanaReleaseGate(report: SolanaReleaseGate): string {
  const lines = [`Solana release gate: ${report.summary.gate.toUpperCase()}`, ""];
  for (const item of report.checks) {
    lines.push(`[${item.status}] ${item.title}: ${item.detail}`);
    if (item.nextStep) lines.push(`  next: ${item.nextStep}`);
    for (const evidence of item.evidence ?? []) lines.push(`  evidence: ${evidence}`);
  }

  if (report.programs.length > 0) {
    lines.push("", "Programs:");
    for (const program of report.programs) {
      const ids = program.programIds.map((entry) => `${entry.cluster}=${entry.programId}`).join(", ") || "no Anchor.toml id";
      const idl = program.idl ? rel(report.cwd, program.idl.path) : "no IDL";
      lines.push(`  ${program.name}: ${ids}; idl=${idl}`);
    }
  }

  lines.push("", "Next: quorate solana test-plan");
  return lines.join("\n");
}

export function formatSolanaTestPlan(plan: SolanaTestPlan): string {
  const lines = [`Solana test plan: ${plan.gate.toUpperCase()} gate context`, ""];
  for (const [index, item] of plan.items.entries()) {
    lines.push(`${index + 1}. ${item.title} [${item.kind}]`);
    lines.push(`   ${item.command}`);
    lines.push(`   ${item.reason}`);
  }
  return lines.join("\n");
}
