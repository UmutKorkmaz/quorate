import { chmodSync, rmSync, writeFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { appendApprovalAuditRecord, auditLockPath, verifyApprovalAuditLedger } from "../src/trust-ledger.js";

const MODULE_URL = pathToFileURL(resolve("packages/cli/src/trust-ledger.ts")).href;
const CHILD_TIMEOUT = 15_000;
const PRE_KEY_PUBLICATION_BOUNDARIES = [
  "after-init-key-temp-create",
  "after-init-key-partial-write",
  "after-init-key-temp-fsync"
] as const;
const INIT_BOUNDARIES = [
  "after-key-fsync",
  "after-head-temp-fsync",
  "after-head-rename",
  "after-genesis-head-fsync",
  "after-key-publish",
  "after-key-publish-fsync"
] as const;

function root(): string {
  return mkdtempSync(join(tmpdir(), "quorate-audit-process-"));
}

function launch(
  script: string,
  env: Record<string, string>,
  timeoutMs = CHILD_TIMEOUT
): { child: ChildProcess; done: Promise<{ code: number | null; stderr: string }> } {
  const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const done = new Promise<{ code: number | null; stderr: string }>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); rejectPromise(new Error(`child timeout: ${stderr}`)); }, timeoutMs);
    child.once("exit", (code) => { clearTimeout(timer); resolvePromise({ code, stderr }); });
    child.once("error", (error) => { clearTimeout(timer); rejectPromise(error); });
  });
  return { child, done };
}

async function waitFor(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

const APPEND_SCRIPT = `
  import { existsSync, writeFileSync } from 'node:fs';
  import { join } from 'node:path';
  const ledger = await import(${JSON.stringify(MODULE_URL)});
  writeFileSync(join(process.env.ROOT, 'ready-' + process.env.WORKER), '');
  const sleep = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(join(process.env.ROOT, 'go'))) Atomics.wait(sleep, 0, 0, 5);
  try {
    ledger.appendApprovalAuditRecord({
      requestId: process.env.REQUEST_ID, runId: 'run-' + process.env.WORKER, source: 'claude', tool: 'Bash',
      decision: 'allow', decisionSurface: 'process-test', timestamp: '2026-07-28T09:00:00.000Z'
    }, { dir: process.env.AUDIT_DIR });
    process.exit(0);
  } catch (error) {
    process.exit(error?.name === 'DuplicateApprovalDecisionError' ? 2 : 1);
  }
`;

describe("cross-process audit serialization", () => {
  it("serializes simultaneous writers into one contiguous signed chain", async () => {
    const dirRoot = root();
    const auditDir = join(dirRoot, "audit");
    const workers = Array.from({ length: 8 }, (_, index) =>
      launch(APPEND_SCRIPT, { ROOT: dirRoot, AUDIT_DIR: auditDir, WORKER: String(index), REQUEST_ID: `ap-${index}` })
    );
    await Promise.all(workers.map((_, index) => waitFor(join(dirRoot, `ready-${index}`))));
    writeFileSync(join(dirRoot, "go"), "");

    const results = await Promise.all(workers.map((worker) => worker.done));

    expect(results.map((result) => result.code)).toEqual(Array(8).fill(0));
    expect(verifyApprovalAuditLedger({ dir: auditDir })).toMatchObject({ ok: true, records: 8, headSequence: 8 });
  }, 30_000);

  it("allows only one terminal winner for simultaneous identical request ids", async () => {
    const dirRoot = root();
    const auditDir = join(dirRoot, "audit");
    const workers = Array.from({ length: 4 }, (_, index) =>
      launch(APPEND_SCRIPT, { ROOT: dirRoot, AUDIT_DIR: auditDir, WORKER: String(index), REQUEST_ID: "ap-shared" })
    );
    await Promise.all(workers.map((_, index) => waitFor(join(dirRoot, `ready-${index}`))));
    writeFileSync(join(dirRoot, "go"), "");

    const results = await Promise.all(workers.map((worker) => worker.done));

    expect(results.filter((result) => result.code === 0)).toHaveLength(1);
    expect(results.filter((result) => result.code === 2)).toHaveLength(3);
    expect(verifyApprovalAuditLedger({ dir: auditDir })).toMatchObject({ ok: true, records: 1 });
  }, 30_000);

  it("recovers a lock whose owning child process was killed", async () => {
    const dirRoot = root();
    const auditDir = join(dirRoot, "audit");
    const ready = join(dirRoot, "lock-ready");
    const child = launch(`
      import { writeFileSync } from 'node:fs';
      const ledger = await import(${JSON.stringify(MODULE_URL)});
      const sleep = new Int32Array(new SharedArrayBuffer(4));
      ledger.appendApprovalAuditRecord({ requestId: 'never', runId: 'run', source: 'claude', tool: 'Bash', decision: 'allow', decisionSurface: 'test', timestamp: '2026-07-28T09:00:00.000Z' }, {
        dir: process.env.AUDIT_DIR,
        fault: (point) => { if (point === 'after-lock-acquire') { writeFileSync(process.env.READY, ''); while (true) Atomics.wait(sleep, 0, 0, 1000); } }
      });
    `, { AUDIT_DIR: auditDir, READY: ready });
    await waitFor(ready);
    child.child.kill("SIGKILL");
    await child.done;

    appendApprovalAuditRecord({
      requestId: "ap-after-kill", runId: "run", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "test", timestamp: "2026-07-28T09:00:01.000Z"
    }, { dir: auditDir });

    expect(verifyApprovalAuditLedger({ dir: auditDir })).toMatchObject({ ok: true, records: 1 });
  }, 30_000);

  it.each(PRE_KEY_PUBLICATION_BOUNDARIES)("never exposes a recoverable key when a child is killed at %s", async (point) => {
    const dirRoot = root();
    const auditDir = join(dirRoot, "audit");
    const ready = join(dirRoot, `init-${point}`);
    const child = launch(`
      import { writeFileSync } from 'node:fs';
      const ledger = await import(${JSON.stringify(MODULE_URL)});
      const sleep = new Int32Array(new SharedArrayBuffer(4));
      ledger.appendApprovalAuditRecord({ requestId: 'never', runId: 'run', source: 'claude', tool: 'Bash', decision: 'allow', decisionSurface: 'test', timestamp: '2026-07-28T09:00:00.000Z' }, {
        dir: process.env.AUDIT_DIR,
        fault: (at) => { if (at === process.env.POINT) { writeFileSync(process.env.READY, ''); while (true) Atomics.wait(sleep, 0, 0, 1000); } }
      });
    `, { AUDIT_DIR: auditDir, READY: ready, POINT: point });
    await waitFor(ready);
    child.child.kill("SIGKILL");
    const killed = await child.done;

    expect(killed.code).toBeNull();
    expect(existsSync(join(auditDir, "approvals.key.init"))).toBe(false);
    expect(existsSync(join(auditDir, "approvals.key"))).toBe(false);
    expect(existsSync(join(auditDir, "approvals.head.json"))).toBe(false);
    expect(existsSync(join(auditDir, "approvals.jsonl"))).toBe(false);

    appendApprovalAuditRecord({
      requestId: `after-${point}`, runId: "run", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "test", timestamp: "2026-07-28T09:00:01.000Z"
    }, { dir: auditDir });
    expect(verifyApprovalAuditLedger({ dir: auditDir })).toMatchObject({ ok: true, records: 1, headSequence: 1 });
  }, 30_000);

  it.each(INIT_BOUNDARIES)("recovers initialization after a child is killed at %s", async (point) => {
    const dirRoot = root();
    const auditDir = join(dirRoot, "audit");
    const ready = join(dirRoot, `init-${point}`);
    const child = launch(`
      import { writeFileSync } from 'node:fs';
      const ledger = await import(${JSON.stringify(MODULE_URL)});
      const sleep = new Int32Array(new SharedArrayBuffer(4));
      ledger.appendApprovalAuditRecord({ requestId: 'never', runId: 'run', source: 'claude', tool: 'Bash', decision: 'allow', decisionSurface: 'test', timestamp: '2026-07-28T09:00:00.000Z' }, {
        dir: process.env.AUDIT_DIR,
        fault: (at) => { if (at === process.env.POINT) { writeFileSync(process.env.READY, ''); while (true) Atomics.wait(sleep, 0, 0, 1000); } }
      });
    `, { AUDIT_DIR: auditDir, READY: ready, POINT: point });
    await waitFor(ready);
    child.child.kill("SIGKILL");
    const killed = await child.done;

    expect(killed.code).toBeNull();
    const provisional = join(auditDir, "approvals.key.init");
    const finalKey = join(auditDir, "approvals.key");
    const published = point === "after-key-publish" || point === "after-key-publish-fsync";
    expect(existsSync(provisional)).toBe(!published);
    expect(existsSync(finalKey)).toBe(published);
    if (published) expect(existsSync(join(auditDir, "approvals.head.json"))).toBe(true);
    const interruptedKey = readFileSync(published ? finalKey : provisional);
    expect(interruptedKey).toHaveLength(32);

    appendApprovalAuditRecord({
      requestId: `after-${point}`, runId: "run", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "test", timestamp: "2026-07-28T09:00:01.000Z"
    }, { dir: auditDir });

    expect(readFileSync(finalKey)).toEqual(interruptedKey);
    expect(existsSync(provisional)).toBe(false);
    expect(verifyApprovalAuditLedger({ dir: auditDir })).toMatchObject({ ok: true, records: 1, headSequence: 1 });
  }, 30_000);

  it("detects lock pathname replacement before a durable ledger write", async () => {
    const dirRoot = root();
    const auditDir = join(dirRoot, "audit");
    const ready = join(dirRoot, "replace-ready");
    const proceed = join(dirRoot, "replace-go");
    const child = launch(`
      import { existsSync, writeFileSync } from 'node:fs';
      const ledger = await import(${JSON.stringify(MODULE_URL)});
      const sleep = new Int32Array(new SharedArrayBuffer(4));
      try {
        ledger.appendApprovalAuditRecord({ requestId: 'ap-replaced', runId: 'run', source: 'claude', tool: 'Bash', decision: 'allow', decisionSurface: 'test', timestamp: '2026-07-28T09:00:00.000Z' }, {
          dir: process.env.AUDIT_DIR,
          fault: (point) => { if (point === 'after-lock-acquire') { writeFileSync(process.env.READY, ''); while (!existsSync(process.env.PROCEED)) Atomics.wait(sleep, 0, 0, 5); } }
        });
        process.exit(0);
      } catch { process.exit(1); }
    `, { AUDIT_DIR: auditDir, READY: ready, PROCEED: proceed });
    await waitFor(ready);
    rmSync(auditLockPath(auditDir), { force: true });
    writeFileSync(auditLockPath(auditDir), `${JSON.stringify({
      token: "f".repeat(32), pid: process.pid,
      createdAt: new Date().toISOString(), leaseUntil: new Date(Date.now() + 60_000).toISOString()
    })}\n`, { mode: 0o600 });
    writeFileSync(proceed, "");

    const result = await child.done;

    expect(result.code).toBe(1);
    expect(verifyApprovalAuditLedger({ dir: auditDir }).records).toBe(0);
    rmSync(auditLockPath(auditDir), { force: true });
  }, 30_000);

  it.each(["after-lock-temp-create", "after-lock-partial-write"] as const)(
    "a child killed at %s never publishes a partial lock pathname",
    async (point) => {
      const dirRoot = root();
      const auditDir = join(dirRoot, "audit");
      const started = join(dirRoot, "lock-started");
      const child = launch(`
        import { writeFileSync } from 'node:fs';
        const ledger = await import(${JSON.stringify(MODULE_URL)});
        const sleep = new Int32Array(new SharedArrayBuffer(4));
        ledger.appendApprovalAuditRecord({ requestId: 'partial', runId: 'run', source: 'claude', tool: 'Bash', decision: 'allow', decisionSurface: 'test', timestamp: '2026-07-28T09:00:00.000Z' }, {
          dir: process.env.AUDIT_DIR,
          fault: (at) => { if (at === process.env.POINT) { writeFileSync(process.env.STARTED, ''); while (true) Atomics.wait(sleep, 0, 0, 1000); } }
        });
      `, { AUDIT_DIR: auditDir, STARTED: started, POINT: point });
      await waitFor(started);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      child.child.kill("SIGKILL");
      const killed = await child.done;

      expect(killed.code).toBeNull();
      expect(existsSync(auditLockPath(auditDir))).toBe(false);
      appendApprovalAuditRecord({
        requestId: "after-partial-lock", runId: "run", source: "claude", tool: "Bash", decision: "allow",
        decisionSurface: "test", timestamp: "2026-07-28T09:00:01.000Z"
      }, { dir: auditDir });
      expect(verifyApprovalAuditLedger({ dir: auditDir })).toMatchObject({ ok: true, records: 1 });
    },
    30_000
  );

  it.each([
    ["malformed", "{\"token\":"],
    ["unbounded-future", `${JSON.stringify({
      token: "e".repeat(32), pid: process.pid,
      createdAt: new Date().toISOString(), leaseUntil: "2099-01-01T00:00:00.000Z"
    })}\n`]
  ] as const)("reaps a stable stale %s lock without deleting a successor", (_kind, content) => {
    const dirRoot = root();
    const auditDir = join(dirRoot, "audit");
    // Initialize a valid genesis/store, then plant a stale lock artifact.
    appendApprovalAuditRecord({
      requestId: "seed", runId: "run", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "test", timestamp: "2026-07-28T09:00:00.000Z"
    }, { dir: auditDir });
    writeFileSync(auditLockPath(auditDir), content, { mode: 0o600 });
    const old = new Date(Date.now() - 60_000);
    utimesSync(auditLockPath(auditDir), old, old);

    appendApprovalAuditRecord({
      requestId: "after-stale", runId: "run", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "test", timestamp: "2026-07-28T09:00:01.000Z"
    }, { dir: auditDir });

    expect(verifyApprovalAuditLedger({ dir: auditDir })).toMatchObject({ ok: true, records: 2 });
  }, 15_000);

  it("reaps a stable stale oversized regular lock", () => {
    const dirRoot = root();
    const auditDir = join(dirRoot, "audit");
    appendApprovalAuditRecord({
      requestId: "seed", runId: "run", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "test", timestamp: "2026-07-28T09:00:00.000Z"
    }, { dir: auditDir });
    writeFileSync(auditLockPath(auditDir), Buffer.alloc(70 * 1024, 0x41), { mode: 0o600 });
    const old = new Date(Date.now() - 60_000);
    utimesSync(auditLockPath(auditDir), old, old);

    appendApprovalAuditRecord({
      requestId: "after-oversized", runId: "run", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "test", timestamp: "2026-07-28T09:00:01.000Z"
    }, { dir: auditDir });

    expect(verifyApprovalAuditLedger({ dir: auditDir })).toMatchObject({ ok: true, records: 2 });
  }, 15_000);

  it("reaps a stable malformed lock whose mtime is implausibly in the future", () => {
    const dirRoot = root();
    const auditDir = join(dirRoot, "audit");
    appendApprovalAuditRecord({
      requestId: "seed", runId: "run", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "test", timestamp: "2026-07-28T09:00:00.000Z"
    }, { dir: auditDir });
    writeFileSync(auditLockPath(auditDir), "{\"token\":", { mode: 0o600 });
    const future = new Date(Date.now() + 60_000);
    utimesSync(auditLockPath(auditDir), future, future);

    appendApprovalAuditRecord({
      requestId: "after-future-mtime", runId: "run", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "test", timestamp: "2026-07-28T09:00:01.000Z"
    }, { dir: auditDir });

    expect(verifyApprovalAuditLedger({ dir: auditDir })).toMatchObject({ ok: true, records: 2 });
  }, 15_000);

  it.skipIf(process.platform === "win32")("bounds a FIFO lock during verification and append without deleting it", async () => {
    const dirRoot = root();
    const auditDir = join(dirRoot, "audit");
    appendApprovalAuditRecord({
      requestId: "seed", runId: "run", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "test", timestamp: "2026-07-28T09:00:00.000Z"
    }, { dir: auditDir });
    const lockPath = auditLockPath(auditDir);
    execFileSync("mkfifo", [lockPath]);
    chmodSync(lockPath, 0o600);

    const verifyResult = join(dirRoot, "fifo-verify.json");
    const verifier = launch(`
      import { writeFileSync } from 'node:fs';
      const ledger = await import(${JSON.stringify(MODULE_URL)});
      const verification = ledger.verifyApprovalAuditLedger({ dir: process.env.AUDIT_DIR });
      writeFileSync(process.env.RESULT, JSON.stringify(verification));
    `, { AUDIT_DIR: auditDir, RESULT: verifyResult }, 1_500);
    const verified = await verifier.done;

    expect(verified.code).toBe(0);
    expect(JSON.parse(readFileSync(verifyResult, "utf8"))).toMatchObject({
      ok: false,
      records: 1,
      headSequence: 1,
      errors: [expect.stringContaining("approvals.lock is not a regular file")]
    });

    const appendResult = join(dirRoot, "fifo-append.json");
    const appender = launch(`
      import { writeFileSync } from 'node:fs';
      const ledger = await import(${JSON.stringify(MODULE_URL)});
      try {
        ledger.appendApprovalAuditRecord({
          requestId: 'must-not-append', runId: 'run', source: 'claude', tool: 'Bash', decision: 'allow',
          decisionSurface: 'test', timestamp: '2026-07-28T09:00:01.000Z'
        }, { dir: process.env.AUDIT_DIR });
        writeFileSync(process.env.RESULT, JSON.stringify({ appended: true }));
      } catch (error) {
        writeFileSync(process.env.RESULT, JSON.stringify({ appended: false, error: error?.message ?? String(error) }));
      }
    `, { AUDIT_DIR: auditDir, RESULT: appendResult }, 12_000);
    const appended = await appender.done;

    expect(appended.code).toBe(0);
    expect(JSON.parse(readFileSync(appendResult, "utf8"))).toEqual({
      appended: false,
      error: "Timed out waiting for the audit ledger lock."
    });
    expect(lstatSync(lockPath).isFIFO()).toBe(true);
  }, 15_000);

  it("never deletes a successor that replaces an observed oversized lock inode", () => {
    const dirRoot = root();
    const auditDir = join(dirRoot, "audit");
    appendApprovalAuditRecord({
      requestId: "seed", runId: "run", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "test", timestamp: "2026-07-28T09:00:00.000Z"
    }, { dir: auditDir });
    const path = auditLockPath(auditDir);
    writeFileSync(path, Buffer.alloc(70 * 1024, 0x41), { mode: 0o600 });
    const old = new Date(Date.now() - 60_000);
    utimesSync(path, old, old);
    const created = new Date();
    const successor = `${JSON.stringify({
      token: "d".repeat(32), pid: process.pid,
      createdAt: created.toISOString(), leaseUntil: new Date(created.getTime() + 15_000).toISOString()
    })}\n`;
    let replaced = false;

    expect(() => appendApprovalAuditRecord({
      requestId: "must-not-append", runId: "run", source: "claude", tool: "Bash", decision: "allow",
      decisionSurface: "test", timestamp: "2026-07-28T09:00:01.000Z"
    }, {
      dir: auditDir,
      fault: (point) => {
        if ((point as string) === "after-lock-quarantine-rename" && !replaced) {
          writeFileSync(path, successor, { mode: 0o600 });
          replaced = true;
        }
        if ((point as string) === "after-malformed-lock-reap") throw new Error("stop-after-reap");
      }
    })).toThrow("stop-after-reap");

    expect(replaced).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(successor);
    rmSync(path);
    expect(verifyApprovalAuditLedger({ dir: auditDir })).toMatchObject({ ok: true, records: 1 });
  }, 15_000);
});
