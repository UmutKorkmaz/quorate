import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import type { CouncilRequest } from "@quorate/core";

const PROOF_SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const REVIEW_EVIDENCE_MAX_BYTES = 8 * 1024;

export interface ProofOutput {
  text: string;
  truncated: boolean;
}

export interface WorktreeFingerprint {
  gitHead: string | null;
  worktreeHash: string;
}

export interface ProofArtifact {
  schemaVersion: number;
  name: string;
  command: string[];
  cwd: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  timedOut: boolean;
  fingerprint: WorktreeFingerprint;
  stdout: ProofOutput;
  stderr: ProofOutput;
  /** Optional per-command artifacts for multi-step (suite) proofs; absent on single-command proofs. */
  steps?: ProofArtifact[];
  markdownHash: string;
  artifactHash: string;
  signature: string;
}

export interface RunProofOptions {
  cwd: string;
  name: string;
  command: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface RunProofResult {
  cwd: string;
  exitCode: number;
  artifact: ProofArtifact;
}

export interface ProofVerification {
  ok: boolean;
  reason: "verified" | "missing" | "tampered" | "stale";
  artifact?: ProofArtifact;
  detail?: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function proofHash(artifact: Omit<ProofArtifact, "artifactHash" | "signature">): string {
  return sha256(canonicalJson(artifact));
}

function proofKeyDir(): string {
  return resolve(process.env.QUORATE_PROOF_KEY_DIR ?? join(homedir(), ".quorate", "proofs"));
}

function proofKey(): Buffer {
  const dir = proofKeyDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const dirStat = lstatSync(dir);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) throw new Error("Proof signing key directory is not a real directory.");
  const path = join(dir, "proofs.key");
  try {
    // "wx" (O_EXCL): a pre-planted dangling symlink fails with EEXIST instead
    // of writing the key through it; the verification below then rejects it.
    writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
  } catch (error: unknown) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Proof signing key is not a regular file.");
  if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600) throw new Error("Proof signing key must be owner-readable only (0600).");
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error("Proof signing key must be exactly 32 bytes.");
  return key;
}

function signatureFor(artifact: Omit<ProofArtifact, "signature">, key: Buffer): string {
  return createHmac("sha256", key).update(canonicalJson(artifact)).digest("hex");
}

function signaturesMatch(left: string, right: string): boolean {
  return /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right) && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function isSafeProofName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name);
}

function gitText(cwd: string, args: string[]): string | undefined {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, maxBuffer: 2 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : undefined;
}

function fallbackFingerprint(root: string): WorktreeFingerprint {
  const files: Array<{ path: string; hash: string }> = [];
  const collect = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if ([".git", ".quorate", "node_modules"].includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.isFile()) files.push({ path: relative(root, full), hash: sha256(readFileSync(full)) });
    }
  };
  collect(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { gitHead: null, worktreeHash: sha256(canonicalJson(files)) };
}

/** Content-derived snapshot of HEAD, tracked changes, and untracked files (excluding ignored proof output). */
export function getWorktreeFingerprint(cwd: string): WorktreeFingerprint {
  const root = resolve(cwd);
  const head = gitText(root, ["rev-parse", "HEAD"]);
  const diff = gitText(root, ["diff", "--binary", "--no-ext-diff", "HEAD"]);
  const untracked = gitText(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (head === undefined || diff === undefined || untracked === undefined) return fallbackFingerprint(root);

  // A proof must not make itself stale in repositories that do not yet ignore
  // `.quorate/proofs/`. Other `.quorate` state remains part of the snapshot.
  const untrackedFiles = untracked.split("\0").filter((path) => path && !path.startsWith(".quorate/proofs/")).sort().map((path) => {
    const full = resolve(root, path);
    try {
      const stat = lstatSync(full);
      return stat.isFile() ? { path, hash: sha256(readFileSync(full)) } : { path, hash: "non-regular" };
    } catch {
      return { path, hash: "missing" };
    }
  });
  return {
    gitHead: head.trim(),
    worktreeHash: sha256(canonicalJson({ head: head.trim(), diff, untracked: untrackedFiles }))
  };
}

export function proofPaths(cwd: string): { dir: string; json: string; markdown: string } {
  const dir = resolve(cwd, ".quorate", "proofs");
  return { dir, json: join(dir, "latest.json"), markdown: join(dir, "latest.md") };
}

function secureProofPaths(cwd: string, create: boolean): { dir: string; json: string; markdown: string } {
  const root = realpathSync(resolve(cwd));
  const quorate = join(root, ".quorate");
  const dir = join(quorate, "proofs");
  for (const path of [quorate, dir]) {
    if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
    if (!existsSync(path)) continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Refusing proof path that is not a real directory: ${relative(root, path) || "."}.`);
    }
  }
  if (existsSync(dir)) {
    const realDir = realpathSync(dir);
    if (realDir !== root && !realDir.startsWith(`${root}${sep}`)) {
      throw new Error("Refusing proof directory outside the workspace.");
    }
  }
  return { dir, json: join(dir, "latest.json"), markdown: join(dir, "latest.md") };
}

export function redactProofText(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{4,}\b/g, "[REDACTED]")
    .replace(/\b(?:ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/\b(bearer|token)\s+[A-Za-z0-9._~+\/-]{8,}\b/gi, "$1 [REDACTED]")
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:token|secret|password|api[_-]?key)[A-Za-z0-9_]*)\s*([=:])\s*([^\s'"`]+)/gi, "$1$2[REDACTED]");
}

function redactProofCommand(command: string[]): string[] {
  const secretFlag = /^--?(?:api[-_]?key|token|secret|password|authorization|auth|credential)(?:=|$)/i;
  return command.map((part, index) => {
    if (index > 0 && secretFlag.test(command[index - 1])) return "[REDACTED]";
    return redactProofText(part).replace(secretFlag, (flag) => flag.endsWith("=") ? `${flag}[REDACTED]` : flag);
  });
}

interface BoundedCapture {
  chunks: Buffer[];
  bytes: number;
  truncated: boolean;
}

function appendBounded(capture: BoundedCapture, chunk: Buffer, maxBytes: number): void {
  const remaining = maxBytes - capture.bytes;
  if (remaining <= 0) {
    capture.truncated = true;
    return;
  }
  if (chunk.length > remaining) {
    capture.chunks.push(Buffer.from(chunk.subarray(0, remaining)));
    capture.bytes += remaining;
    capture.truncated = true;
    return;
  }
  capture.chunks.push(Buffer.from(chunk));
  capture.bytes += chunk.length;
}

function boundedText(capture: BoundedCapture): ProofOutput {
  return { text: redactProofText(Buffer.concat(capture.chunks).toString("utf8")), truncated: capture.truncated };
}

function renderMarkdown(artifact: Omit<ProofArtifact, "markdownHash" | "artifactHash" | "signature">): string {
  const command = artifact.command.map((part) => JSON.stringify(part)).join(" ");
  const lines = [
    `# Proof: ${artifact.name}`,
    "",
    `- Status: ${artifact.exitCode === 0 && !artifact.timedOut ? "passed" : "failed"}`,
    `- Command: \`${command}\``,
    `- Workspace: \`${artifact.cwd}\``,
    `- Started: ${artifact.startedAt}`,
    `- Finished: ${artifact.finishedAt}`,
    `- Duration: ${artifact.durationMs} ms`,
    `- Exit code: ${artifact.exitCode}${artifact.timedOut ? " (timed out)" : ""}`,
    `- Git HEAD: ${artifact.fingerprint.gitHead ?? "unavailable"}`,
    `- Worktree fingerprint: ${artifact.fingerprint.worktreeHash}`,
    "",
    "## stdout",
    "",
    "```text",
    artifact.stdout.text,
    artifact.stdout.truncated ? "[output truncated]" : "",
    "```",
    "",
    "## stderr",
    "",
    "```text",
    artifact.stderr.text,
    artifact.stderr.truncated ? "[output truncated]" : "",
    "```",
    ""
  ];
  // Optional suite evidence; single-command artifacts render exactly as before.
  for (const step of artifact.steps ?? []) {
    lines.push(
      `## Step: ${step.name}`,
      "",
      `- Status: ${step.exitCode === 0 && !step.timedOut ? "passed" : "failed"}`,
      `- Command: \`${step.command.map((part) => JSON.stringify(part)).join(" ")}\``,
      `- Duration: ${step.durationMs} ms`,
      `- Exit code: ${step.exitCode}${step.timedOut ? " (timed out)" : ""}`,
      "",
      "```text",
      step.stdout.text,
      step.stdout.truncated ? "[output truncated]" : "",
      "```",
      ""
    );
  }
  return lines.join("\n");
}

function atomicWrite(path: string, content: string): void {
  const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temp, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

function validateOptions(options: RunProofOptions): void {
  if (process.platform === "win32") {
    throw new Error("ProofRunner is unavailable on Windows because process-tree containment cannot be guaranteed by portable Node.");
  }
  if (!isSafeProofName(options.name)) throw new Error("--name must start with an alphanumeric character and contain only letters, digits, '.', '_', or '-'.");
  if (options.command.length === 0 || !options.command[0]) throw new Error("Pass a command after -- (for example: quorate proof run --name test -- npm test).");
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 3_600_000)) {
    throw new Error("--timeout-ms must be an integer from 1 to 3600000.");
  }
  if (options.maxOutputBytes !== undefined && (!Number.isInteger(options.maxOutputBytes) || options.maxOutputBytes < 1 || options.maxOutputBytes > 1_048_576)) {
    throw new Error("--max-output-bytes must be an integer from 1 to 1048576.");
  }
}

async function runDirect(command: string[], cwd: string, timeoutMs: number, maxOutputBytes: number): Promise<{ exitCode: number; timedOut: boolean; stdout: ProofOutput; stderr: ProofOutput; cleanup: () => Promise<void> }> {
  return new Promise((resolveRun) => {
    const stdoutCapture: BoundedCapture = { chunks: [], bytes: 0, truncated: false };
    const stderrCapture: BoundedCapture = { chunks: [], bytes: 0, truncated: false };
    let finished = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (exitCode: number): void => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolveRun({ exitCode, timedOut, stdout: boundedText(stdoutCapture), stderr: boundedText(stderrCapture), cleanup: shutdown });
    };
    const grouped = process.platform !== "win32";
    const child = spawn(command[0], command.slice(1), {
      cwd,
      shell: false,
      windowsHide: true,
      detached: grouped,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout?.on("data", (chunk: Buffer) => appendBounded(stdoutCapture, Buffer.from(chunk), maxOutputBytes));
    child.stderr?.on("data", (chunk: Buffer) => appendBounded(stderrCapture, Buffer.from(chunk), maxOutputBytes));
    child.once("error", (error) => {
      appendBounded(stderrCapture, Buffer.from(error.message), maxOutputBytes);
      finish(127);
    });
    child.once("close", (code) => finish(timedOut ? 124 : (code ?? 1)));
    const terminate = (signal: NodeJS.Signals): void => {
      if (grouped && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall through to a direct-child kill if the process group is gone.
        }
      }
      child.kill(signal);
    };
    const groupAlive = (): boolean => {
      if (!grouped || !child.pid) return false;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const shutdown = async (): Promise<void> => {
      terminate("SIGTERM");
      const until = Date.now() + 250;
      while (groupAlive() && Date.now() < until) {
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
      }
      if (groupAlive()) terminate("SIGKILL");
    };
    timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      setTimeout(() => terminate("SIGKILL"), 1_000).unref();
    }, timeoutMs);
  });
}

export async function runProof(options: RunProofOptions): Promise<RunProofResult> {
  validateOptions(options);
  const cwd = resolve(options.cwd);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const execution = await runDirect(options.command, cwd, timeoutMs, maxOutputBytes);
  // The proof command must not leave a successful background process able to
  // modify the worktree or swap proof paths during publication.
  await execution.cleanup();
  const finishedAt = new Date().toISOString();
  // Persist and show only the sanitized argv; the original array was used only
  // for direct execution and never crosses the process boundary as evidence.
  const base = {
    schemaVersion: PROOF_SCHEMA_VERSION,
    name: options.name,
    command: redactProofCommand(options.command),
    cwd: ".",
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    exitCode: execution.exitCode,
    timedOut: execution.timedOut,
    fingerprint: getWorktreeFingerprint(cwd),
    stdout: execution.stdout,
    stderr: execution.stderr
  };
  const markdown = renderMarkdown(base);
  const artifactWithoutHash: Omit<ProofArtifact, "artifactHash" | "signature"> = { ...base, markdownHash: sha256(markdown) };
  const artifactWithoutSignature = { ...artifactWithoutHash, artifactHash: proofHash(artifactWithoutHash) };
  const artifact: ProofArtifact = { ...artifactWithoutSignature, signature: signatureFor(artifactWithoutSignature, proofKey()) };
  const paths = secureProofPaths(cwd, true);
  atomicWrite(paths.markdown, markdown);
  atomicWrite(paths.json, `${JSON.stringify(artifact, null, 2)}\n`);
  return { cwd, exitCode: artifact.exitCode, artifact };
}

function readArtifact(cwd: string): ProofArtifact | undefined {
  const paths = proofPaths(cwd);
  if (!existsSync(paths.json)) return undefined;
  try {
    return JSON.parse(readFileSync(paths.json, "utf8")) as ProofArtifact;
  } catch {
    return undefined;
  }
}

function markdownForArtifact(artifact: ProofArtifact): string {
  const { markdownHash: _markdownHash, artifactHash: _artifactHash, signature: _signature, ...base } = artifact;
  return renderMarkdown(base);
}

function hasArtifactShape(value: ProofArtifact): boolean {
  return value.schemaVersion === PROOF_SCHEMA_VERSION && typeof value.artifactHash === "string" && typeof value.markdownHash === "string" && typeof value.signature === "string" &&
    typeof value.name === "string" && Array.isArray(value.command) && typeof value.fingerprint?.worktreeHash === "string";
}

/** Shared hash/signature/shape verification for any proof artifact. */
function checkArtifactIntegrity(artifact: ProofArtifact): { reason: "tampered"; detail: string } | undefined {
  if (!hasArtifactShape(artifact)) return { reason: "tampered", detail: "Proof artifact has an invalid schema." };
  const { signature, artifactHash, ...withoutHash } = artifact;
  if (proofHash(withoutHash) !== artifactHash) return { reason: "tampered", detail: "Proof artifact hash does not match." };
  try {
    if (!signaturesMatch(signature, signatureFor({ ...withoutHash, artifactHash }, proofKey()))) {
      return { reason: "tampered", detail: "Proof artifact signature does not match." };
    }
  } catch (error: unknown) {
    return { reason: "tampered", detail: error instanceof Error ? error.message : String(error) };
  }
  if (sha256(markdownForArtifact(artifact)) !== artifact.markdownHash) {
    return { reason: "tampered", detail: "Proof Markdown digest does not match." };
  }
  return undefined;
}

/** True when the workspace no longer matches the fingerprint a proof was recorded against. */
function fingerprintIsStale(cwd: string, fingerprint: WorktreeFingerprint): boolean {
  const current = getWorktreeFingerprint(cwd);
  return current.gitHead !== fingerprint.gitHead || current.worktreeHash !== fingerprint.worktreeHash;
}

export function verifyLatestProof(cwd: string, options: { checkFingerprint?: boolean } = {}): ProofVerification {
  try {
    secureProofPaths(cwd, false);
  } catch (error) {
    return { ok: false, reason: "tampered", detail: error instanceof Error ? error.message : String(error) };
  }
  const artifact = readArtifact(cwd);
  if (!artifact) return { ok: false, reason: "missing", detail: "No readable .quorate/proofs/latest.json artifact." };
  const integrity = checkArtifactIntegrity(artifact);
  if (integrity) return { ok: false, reason: integrity.reason, detail: integrity.detail };
  if (options.checkFingerprint !== false && fingerprintIsStale(cwd, artifact.fingerprint)) {
    return { ok: false, reason: "stale", artifact, detail: "Workspace HEAD or worktree fingerprint changed after this proof ran." };
  }
  return { ok: true, reason: "verified", artifact };
}

function compactProofEvidence(artifact: ProofArtifact): { content: string; truncated: boolean } {
  const text = [
    `Status: ${artifact.exitCode === 0 && !artifact.timedOut ? "passed" : "failed"}; exit=${artifact.exitCode}; duration=${artifact.durationMs}ms.`,
    `Command: ${artifact.command.map((part) => JSON.stringify(part)).join(" ")}`,
    "stdout:",
    artifact.stdout.text,
    "stderr:",
    artifact.stderr.text
  ].join("\n");
  const bytes = Buffer.from(text, "utf8");
  const truncated = artifact.stdout.truncated || artifact.stderr.truncated || bytes.length > REVIEW_EVIDENCE_MAX_BYTES;
  return { content: bytes.subarray(0, REVIEW_EVIDENCE_MAX_BYTES).toString("utf8"), truncated };
}

/** Best-effort workspace root for an artifact path laid out as <root>/.quorate/proofs/<file>. */
function worktreeRootForArtifact(path: string): string | undefined {
  const proofsDir = dirname(resolve(path));
  if (basename(proofsDir) !== "proofs") return undefined;
  const quorateDir = dirname(proofsDir);
  if (basename(quorateDir) !== ".quorate") return undefined;
  return dirname(quorateDir);
}

/**
 * Staleness for an explicitly loaded artifact is only meaningful (and only
 * safe) inside a real git worktree: a derived non-git root must never trigger
 * the fallback fingerprint walk over an arbitrary directory tree.
 */
function gitWorktreeStaleness(root: string, fingerprint: WorktreeFingerprint): boolean {
  return gitText(resolve(root), ["rev-parse", "HEAD"]) !== undefined && fingerprintIsStale(root, fingerprint);
}

type ProofArtifactLoad =
  | { status: "ok"; artifact: ProofArtifact; stale: boolean }
  | { status: "missing" }
  | { status: "tampered" };

function loadProofArtifactDetailed(path: string): ProofArtifactLoad {
  let raw: string;
  try {
    raw = readFileSync(resolve(path), "utf8");
  } catch {
    return { status: "missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "tampered" };
  }
  if (typeof parsed !== "object" || parsed === null) return { status: "tampered" };
  const artifact = parsed as ProofArtifact;
  const integrity = checkArtifactIntegrity(artifact);
  if (integrity) return { status: "tampered" };
  const root = worktreeRootForArtifact(path);
  return { status: "ok", artifact, stale: root !== undefined && gitWorktreeStaleness(root, artifact.fingerprint) };
}

/**
 * Load a proof artifact from an explicit path. Returns undefined when the file
 * is missing or fails hash/signature verification; `stale` compares the
 * artifact's fingerprint against the workspace that contains it.
 */
export function loadProofArtifact(path: string): { artifact: ProofArtifact; stale: boolean } | undefined {
  const loaded = loadProofArtifactDetailed(path);
  return loaded.status === "ok" ? { artifact: loaded.artifact, stale: loaded.stale } : undefined;
}

export interface ProofAttachment {
  /** Present only when the artifact passed integrity verification and may be attached. */
  artifact?: ProofArtifact;
  /** Why no artifact is attached, or why an attached one is qualified (for example a stale worktree). */
  note?: string;
}

/**
 * Resolve the proof artifact for a review. An explicit --proof path is the
 * user's own choice: integrity is still enforced, but a stale worktree
 * fingerprint only qualifies the attachment with an honest note. The automatic
 * latest.json attachment must be fully current; stale or tampered artifacts
 * are ignored with an explicit note.
 */
export function proofAttachmentFor(cwd: string, explicitPath?: string): ProofAttachment | undefined {
  const root = resolve(cwd);
  if (explicitPath !== undefined) {
    // Resolve against the reviewed workspace, matching every other path option.
    const loaded = loadProofArtifactDetailed(resolve(root, explicitPath));
    if (loaded.status === "missing") return undefined;
    if (loaded.status === "tampered") {
      return { note: `Proof not attached: tampered (explicit proof artifact at ${explicitPath} failed integrity verification).` };
    }
    if (fingerprintIsStale(root, loaded.artifact.fingerprint)) {
      return {
        artifact: loaded.artifact,
        note: "Proof attached from an explicit path with a stale worktree fingerprint: the reviewed workspace changed after this proof ran."
      };
    }
    return { artifact: loaded.artifact };
  }
  const verification = verifyLatestProof(root);
  if (verification.ok && verification.artifact) return { artifact: verification.artifact };
  if (verification.reason === "stale" || verification.reason === "tampered") {
    return { note: `Proof not attached: ${verification.reason} (${verification.detail ?? "unverified artifact"}).` };
  }
  return undefined;
}

/** Attach only a current, self-verifying proof. The value is explicitly untrusted provider input. */
export function attachLatestProofToReview(
  request: CouncilRequest,
  explicitPath?: string
): { request: CouncilRequest; note?: string } {
  if (request.mode !== "review" || !request.repoPath) return { request };
  const attachment = proofAttachmentFor(request.repoPath, explicitPath);
  if (attachment?.artifact) {
    const evidence = compactProofEvidence(attachment.artifact);
    const attached = { request: { ...request, proof: { name: attachment.artifact.name, ...evidence } } };
    return attachment.note === undefined ? attached : { ...attached, note: attachment.note };
  }
  if (attachment?.note) return { request, note: attachment.note };
  return { request };
}

export function showLatestProof(cwd: string): { output: string; verification: ProofVerification } {
  const verification = verifyLatestProof(cwd);
  if (verification.reason === "tampered") return { output: "", verification };
  if (!verification.artifact) return { output: "No proof artifact found.\n", verification };
  const output = markdownForArtifact(verification.artifact);
  try {
    atomicWrite(secureProofPaths(cwd, true).markdown, output);
  } catch {
    // Signed JSON remains authoritative; a convenience Markdown repair must not
    // make an otherwise valid artifact unusable.
  }
  return { output, verification };
}

function readPackageScripts(cwd: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const scripts = (parsed as { scripts?: unknown }).scripts;
    return typeof scripts === "object" && scripts !== null ? (scripts as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Ordered proof command candidates derived from package.json scripts: test,
 * typecheck, lint, build. Every candidate is executed later as an explicit
 * ["npm", "run", <script>] argv without a shell; "typecheck" and "lint" are
 * only proposed when the script value plausibly runs tsc/eslint, while "build"
 * is included whenever it exists (the builder-value heuristic is advisory).
 */
export function detectProofCommands(cwd: string): Array<{ name: string; argv: string[] }> {
  const scripts = readPackageScripts(cwd);
  const script = (key: string): { key: string; value: string } | undefined => {
    const value = scripts[key];
    return typeof value === "string" && value.trim().length > 0 ? { key, value } : undefined;
  };
  const firstWith = (keys: string[], mustContain: string): { key: string; value: string } | undefined => {
    for (const key of keys) {
      const entry = script(key);
      if (entry !== undefined && entry.value.includes(mustContain)) return entry;
    }
    return undefined;
  };
  const candidates: Array<{ name: string; argv: string[] }> = [];
  const add = (name: string, entry: { key: string; value: string } | undefined): void => {
    if (entry !== undefined) candidates.push({ name, argv: ["npm", "run", entry.key] });
  };
  add("test", script("test") ?? script("test:unit"));
  add("typecheck", firstWith(["typecheck", "tsc", "check"], "tsc"));
  add("lint", firstWith(["lint", "eslint"], "eslint"));
  add("build", script("build"));
  return candidates;
}

export interface DetectedProofStepResult {
  name: string;
  argv: string[];
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  artifact: ProofArtifact;
}

export interface DetectedProofsResult {
  cwd: string;
  /** Aggregate status: 0 only when every step exited 0 without timing out. */
  exitCode: number;
  steps: DetectedProofStepResult[];
  /** Combined multi-step artifact persisted to .quorate/proofs/latest.json (absent when nothing ran). */
  artifact?: ProofArtifact;
}

function combineStepOutputs(steps: DetectedProofStepResult[], pick: (step: DetectedProofStepResult) => ProofOutput, maxBytes: number): ProofOutput {
  const capture: BoundedCapture = { chunks: [], bytes: 0, truncated: false };
  const anyTruncated = steps.some((step) => pick(step).truncated);
  for (const step of steps) {
    const output = pick(step);
    appendBounded(capture, Buffer.from(`[${step.name}] exit=${step.exitCode}\n`, "utf8"), maxBytes);
    appendBounded(capture, Buffer.from(output.text, "utf8"), maxBytes);
    if (output.truncated) appendBounded(capture, Buffer.from("\n[output truncated]\n", "utf8"), maxBytes);
  }
  const combined = boundedText(capture);
  return { ...combined, truncated: combined.truncated || anyTruncated };
}

/** Compose per-step artifacts into one signed suite artifact that reuses the single-command schema. */
function combineProofArtifacts(cwd: string, steps: DetectedProofStepResult[]): ProofArtifact {
  const failure = steps.find((step) => step.exitCode !== 0 || step.timedOut);
  const command: string[] = [];
  steps.forEach((step, index) => {
    if (index > 0) command.push("+");
    command.push(...step.artifact.command);
  });
  const base = {
    schemaVersion: PROOF_SCHEMA_VERSION,
    name: "suite",
    command,
    cwd: ".",
    startedAt: steps[0].artifact.startedAt,
    finishedAt: steps[steps.length - 1].artifact.finishedAt,
    durationMs: steps.reduce((total, step) => total + step.durationMs, 0),
    exitCode: failure ? (failure.exitCode !== 0 ? failure.exitCode : 1) : 0,
    timedOut: steps.some((step) => step.timedOut),
    fingerprint: getWorktreeFingerprint(cwd),
    stdout: combineStepOutputs(steps, (step) => step.artifact.stdout, DEFAULT_MAX_OUTPUT_BYTES),
    stderr: combineStepOutputs(steps, (step) => step.artifact.stderr, DEFAULT_MAX_OUTPUT_BYTES),
    steps: steps.map((step) => step.artifact)
  };
  const markdown = renderMarkdown(base);
  const withoutHash: Omit<ProofArtifact, "artifactHash" | "signature"> = { ...base, markdownHash: sha256(markdown) };
  const withoutSignature = { ...withoutHash, artifactHash: proofHash(withoutHash) };
  return { ...withoutSignature, signature: signatureFor(withoutSignature, proofKey()) };
}

/**
 * Run every detected proof command sequentially through the standard bounded
 * runner (same redaction, output caps, timeout, and no-shell execution) and
 * atomically publish one combined signed artifact to .quorate/proofs/latest.json.
 */
export async function runDetectedProofs(cwd: string, only?: string[]): Promise<DetectedProofsResult> {
  const root = resolve(cwd);
  const detected = detectProofCommands(root).filter((candidate) => only === undefined || only.includes(candidate.name));
  const steps: DetectedProofStepResult[] = [];
  for (const candidate of detected) {
    const result = await runProof({ cwd: root, name: candidate.name, command: candidate.argv });
    steps.push({
      name: candidate.name,
      argv: candidate.argv,
      exitCode: result.exitCode,
      timedOut: result.artifact.timedOut,
      durationMs: result.artifact.durationMs,
      artifact: result.artifact
    });
  }
  if (steps.length === 0) return { cwd: root, exitCode: 0, steps };
  const combined = combineProofArtifacts(root, steps);
  const paths = secureProofPaths(root, true);
  atomicWrite(paths.markdown, markdownForArtifact(combined));
  atomicWrite(paths.json, `${JSON.stringify(combined, null, 2)}\n`);
  return { cwd: root, exitCode: combined.exitCode, steps, artifact: combined };
}
