import { chmodSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const flushes = vi.hoisted(() => ({ files: 0 }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, fsyncSync(fd: number) {
    if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error("directory flush unsupported"), { code: "EPERM" });
    flushes.files++;
    fs.fsyncSync(fd);
  } };
});
import { appendApprovalAuditRecord, verifyApprovalAuditLedger } from "../src/trust-ledger.js";
import { listPendingApprovals, writeApprovalRequest } from "../src/live-spool.js";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const roots: string[] = [];
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "quorate-platform-"));
  roots.push(path);
  return path;
}
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  flushes.files = 0;
});
function append(dir: string) {
  return appendApprovalAuditRecord({ requestId: "platform-test", runId: "run", source: "claude", tool: "Bash",
    decision: "deny", reasonCode: "user-denied", decisionSurface: "monitor-web", timestamp: "2026-10-01T00:00:00.000Z" }, { dir });
}
it("writes and verifies Windows audit records without directory fsync, while flushing files", () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  const dir = join(directory(), "audit");
  append(dir);
  expect(flushes.files).toBeGreaterThan(0);
  expect(verifyApprovalAuditLedger({ dir }).ok).toBe(true);
});
it.skipIf(process.platform === "win32")("does not swallow a POSIX directory fsync permission failure", () => {
  expect(() => append(join(directory(), "audit"))).toThrow("directory flush unsupported");
});
it("accepts Windows approval mode bits while keeping POSIX permissions and symlink checks", () => {
  const dir = directory();
  writeApprovalRequest({ id: "platform-test", runId: "run", source: "claude", toolName: "Bash", summary: "test", cwd: dir,
    createdAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:55.000Z" }, dir);
  const path = join(dir, "approvals", "platform-test.json");
  chmodSync(path, 0o644);
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  expect(listPendingApprovals(dir)).toHaveLength(1);
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  expect(listPendingApprovals(dir)).toHaveLength(0);
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  symlinkSync(path, join(dir, "approvals", "linked.json"));
  expect(listPendingApprovals(dir)).toHaveLength(1);
});
