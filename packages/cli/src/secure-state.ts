import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
  type Stats
} from "node:fs";
import { platform } from "node:os";
import { isAbsolute, join, relative, resolve, win32 } from "node:path";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export type SecureStateFaultPoint = "after-temp-fsync";

/** Test-only interruption point for proving that an uncommitted temp is never published. */
export interface SecureStateWriteOptions {
  fault?: (point: SecureStateFaultPoint) => void;
}

interface DirectoryIdentity {
  path: string;
  dev: number;
  ino: number;
}

interface FileIdentity {
  dev: number;
  ino: number;
}

function optionalLstat(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function stateError(message: string): Error {
  return new Error(`Secure workspace state rejected: ${message}`);
}

function isInside(workspace: string, candidate: string): boolean {
  const segment = relative(workspace, candidate);
  return segment === "" || (!segment.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && segment !== ".." && !isAbsolute(segment));
}

function assertRelativeTarget(target: string): string[] {
  if (!target || target === "." || isAbsolute(target) || win32.isAbsolute(target)) {
    throw stateError("a non-empty fixed relative target is required.");
  }
  const parts = target.split(/[\\/]/);
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw stateError("a fixed relative target cannot contain empty, '.' or '..' path components.");
  }
  return parts;
}

function assertDirectory(path: string, label: string): Stats {
  const entry = optionalLstat(path);
  if (!entry) throw stateError(`${label} disappeared while publishing state.`);
  if (entry.isSymbolicLink()) throw stateError(`${label} is a symbolic link.`);
  if (!entry.isDirectory()) throw stateError(`${label} is not a directory.`);
  return entry;
}

function privateDirectory(path: string, label: string): DirectoryIdentity {
  const entry = assertDirectory(path, label);
  if (platform() !== "win32") chmodSync(path, DIRECTORY_MODE);
  return { path, dev: entry.dev, ino: entry.ino };
}

function assertDirectoryIdentity(directory: DirectoryIdentity, workspace: string): void {
  const current = assertDirectory(directory.path, "state directory");
  if (current.dev !== directory.dev || current.ino !== directory.ino) {
    throw stateError("a state directory changed while publishing state.");
  }
  const resolved = realpathSync(directory.path);
  if (!isInside(workspace, resolved)) throw stateError("a state directory resolves outside the workspace.");
}

function ensurePrivateParent(workspace: string, parts: string[]): { parent: string; directories: DirectoryIdentity[] } {
  const directories = [privateDirectory(workspace, "workspace root")];
  let current = workspace;
  for (const part of parts.slice(0, -1)) {
    const next = join(current, part);
    if (!isInside(workspace, next)) throw stateError("state directory resolves outside the workspace.");
    if (!optionalLstat(next)) mkdirSync(next, { mode: DIRECTORY_MODE });
    const identity = privateDirectory(next, `state directory '${part}'`);
    const resolved = realpathSync(next);
    if (!isInside(workspace, resolved)) throw stateError(`state directory '${part}' resolves outside the workspace.`);
    directories.push(identity);
    current = next;
  }
  return { parent: current, directories };
}

function destinationIdentity(path: string): FileIdentity | undefined {
  const entry = optionalLstat(path);
  if (!entry) return undefined;
  if (entry.isSymbolicLink()) throw stateError("state destination is a symbolic link.");
  if (!entry.isFile()) throw stateError("state destination is not a regular file.");
  return { dev: entry.dev, ino: entry.ino };
}

function assertDestinationIdentity(path: string, expected: FileIdentity | undefined): void {
  const current = destinationIdentity(path);
  if (!expected && !current) return;
  if (!expected || !current || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw stateError("state destination changed while publishing state.");
  }
}

function writeAll(fd: number, content: string): void {
  const bytes = Buffer.from(content, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) throw stateError("temporary state file could not be completely written.");
    offset += written;
  }
}

function fsyncDirectory(path: string): void {
  if (platform() === "win32") return;
  const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Atomically replace one Quorate-owned, fixed state file beneath a canonical
 * workspace. Arbitrary user-selected export paths intentionally do not use it.
 */
export function writeSecureWorkspaceState(
  workspaceCwd: string,
  target: string,
  content: string,
  options: SecureStateWriteOptions = {}
): void {
  const parts = assertRelativeTarget(target);
  const workspace = realpathSync(resolve(workspaceCwd));
  const workspaceEntry = assertDirectory(workspace, "workspace root");
  if (!workspaceEntry.isDirectory()) throw stateError("workspace root is not a directory.");

  const { parent, directories } = ensurePrivateParent(workspace, parts);
  const destination = join(parent, parts.at(-1)!);
  const expectedDestination = destinationIdentity(destination);
  const temporary = join(parent, `.quorate-state-${process.pid}-${randomBytes(12).toString("hex")}.tmp`);
  let fd: number | undefined;

  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, FILE_MODE);
    if (platform() !== "win32") chmodSync(temporary, FILE_MODE);
    writeAll(fd, content);
    fsyncSync(fd);
    options.fault?.("after-temp-fsync");
    for (const directory of directories) assertDirectoryIdentity(directory, workspace);
    assertDestinationIdentity(destination, expectedDestination);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, destination);
    fsyncDirectory(parent);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}
