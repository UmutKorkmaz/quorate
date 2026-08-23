import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  fstatSync,
  ftruncateSync,
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
const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP"]);

export type SecureStateFaultPoint = "after-temp-fsync" | "before-directory-fsync";

export interface SecureStateFaultContext {
  temporaryPath: string;
  parentPath: string;
  destinationPath: string;
}

/** Test-only interruption points for publication-race and directory-sync coverage. */
export interface SecureStateWriteOptions {
  fault?: (point: SecureStateFaultPoint, context: SecureStateFaultContext) => void;
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

interface TemporaryIdentity extends FileIdentity {
  mode: number;
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

function directoryIdentity(path: string, label: string): DirectoryIdentity {
  const entry = assertDirectory(path, label);
  return { path, dev: entry.dev, ino: entry.ino };
}

function privateDescendantDirectory(path: string, label: string): DirectoryIdentity {
  const identity = directoryIdentity(path, label);
  if (platform() !== "win32") chmodSync(path, DIRECTORY_MODE);
  return identity;
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
  // The caller's workspace is only revalidated: its permissions are user-owned.
  const directories = [directoryIdentity(workspace, "workspace root")];
  let current = workspace;
  for (const part of parts.slice(0, -1)) {
    const next = join(current, part);
    if (!isInside(workspace, next)) throw stateError("state directory resolves outside the workspace.");
    if (!optionalLstat(next)) mkdirSync(next, { mode: DIRECTORY_MODE });
    const identity = privateDescendantDirectory(next, `state directory '${part}'`);
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

function temporaryIdentity(fd: number): TemporaryIdentity {
  const entry = fstatSync(fd);
  const mode = entry.mode & 0o777;
  if (!entry.isFile()) throw stateError("temporary state descriptor is not a regular file.");
  if (platform() !== "win32" && mode !== FILE_MODE) throw stateError("temporary state descriptor is not owner-only.");
  return { dev: entry.dev, ino: entry.ino, mode };
}

function assertTemporaryDescriptor(fd: number, expected: TemporaryIdentity): void {
  const current = temporaryIdentity(fd);
  if (current.dev !== expected.dev || current.ino !== expected.ino || current.mode !== expected.mode) {
    throw stateError("temporary state descriptor changed while publishing state.");
  }
}

function assertTemporaryPathBound(path: string, expected: TemporaryIdentity): void {
  const current = optionalLstat(path);
  if (!current || current.isSymbolicLink() || !current.isFile() || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw stateError("temporary state file changed while publishing state.");
  }
}

function assertDestinationMatchesTemporary(path: string, expected: TemporaryIdentity): void {
  const current = destinationIdentity(path);
  if (!current || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw stateError("state destination changed before publication could be confirmed.");
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

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function fsyncDirectory(path: string, options: SecureStateWriteOptions, context: SecureStateFaultContext): void {
  if (platform() === "win32") return;
  let fd: number | undefined;
  try {
    options.fault?.("before-directory-fsync", context);
    fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    fsyncSync(fd);
  } catch (error: unknown) {
    if (UNSUPPORTED_DIRECTORY_SYNC_CODES.has(errorCode(error) ?? "")) return;
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function removeTemporaryIfStillOwned(path: string, expected: TemporaryIdentity): void {
  try {
    const current = optionalLstat(path);
    if (current?.isFile() && !current.isSymbolicLink() && current.dev === expected.dev && current.ino === expected.ino) {
      rmSync(path);
    }
  } catch {
    // Cleanup is best effort, but never removes a path whose identity we did not prove.
  }
}

function canonicalWorkspace(workspaceCwd: string): string {
  const workspace = realpathSync(resolve(workspaceCwd));
  assertDirectory(workspace, "workspace root");
  return workspace;
}

/** Validate every fixed target before a multi-file publisher changes any of them. */
export function preflightSecureWorkspaceState(workspaceCwd: string, targets: readonly string[]): void {
  const workspace = canonicalWorkspace(workspaceCwd);
  for (const target of targets) {
    const parts = assertRelativeTarget(target);
    const { parent, directories } = ensurePrivateParent(workspace, parts);
    for (const directory of directories) assertDirectoryIdentity(directory, workspace);
    destinationIdentity(join(parent, parts.at(-1)!));
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
  const workspace = canonicalWorkspace(workspaceCwd);
  const { parent, directories } = ensurePrivateParent(workspace, parts);
  const destination = join(parent, parts.at(-1)!);
  const expectedDestination = destinationIdentity(destination);
  const temporary = join(parent, `.quorate-state-${process.pid}-${randomBytes(12).toString("hex")}.tmp`);
  const context: SecureStateFaultContext = { temporaryPath: temporary, parentPath: parent, destinationPath: destination };
  let fd: number | undefined;
  let temp: TemporaryIdentity | undefined;
  let publicationConfirmed = false;

  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, FILE_MODE);
    if (platform() !== "win32") fchmodSync(fd, FILE_MODE);
    temp = temporaryIdentity(fd);
    writeAll(fd, content);
    fsyncSync(fd);
    options.fault?.("after-temp-fsync", context);
    assertTemporaryDescriptor(fd, temp);
    assertTemporaryPathBound(temporary, temp);
    for (const directory of directories) assertDirectoryIdentity(directory, workspace);
    assertDestinationIdentity(destination, expectedDestination);
    renameSync(temporary, destination);
    assertTemporaryDescriptor(fd, temp);
    assertDestinationMatchesTemporary(destination, temp);
    publicationConfirmed = true;
    fsyncDirectory(parent, options, context);
  } finally {
    if (fd !== undefined) {
      if (!publicationConfirmed) {
        try {
          ftruncateSync(fd, 0);
        } catch {
          // Preserve the original publication failure; the path cleanup below remains identity-bound.
        }
      }
      closeSync(fd);
    }
    if (!publicationConfirmed && temp) removeTemporaryIfStillOwned(temporary, temp);
  }
}
