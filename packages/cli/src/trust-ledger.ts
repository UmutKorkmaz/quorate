import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeSync
} from "node:fs";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SCHEMA_VERSION = 1 as const;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const LOCK_WAIT_MS = 5_000;
const LOCK_LEASE_MS = 15_000;
const LOCK_POLL_MS = 20;
const MALFORMED_LOCK_STALE_MS = 100;
const MAX_IDENTIFIER = 200;
const MAX_SMALL_FILE_BYTES = 64 * 1024;
export const MAX_AUDIT_LEDGER_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIT_LINE_BYTES = 16 * 1024;
export const MAX_AUDIT_RECORDS = 50_000;
export const MAX_AUDIT_DIAGNOSTICS = 100;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;
const CLOEXEC = 0;
const DIRECTORY = constants.O_DIRECTORY ?? 0;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

export type ApprovalAuditDecision = "allow" | "deny" | "timeout";
export type ApprovalReasonCode = "user-denied" | "approval-timeout" | "monitor-disconnected" | "approval-expired";
export type AuditFaultPoint =
  | "after-lock-temp-create"
  | "after-lock-partial-write"
  | "after-lock-acquire"
  | "before-malformed-lock-reap"
  | "after-lock-quarantine-rename"
  | "after-malformed-lock-reap"
  | "after-init-key-temp-create"
  | "after-init-key-partial-write"
  | "after-init-key-temp-fsync"
  | "after-key-fsync"
  | "after-genesis-head-fsync"
  | "after-key-publish"
  | "after-key-publish-fsync"
  | "after-ledger-fsync"
  | "after-head-temp-fsync"
  | "after-head-rename";

export interface ApprovalAuditInput {
  requestId: string;
  runId: string;
  source: string;
  tool: string;
  decision: ApprovalAuditDecision;
  reasonCode?: ApprovalReasonCode;
  decisionSurface: string;
  timestamp: string;
}

export interface ApprovalAuditRecord extends ApprovalAuditInput {
  schemaVersion: typeof SCHEMA_VERSION;
  sequence: number;
  previousHash: string | null;
  recordHash: string;
  signature: string;
}

interface AuditHead {
  schemaVersion: typeof SCHEMA_VERSION;
  sequence: number;
  recordHash: string | null;
  signature: string;
}

interface LockRecord {
  token: string;
  pid: number;
  createdAt: string;
  leaseUntil: string;
}

interface OpenedLock {
  fd: number;
  path: string;
  token: string;
  dev: number;
  ino: number;
  mtimeMs?: number;
}

export interface AuditVerification {
  ok: boolean;
  records: number;
  headSequence: number;
  errors: string[];
}

export interface AuditExportOptions {
  dir?: string;
  decision?: ApprovalAuditDecision;
  source?: string;
  since?: string;
  until?: string;
  format?: "json" | "jsonl";
}

interface AppendOptions {
  dir?: string;
  fault?: (point: AuditFaultPoint) => void;
}

interface ScanResult {
  verification: AuditVerification;
  records: ApprovalAuditRecord[];
  key?: Buffer;
  headBehind: boolean;
  pendingInitialization?: { key: Buffer; headReady: boolean; identity: FileIdentity };
  corruptProvisional?: FileIdentity;
}

interface FileIdentity {
  dev: number;
  ino: number;
  mtimeMs: number;
  size: number;
}

interface MalformedLockObservation {
  identity: FileIdentity;
  firstSeenAt: number;
}

interface BoundedFileRead {
  bytes?: Buffer;
  mode?: number;
  dev?: number;
  ino?: number;
  mtimeMs?: number;
  size?: number;
  regular?: boolean;
  error?: string;
}

export class DuplicateApprovalDecisionError extends Error {
  constructor(requestId: string) {
    super(`Approval ${requestId} already has a terminal decision.`);
    this.name = "DuplicateApprovalDecisionError";
  }
}

export function defaultAuditDir(): string {
  return join(homedir(), ".quorate", "audit");
}

export function auditLedgerPath(dir: string = defaultAuditDir()): string {
  return join(dir, "approvals.jsonl");
}

export function auditKeyPath(dir: string = defaultAuditDir()): string {
  return join(dir, "approvals.key");
}

export function auditInitKeyPath(dir: string = defaultAuditDir()): string {
  return join(dir, "approvals.key.init");
}

export function auditHeadPath(dir: string = defaultAuditDir()): string {
  return join(dir, "approvals.head.json");
}

export function auditLockPath(dir: string = defaultAuditDir()): string {
  return join(dir, "approvals.lock");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sign(key: Buffer, value: unknown): string {
  return createHmac("sha256", key).update(canonicalJson(value), "utf8").digest("hex");
}

function safeEqualHex(left: unknown, right: string): boolean {
  if (typeof left !== "string" || !HASH_PATTERN.test(left) || !HASH_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function errorText(error: unknown): string {
  return safeDiagnostic(error instanceof Error ? error.message : String(error));
}

function safeDiagnostic(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

/** Strict RFC3339 validation (calendar-valid, no implementation-dependent Date.parse forms). */
export function normalizeRfc3339(value: string, field = "timestamp"): string {
  const match = RFC3339_PATTERN.exec(value);
  if (!match) throw new Error(`${field} must be a valid RFC 3339 timestamp.`);
  const [, ys, mos, ds, hs, mis, ss, , zone] = match;
  const year = Number(ys);
  const month = Number(mos);
  const day = Number(ds);
  const hour = Number(hs);
  const minute = Number(mis);
  const second = Number(ss);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${field} must be a valid RFC 3339 timestamp.`);
  }
  if (zone !== "Z") {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) throw new Error(`${field} must be a valid RFC 3339 timestamp.`);
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error(`${field} must be a valid RFC 3339 timestamp.`);
  return new Date(millis).toISOString();
}

function bounded(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_IDENTIFIER || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${field} must contain 1-${MAX_IDENTIFIER} safe characters.`);
  }
  return normalized;
}

function defaultReasonCode(decision: ApprovalAuditDecision): ApprovalReasonCode | undefined {
  if (decision === "deny") return "user-denied";
  if (decision === "timeout") return "approval-timeout";
  return undefined;
}

function isReasonCode(value: unknown): value is ApprovalReasonCode {
  return value === "user-denied" || value === "approval-timeout" || value === "monitor-disconnected" || value === "approval-expired";
}

function expectedRecordKeys(hasReason: boolean): string[] {
  return [
    "schemaVersion", "sequence", "requestId", "runId", "source", "tool", "decision",
    ...(hasReason ? ["reasonCode"] : []), "decisionSurface", "timestamp", "previousHash", "recordHash", "signature"
  ].sort();
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function inspectAuditDirectory(dir: string): { exists: boolean; errors: string[] } {
  try {
    const before = lstatSync(dir);
    if (before.isSymbolicLink()) return { exists: true, errors: ["Audit path must not be a symlink."] };
    if (!before.isDirectory()) return { exists: true, errors: ["Audit path is not a real directory."] };
    const fd = openSync(dir, constants.O_RDONLY | DIRECTORY | NOFOLLOW | CLOEXEC);
    try {
      const opened = fstatSync(fd);
      if (!opened.isDirectory() || opened.dev !== before.dev || opened.ino !== before.ino) {
        return { exists: true, errors: ["Audit directory changed while it was opened."] };
      }
    } finally {
      closeSync(fd);
    }
    const errors = (before.mode & 0o777) === DIR_MODE ? [] : ["Audit directory permissions must be 0700."];
    return { exists: true, errors };
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, errors: [] };
    }
    return { exists: true, errors: [`Could not inspect audit directory: ${errorText(error)}`] };
  }
}

function readBoundedFile(path: string, maxBytes: number): BoundedFileRead {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | NOFOLLOW | NONBLOCK | CLOEXEC);
    const stat = fstatSync(fd);
    const shown = safeDiagnostic(path);
    const metadata: BoundedFileRead = {
      mode: stat.mode & 0o777,
      dev: stat.dev,
      ino: stat.ino,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      regular: stat.isFile()
    };
    if (!stat.isFile()) return { ...metadata, error: `${shown} is not a regular file.` };
    if (stat.size > maxBytes) return { ...metadata, error: `${shown} is too large (${stat.size} > ${maxBytes} bytes).` };
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < stat.size) {
      const count = readSync(fd, bytes, offset, stat.size - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== stat.size) return { ...metadata, error: `${shown} changed while it was read.` };
    return { ...metadata, bytes };
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return {};
    return { error: `Could not read ${safeDiagnostic(path)}: ${errorText(error)}` };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function parseLedger(bytes: Buffer, key: Buffer, errors: string[]): ApprovalAuditRecord[] {
  if (bytes.length === 0) return [];
  if (bytes[bytes.length - 1] !== 0x0a) {
    errors.push("Audit ledger has a partial trailing record.");
    return [];
  }
  const records: ApprovalAuditRecord[] = [];
  let start = 0;
  let previousHash: string | null = null;
  let physicalLine = 0;
  let suppressed = 0;
  const report = (message: string): void => {
    if (errors.length < MAX_AUDIT_DIAGNOSTICS) errors.push(message);
    else suppressed += 1;
  };
  for (let offset = 0; offset < bytes.length; offset += 1) {
    if (bytes[offset] !== 0x0a) continue;
    physicalLine += 1;
    const length = offset - start;
    const number = physicalLine;
    if (length <= 0 || length > MAX_AUDIT_LINE_BYTES) {
      report(`Physical record ${number} exceeds the audit line limit.`);
      break;
    }
    if (number > MAX_AUDIT_RECORDS) {
      report(`Audit ledger exceeds the ${MAX_AUDIT_RECORDS} physical-record limit.`);
      break;
    }
    const line = bytes.subarray(start, offset).toString("utf8");
    start = offset + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      report(`Record ${number} is not valid JSON.`);
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      report(`Record ${number} is not an object.`);
      continue;
    }
    const raw = parsed as Record<string, unknown>;
    const hasReason = Object.prototype.hasOwnProperty.call(raw, "reasonCode");
    if (!exactKeys(raw, expectedRecordKeys(hasReason))) {
      report(`Record ${number} has unexpected or missing fields.`);
      continue;
    }
    if (
      raw.schemaVersion !== SCHEMA_VERSION || raw.sequence !== number ||
      typeof raw.requestId !== "string" || typeof raw.runId !== "string" || typeof raw.source !== "string" ||
      typeof raw.tool !== "string" || typeof raw.decisionSurface !== "string" || typeof raw.timestamp !== "string" ||
      (raw.decision !== "allow" && raw.decision !== "deny" && raw.decision !== "timeout") ||
      (raw.previousHash !== null && (typeof raw.previousHash !== "string" || !HASH_PATTERN.test(raw.previousHash))) ||
      typeof raw.recordHash !== "string" || typeof raw.signature !== "string" ||
      (hasReason && !isReasonCode(raw.reasonCode))
    ) {
      report(`Record ${number} has invalid field types or values.`);
      continue;
    }
    try {
      bounded(raw.requestId, "requestId"); bounded(raw.runId, "runId"); bounded(raw.source, "source");
      bounded(raw.tool, "tool"); bounded(raw.decisionSurface, "decisionSurface"); normalizeRfc3339(raw.timestamp, "timestamp");
    } catch (error: unknown) {
      report(`Record ${number}: ${errorText(error)}`);
      continue;
    }
    const record = raw as unknown as ApprovalAuditRecord;
    if (canonicalJson(record) !== line) report(`Record ${number} is not canonically encoded.`);
    if (record.previousHash !== previousHash) report(`Record ${number} breaks the previousHash chain.`);
    const { recordHash, signature, ...base } = record;
    const computedHash = sha256(canonicalJson(base));
    if (!safeEqualHex(recordHash, computedHash)) report(`Record ${number} has an invalid record hash.`);
    const computedSignature = sign(key, { ...base, recordHash });
    if (!safeEqualHex(signature, computedSignature)) report(`Record ${number} has an invalid signature.`);
    records.push(record);
    previousHash = recordHash;
  }
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.requestId)) report(`Approval ${record.requestId} has more than one terminal decision.`);
    ids.add(record.requestId);
  }
  if (suppressed > 0) errors.push(`${suppressed} additional audit diagnostics suppressed.`);
  return records;
}

function parseHead(bytes: Buffer, key: Buffer, errors: string[]): AuditHead | undefined {
  if (bytes.length > MAX_SMALL_FILE_BYTES) {
    errors.push("Signed audit head is too large.");
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    errors.push("Signed audit head is not valid JSON.");
    return undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("Signed audit head is malformed.");
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  if (!exactKeys(value, ["schemaVersion", "sequence", "recordHash", "signature"]) ||
      value.schemaVersion !== SCHEMA_VERSION || !Number.isInteger(value.sequence) || Number(value.sequence) < 0 ||
      (value.sequence === 0 ? value.recordHash !== null : typeof value.recordHash !== "string") ||
      typeof value.signature !== "string") {
    errors.push("Signed audit head is malformed.");
    return undefined;
  }
  const head = value as unknown as AuditHead;
  if (`${canonicalJson(head)}\n` !== bytes.toString("utf8")) errors.push("Signed audit head is not canonically encoded.");
  const { signature, ...payload } = head;
  if (!safeEqualHex(signature, sign(key, payload))) errors.push("Signed audit head has an invalid signature.");
  return head;
}

function inspectLock(dir: string, errors: string[]): void {
  const lock = readBoundedFile(auditLockPath(dir), MAX_SMALL_FILE_BYTES);
  if (lock.error) {
    errors.push(lock.error);
    return;
  }
  if (!lock.bytes) return;
  if (lock.mode !== FILE_MODE) errors.push("Audit lock permissions must be 0600.");
  if (!parseLock(lock.bytes)) errors.push("Audit lock is malformed or has an invalid lease interval.");
}

function fileWasFound(result: BoundedFileRead): boolean {
  return result.bytes !== undefined || result.error !== undefined;
}

function fileIdentity(result: BoundedFileRead): FileIdentity | undefined {
  if (result.regular !== true || result.dev === undefined || result.ino === undefined ||
      result.mtimeMs === undefined || result.size === undefined) return undefined;
  return { dev: result.dev, ino: result.ino, mtimeMs: result.mtimeMs, size: result.size };
}

function scanAuditStore(dir: string): ScanResult {
  const directory = inspectAuditDirectory(dir);
  if (!directory.exists) {
    return { verification: { ok: true, records: 0, headSequence: 0, errors: [] }, records: [], headBehind: false };
  }
  const errors = [...directory.errors];
  inspectLock(dir, errors);
  const keyRead = readBoundedFile(auditKeyPath(dir), 33);
  const initKeyRead = readBoundedFile(auditInitKeyPath(dir), 33);
  const ledgerRead = readBoundedFile(auditLedgerPath(dir), MAX_AUDIT_LEDGER_BYTES);
  const headRead = readBoundedFile(auditHeadPath(dir), MAX_SMALL_FILE_BYTES);
  for (const result of [keyRead, initKeyRead, ledgerRead, headRead]) if (result.error) errors.push(result.error);
  for (const [label, result] of [["key", keyRead], ["provisional key", initKeyRead], ["ledger", ledgerRead], ["head", headRead]] as const) {
    if (fileWasFound(result) && result.mode !== undefined && result.mode !== FILE_MODE) {
      errors.push(`Audit ${label} permissions must be 0600.`);
    }
  }

  const keyPresent = fileWasFound(keyRead);
  const initKeyPresent = fileWasFound(initKeyRead);
  const ledgerPresent = fileWasFound(ledgerRead);
  const headPresent = fileWasFound(headRead);
  if (!keyPresent && !initKeyPresent && !ledgerPresent && !headPresent) {
    return { verification: { ok: errors.length === 0, records: 0, headSequence: 0, errors }, records: [], headBehind: false };
  }

  if (initKeyPresent) {
    if (keyPresent) errors.push("Audit final and provisional signing keys must not coexist.");
    if (ledgerPresent) errors.push("Audit ledger exists before signing key initialization completed.");
    const initIdentity = fileIdentity(initKeyRead);
    const validInitKey = initKeyRead.bytes?.length === 32 && initKeyRead.mode === FILE_MODE && initIdentity !== undefined;
    if (!validInitKey) errors.push("Audit provisional signing key must be an owner-only regular file of exactly 32 bytes.");

    let headReady = false;
    if (validInitKey && headRead.bytes) {
      const beforeHeadErrors = errors.length;
      const head = parseHead(headRead.bytes, initKeyRead.bytes!, errors);
      if (head && (head.sequence !== 0 || head.recordHash !== null)) {
        errors.push("Pending audit initialization requires a signed sequence-0 genesis head.");
      }
      headReady = Boolean(head && head.sequence === 0 && head.recordHash === null && errors.length === beforeHeadErrors);
    }

    const recoverable = validInitKey && !keyPresent && !ledgerPresent &&
      (!headPresent || headReady) && errors.length === 0;
    const corruptIdentity = initIdentity;
    const corruptProvisional = !keyPresent && !ledgerPresent && !headPresent && initKeyRead.mode === FILE_MODE &&
      corruptIdentity && initKeyRead.size !== 32 ? corruptIdentity : undefined;
    errors.push(recoverable
      ? "Audit initialization is incomplete; the provisional signing key is not published."
      : "Audit provisional signing key state is invalid.");
    return {
      verification: { ok: false, records: 0, headSequence: 0, errors },
      records: [],
      headBehind: false,
      ...(recoverable ? { pendingInitialization: { key: initKeyRead.bytes!, headReady, identity: initIdentity! } } : {}),
      ...(corruptProvisional ? { corruptProvisional } : {})
    };
  }

  if (!keyRead.bytes || keyRead.bytes.length !== 32) {
    errors.push("Audit signing key is missing or must be exactly 32 bytes.");
    return { verification: { ok: false, records: 0, headSequence: 0, errors }, records: [], headBehind: false };
  }
  const key = keyRead.bytes;
  const records = ledgerRead.bytes ? parseLedger(ledgerRead.bytes, key, errors) : [];
  const head = headRead.bytes ? parseHead(headRead.bytes, key, errors) : undefined;
  const tail = records.at(-1);
  let headBehind = false;
  let headSequence = head?.sequence ?? 0;
  if (!tail) {
    if (ledgerRead.bytes && ledgerRead.bytes.length > 0) {
      // parseLedger already supplied the physical-line diagnostics.
    } else if (!head) {
      errors.push("Final audit signing key exists without the required signed audit head.");
    } else if (head.sequence !== 0 || head.recordHash !== null) {
      errors.push("Signed audit head exists without its ledger tail.");
    }
  } else if (!head) {
    errors.push("Required signed audit head is missing for a non-empty ledger.");
  } else if (
    (head.sequence === 0 && head.recordHash === null) ||
    (head.sequence > 0 && head.sequence <= records.length && records[head.sequence - 1]?.recordHash === head.recordHash)
  ) {
    headBehind = head.sequence < tail.sequence;
  } else {
    errors.push("Signed audit head does not match a valid ledger prefix.");
  }
  return {
    verification: { ok: errors.length === 0, records: records.length, headSequence, errors },
    records,
    key,
    headBehind
  };
}

function ensureWritableAuditDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const inspected = inspectAuditDirectory(dir);
  if (!inspected.exists || inspected.errors.length > 0) throw new Error(inspected.errors.join(" ") || "Audit directory is unavailable.");
}

function writeAll(fd: number, bytes: Buffer | string): void {
  const buffer = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  let offset = 0;
  while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
}

function fsyncDirectory(dir: string): void {
  const fd = openSync(dir, constants.O_RDONLY | DIRECTORY | NOFOLLOW | CLOEXEC);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function createProvisionalKey(dir: string, fault?: (point: AuditFaultPoint) => void): void {
  const key = randomBytes(32);
  const path = auditInitKeyPath(dir);
  const temp = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW | CLOEXEC, FILE_MODE);
    const initial = fstatSync(fd);
    if (!initial.isFile() || (initial.mode & 0o777) !== FILE_MODE) {
      throw new Error("Audit provisional signing key candidate is not an owner-only regular file.");
    }
    fault?.("after-init-key-temp-create");
    const split = Math.floor(key.length / 2);
    writeAll(fd, key.subarray(0, split));
    fault?.("after-init-key-partial-write");
    writeAll(fd, key.subarray(split));
    fsyncSync(fd);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size !== 32 || (stat.mode & 0o777) !== FILE_MODE) {
      throw new Error("Audit provisional signing key was not durably created as an owner-only 32-byte file.");
    }
    fault?.("after-init-key-temp-fsync");
    closeSync(fd);
    fd = undefined;

    // Publish the recoverable fixed name only after the candidate contents are
    // durable. Hard-link publication is atomic and refuses to replace an
    // unexpected existing initialization key.
    linkSync(temp, path);
    fsyncDirectory(dir);
    rmSync(temp);
    fsyncDirectory(dir);
    fault?.("after-key-fsync");
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temp, { force: true });
  }
}

function quarantineCorruptProvisionalKey(dir: string, observed: FileIdentity): void {
  const path = auditInitKeyPath(dir);
  const current = lstatSync(path);
  if (!current.isFile() || current.isSymbolicLink() || current.dev !== observed.dev || current.ino !== observed.ino ||
      current.mtimeMs !== observed.mtimeMs || current.size !== observed.size) {
    throw new Error("Audit provisional signing key changed before quarantine.");
  }
  const quarantine = `${path}.corrupt-${Date.now()}-${randomBytes(8).toString("hex")}`;
  renameSync(path, quarantine);
  fsyncDirectory(dir);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseLock(bytes: Buffer): LockRecord | undefined {
  try {
    const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (!exactKeys(value, ["token", "pid", "createdAt", "leaseUntil"]) || typeof value.token !== "string" ||
        !/^[a-f0-9]{32}$/.test(value.token) || !Number.isInteger(value.pid) || Number(value.pid) <= 0 ||
        typeof value.createdAt !== "string" || typeof value.leaseUntil !== "string") return undefined;
    const createdAt = normalizeRfc3339(value.createdAt, "lock createdAt");
    const leaseUntil = normalizeRfc3339(value.leaseUntil, "lock leaseUntil");
    const createdMs = Date.parse(createdAt);
    const leaseMs = Date.parse(leaseUntil);
    if (createdMs > Date.now() + 1_000 || leaseMs <= createdMs || leaseMs - createdMs > LOCK_LEASE_MS) return undefined;
    return { token: value.token, pid: Number(value.pid), createdAt, leaseUntil };
  } catch {
    return undefined;
  }
}

function restoreQuarantinedLock(path: string, quarantine: string, moved: BoundedFileRead): void {
  if (moved.regular !== true) return;
  try {
    // Exclusive hard-link restoration never overwrites a newer claimant. If a
    // new lock already owns the public name, leave the moved successor in its
    // unpredictable quarantine name; its held owner will then fail the normal
    // pathname ownership check before any durable write.
    linkSync(quarantine, path);
    fsyncDirectory(dirname(path));
    rmSync(quarantine);
    fsyncDirectory(dirname(path));
  } catch {
    // Fail closed: never replace a public lock that appeared after quarantine.
  }
}

function quarantineAndRemoveLock(
  path: string,
  expected: FileIdentity,
  expectedToken?: string,
  fault?: (point: AuditFaultPoint) => void
): boolean {
  const quarantine = `${path}.quarantine-${process.pid}-${randomBytes(8).toString("hex")}`;
  try {
    // Rename atomically removes exactly one current public pathname. The moved
    // inode is verified after the move, so a successor caught by the rename is
    // restored (when still safe) instead of deleted.
    renameSync(path, quarantine);
  } catch {
    return false;
  }
  fault?.("after-lock-quarantine-rename");
  const moved = readBoundedFile(quarantine, MAX_SMALL_FILE_BYTES);
  const movedIdentity = fileIdentity(moved);
  const parsed = expectedToken && moved.bytes && !moved.error ? parseLock(moved.bytes) : undefined;
  const matches = movedIdentity !== undefined && sameIdentity(movedIdentity, expected) &&
    (expectedToken === undefined || parsed?.token === expectedToken);
  if (!matches) {
    restoreQuarantinedLock(path, quarantine, moved);
    return false;
  }
  try {
    rmSync(quarantine);
    fsyncDirectory(dirname(path));
    return true;
  } catch {
    return false;
  }
}

function removeLockIfOwned(path: string, observed: { token: string; dev: number; ino: number }): boolean {
  const current = readBoundedFile(path, MAX_SMALL_FILE_BYTES);
  const identity = fileIdentity(current);
  if (!current.bytes || current.error || !identity || identity.dev !== observed.dev || identity.ino !== observed.ino) return false;
  const parsed = parseLock(current.bytes);
  if (!parsed || parsed.token !== observed.token) return false;
  return quarantineAndRemoveLock(path, identity, observed.token);
}

function tryReapLock(
  path: string,
  fault?: (point: AuditFaultPoint) => void,
  previous?: MalformedLockObservation
): MalformedLockObservation | undefined {
  const observed = readBoundedFile(path, MAX_SMALL_FILE_BYTES);
  const identity = fileIdentity(observed);
  if (!identity) return undefined;
  const parsed = !observed.error && observed.bytes ? parseLock(observed.bytes) : undefined;
  if (!parsed) {
    const now = Date.now();
    const stable = previous && sameIdentity(previous.identity, identity)
      ? previous
      : { identity, firstSeenAt: now };
    const staleByMtime = identity.mtimeMs <= now && now - identity.mtimeMs >= MALFORMED_LOCK_STALE_MS;
    if (!staleByMtime && now - stable.firstSeenAt < MALFORMED_LOCK_STALE_MS) return stable;
    fault?.("before-malformed-lock-reap");
    quarantineAndRemoveLock(path, identity, undefined, fault);
    fault?.("after-malformed-lock-reap");
    return undefined;
  }
  const leaseExpired = Date.parse(parsed.leaseUntil) <= Date.now();
  if (!leaseExpired && pidAlive(parsed.pid)) return undefined;
  removeLockIfOwned(path, { token: parsed.token, dev: identity.dev, ino: identity.ino });
  return undefined;
}

function acquireAuditLock(dir: string, fault?: (point: AuditFaultPoint) => void): OpenedLock {
  ensureWritableAuditDir(dir);
  const path = auditLockPath(dir);
  const deadline = Date.now() + LOCK_WAIT_MS;
  let malformedObservation: MalformedLockObservation | undefined;
  while (true) {
    const token = randomBytes(16).toString("hex");
    const temp = `${path}.${process.pid}.${token}.claim`;
    let fd: number | undefined;
    let identity: { dev: number; ino: number } | undefined;
    let linked = false;
    try {
      fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW | CLOEXEC, FILE_MODE);
      const stat = fstatSync(fd);
      if (!stat.isFile()) throw new Error("Audit lock is not a regular file.");
      identity = { dev: stat.dev, ino: stat.ino };
      fault?.("after-lock-temp-create");
      const created = new Date();
      const record: LockRecord = {
        token,
        pid: process.pid,
        createdAt: created.toISOString(),
        leaseUntil: new Date(created.getTime() + LOCK_LEASE_MS).toISOString()
      };
      const bytes = Buffer.from(`${canonicalJson(record)}\n`, "utf8");
      const split = Math.max(1, Math.floor(bytes.length / 2));
      writeAll(fd, bytes.subarray(0, split));
      fault?.("after-lock-partial-write");
      writeAll(fd, bytes.subarray(split));
      fsyncSync(fd);
      try {
        linkSync(temp, path);
        linked = true;
        fsyncDirectory(dir);
      } catch (error: unknown) {
        if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        closeSync(fd);
        fd = undefined;
        rmSync(temp, { force: true });
        malformedObservation = tryReapLock(path, fault, malformedObservation);
        if (Date.now() >= deadline) throw new Error("Timed out waiting for the audit ledger lock.");
        Atomics.wait(sleepBuffer, 0, 0, LOCK_POLL_MS);
        continue;
      }
      rmSync(temp, { force: true });
      fsyncDirectory(dir);
      fault?.("after-lock-acquire");
      return { fd, path, token, dev: stat.dev, ino: stat.ino };
    } catch (error: unknown) {
      if (fd !== undefined) closeSync(fd);
      rmSync(temp, { force: true });
      if (linked && identity) removeLockIfOwned(path, { token, ...identity });
      throw error;
    }
  }
}

function releaseAuditLock(lock: OpenedLock): void {
  closeSync(lock.fd);
  removeLockIfOwned(lock.path, lock);
}

function assertAuditLockOwned(lock: OpenedLock): void {
  const held = fstatSync(lock.fd);
  if (!held.isFile() || held.dev !== lock.dev || held.ino !== lock.ino || (held.mode & 0o777) !== FILE_MODE) {
    throw new Error("Audit lock ownership was lost.");
  }
  const current = readBoundedFile(lock.path, MAX_SMALL_FILE_BYTES);
  const parsed = current.bytes ? parseLock(current.bytes) : undefined;
  if (!parsed || parsed.token !== lock.token || current.dev !== lock.dev || current.ino !== lock.ino ||
      Date.parse(parsed.leaseUntil) <= Date.now()) {
    throw new Error("Audit lock ownership was lost or its lease expired.");
  }
}

function writeAtomicHead(
  dir: string,
  head: AuditHead,
  fault?: (point: AuditFaultPoint) => void,
  assertOwnership?: () => void
): void {
  const path = auditHeadPath(dir);
  const temp = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let fd: number | undefined;
  try {
    assertOwnership?.();
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW | CLOEXEC, FILE_MODE);
    writeAll(fd, `${canonicalJson(head)}\n`);
    fsyncSync(fd);
    fault?.("after-head-temp-fsync");
    assertOwnership?.();
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    fault?.("after-head-rename");
    fsyncDirectory(dir);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temp, { force: true });
  }
}

function signedHead(key: Buffer, record: ApprovalAuditRecord): AuditHead {
  const payload: Omit<AuditHead, "signature"> = { schemaVersion: SCHEMA_VERSION, sequence: record.sequence, recordHash: record.recordHash };
  return { ...payload, signature: sign(key, payload) };
}

function signedGenesisHead(key: Buffer): AuditHead {
  const payload: Omit<AuditHead, "signature"> = { schemaVersion: SCHEMA_VERSION, sequence: 0, recordHash: null };
  return { ...payload, signature: sign(key, payload) };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function completeInitialization(
  dir: string,
  pending: NonNullable<ScanResult["pendingInitialization"]>,
  lock: OpenedLock,
  fault?: (point: AuditFaultPoint) => void
): ScanResult {
  let ready = pending;
  if (!ready.headReady) {
    writeAtomicHead(dir, signedGenesisHead(ready.key), fault, () => assertAuditLockOwned(lock));
    const afterHead = scanAuditStore(dir).pendingInitialization;
    if (!afterHead?.headReady || !timingSafeEqual(afterHead.key, ready.key)) {
      throw new Error("Audit genesis head initialization did not complete.");
    }
    ready = afterHead;
  }

  // A recovered post-rename head may not have reached its directory fsync in
  // the interrupted process. Make the genesis pathname durable before the
  // final key name can become visible.
  fsyncDirectory(dir);
  fault?.("after-genesis-head-fsync");
  assertAuditLockOwned(lock);

  const checked = scanAuditStore(dir).pendingInitialization;
  if (!checked?.headReady || !timingSafeEqual(checked.key, ready.key) || !sameIdentity(checked.identity, ready.identity)) {
    throw new Error("Audit provisional signing key or genesis head changed before publication.");
  }
  if (fileWasFound(readBoundedFile(auditKeyPath(dir), 33))) {
    throw new Error("Audit final signing key appeared before initialization publication.");
  }

  renameSync(auditInitKeyPath(dir), auditKeyPath(dir));
  fault?.("after-key-publish");
  fsyncDirectory(dir);
  fault?.("after-key-publish-fsync");

  const initialized = scanAuditStore(dir);
  if (!initialized.verification.ok || !initialized.key || initialized.records.length !== 0) {
    throw new Error(`Audit initialization verification failed: ${initialized.verification.errors.join(" ")}`);
  }
  return initialized;
}

function recoverHeadIfNeeded(dir: string, scan: ScanResult, lock: OpenedLock): void {
  if (!scan.headBehind) return;
  const tail = scan.records.at(-1);
  if (!tail || !scan.key) throw new Error("Recoverable audit suffix has no signed tail.");
  writeAtomicHead(dir, signedHead(scan.key, tail), undefined, () => assertAuditLockOwned(lock));
}

export function verifyApprovalAuditLedger(options: { dir?: string } = {}): AuditVerification {
  try {
    return scanAuditStore(options.dir ?? defaultAuditDir()).verification;
  } catch (error: unknown) {
    return { ok: false, records: 0, headSequence: 0, errors: [errorText(error)] };
  }
}

export function appendApprovalAuditRecord(input: ApprovalAuditInput, options: AppendOptions = {}): ApprovalAuditRecord {
  const dir = options.dir ?? defaultAuditDir();
  const lock = acquireAuditLock(dir, options.fault);
  try {
    assertAuditLockOwned(lock);
    let scan = scanAuditStore(dir);
    const pristine = scan.records.length === 0 && !scan.key && scan.verification.ok;
    if (scan.corruptProvisional) {
      quarantineCorruptProvisionalKey(dir, scan.corruptProvisional);
      throw new Error("Audit provisional signing key was invalid and has been quarantined; retry initialization explicitly.");
    }
    if (pristine) {
      createProvisionalKey(dir, options.fault);
      scan = scanAuditStore(dir);
    }
    if (scan.pendingInitialization) {
      scan = completeInitialization(dir, scan.pendingInitialization, lock, options.fault);
    } else if (!scan.verification.ok) {
      throw new Error(`Audit ledger verification failed: ${scan.verification.errors.join(" ")}`);
    }
    if (scan.headBehind) {
      recoverHeadIfNeeded(dir, scan, lock);
      scan = scanAuditStore(dir);
      if (!scan.verification.ok || scan.headBehind) throw new Error("Audit head recovery did not complete.");
    }
    const requestId = bounded(input.requestId, "requestId");
    if (scan.records.some((record) => record.requestId === requestId)) throw new DuplicateApprovalDecisionError(requestId);
    if (input.decision !== "allow" && input.decision !== "deny" && input.decision !== "timeout") throw new Error("Invalid terminal decision.");
    const reasonCode = input.reasonCode ?? defaultReasonCode(input.decision);
    if (reasonCode !== undefined && !isReasonCode(reasonCode)) throw new Error("Invalid approval reason code.");
    const timestamp = normalizeRfc3339(input.timestamp);
    const key = scan.key;
    if (!key) throw new Error("Audit signing key is unavailable.");
    const tail = scan.records.at(-1);
    const base: Omit<ApprovalAuditRecord, "recordHash" | "signature"> = {
      schemaVersion: SCHEMA_VERSION,
      sequence: (tail?.sequence ?? 0) + 1,
      requestId,
      runId: bounded(input.runId, "runId"),
      source: bounded(input.source, "source"),
      tool: bounded(input.tool, "tool"),
      decision: input.decision,
      ...(reasonCode ? { reasonCode } : {}),
      decisionSurface: bounded(input.decisionSurface, "decisionSurface"),
      timestamp,
      previousHash: tail?.recordHash ?? null
    };
    const recordHash = sha256(canonicalJson(base));
    const signed = { ...base, recordHash };
    const record: ApprovalAuditRecord = { ...signed, signature: sign(key, signed) };
    assertAuditLockOwned(lock);
    const ledgerFd = openSync(
      auditLedgerPath(dir),
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NOFOLLOW | CLOEXEC,
      FILE_MODE
    );
    try {
      const stat = fstatSync(ledgerFd);
      if (!stat.isFile() || (stat.mode & 0o777) !== FILE_MODE) throw new Error("Audit ledger must be a 0600 regular file.");
      const line = `${canonicalJson(record)}\n`;
      if (Buffer.byteLength(line) > MAX_AUDIT_LINE_BYTES) throw new Error("Audit record exceeds the line limit.");
      if (stat.size + Buffer.byteLength(line) > MAX_AUDIT_LEDGER_BYTES || record.sequence > MAX_AUDIT_RECORDS) {
        throw new Error("Audit ledger capacity exceeded.");
      }
      writeAll(ledgerFd, line);
      fsyncSync(ledgerFd);
      options.fault?.("after-ledger-fsync");
      assertAuditLockOwned(lock);
    } finally {
      closeSync(ledgerFd);
    }
    writeAtomicHead(dir, signedHead(key, record), options.fault, () => assertAuditLockOwned(lock));
    return record;
  } finally {
    releaseAuditLock(lock);
  }
}

export interface ApprovalAuditLookup {
  requestId: string;
  runId: string;
  source: string;
  tool: string;
}

/** Read-only authorization lookup: only an intact HMAC chain can return a decision. */
export function readVerifiedApprovalAuditRecord(
  lookup: ApprovalAuditLookup,
  options: { dir?: string } = {}
): ApprovalAuditRecord | undefined {
  const scan = scanAuditStore(options.dir ?? defaultAuditDir());
  if (!scan.verification.ok) throw new Error(`Audit ledger verification failed: ${scan.verification.errors.join(" ")}`);
  return scan.records.find((record) =>
    record.requestId === lookup.requestId && record.runId === lookup.runId &&
    record.source === lookup.source && record.tool === lookup.tool
  );
}

export function exportApprovalAuditRecords(options: AuditExportOptions = {}): string {
  const scan = scanAuditStore(options.dir ?? defaultAuditDir());
  if (!scan.verification.ok) throw new Error(`Audit ledger verification failed: ${scan.verification.errors.join(" ")}`);
  const sinceText = options.since === undefined ? undefined : normalizeRfc3339(options.since, "since");
  const untilText = options.until === undefined ? undefined : normalizeRfc3339(options.until, "until");
  const since = sinceText === undefined ? undefined : Date.parse(sinceText);
  const until = untilText === undefined ? undefined : Date.parse(untilText);
  if (since !== undefined && until !== undefined && since > until) throw new Error("since must not be after until.");
  const rows = scan.records
    .filter((record) => options.decision === undefined || record.decision === options.decision)
    .filter((record) => options.source === undefined || record.source === options.source)
    .filter((record) => since === undefined || Date.parse(record.timestamp) >= since)
    .filter((record) => until === undefined || Date.parse(record.timestamp) <= until)
    .map(({ signature: _signature, recordHash: _recordHash, previousHash: _previousHash, ...record }) => record);
  return options.format === "json"
    ? `${JSON.stringify(rows, null, 2)}\n`
    : rows.map((record) => JSON.stringify(record)).join("\n") + (rows.length > 0 ? "\n" : "");
}
