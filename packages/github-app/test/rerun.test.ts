import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "@octokit/rest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReviewDeps, isCheckRerunEvent, isLatestReviewJob, ReviewJobStore, ReviewQueue, runStoredReviewJob } from "../src/server.js";

describe("isCheckRerunEvent", () => {
  it("fires on GitHub's native re-run (rerequested)", () => {
    expect(isCheckRerunEvent({ action: "rerequested" })).toBe(true);
  });
  it("fires on our custom requested_action with identifier 'rerun'", () => {
    expect(isCheckRerunEvent({ action: "requested_action", requested_action: { identifier: "rerun" } })).toBe(true);
  });
  it("ignores other requested_action identifiers", () => {
    expect(isCheckRerunEvent({ action: "requested_action", requested_action: { identifier: "other" } })).toBe(false);
  });
  it("ignores unrelated actions (created/completed)", () => {
    expect(isCheckRerunEvent({ action: "created" })).toBe(false);
    expect(isCheckRerunEvent({ action: "completed" })).toBe(false);
  });
});

describe("trusted App wiring", () => {
  it("keeps a current-base review when delayed obsolete-base or unresolved rerun deliveries arrive", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quorate-app-order-"));
    try {
      const store = new ReviewJobStore(directory);
      await store.initialize();
      const input = { installationId: 1, owner: "acme", repo: "web", pullNumber: 1, headSha: "head", baseSha: "current-base" };
      await store.accept({ ...input, id: "current" });
      await store.accept({ ...input, id: "rerun", baseSha: undefined });
      await store.accept({ ...input, id: "delayed", baseSha: "old-base" });
      const octokit = {
        rest: { pulls: { get: async () => ({ data: { state: "open", head: { sha: "head" }, base: { sha: "current-base" } } }) } }
      } as unknown as Octokit;
      const current = createReviewDeps(octokit, input, () => isLatestReviewJob(store.entries, "current"));
      const obsolete = createReviewDeps(octokit, { ...input, baseSha: "old-base" }, () => isLatestReviewJob(store.entries, "delayed"));
      expect(await current.isCurrent!()).toBe(true);
      expect(await obsolete.isCurrent!()).toBe(false);
      await store.update("rerun", { baseSha: "current-base" });
      expect(await current.isCurrent!()).toBe(false);
      expect(isLatestReviewJob(store.entries, "rerun")).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("loads every trusted gate from the same immutable base SHA", async () => {
    const requested: Array<{ path: string; ref: string }> = [];
    const octokit = { rest: {
      repos: { getContent: async (params: { path: string; ref: string }) => {
        requested.push(params);
        throw Object.assign(new Error("missing"), { status: 404 });
      } },
      pulls: { get: async () => ({ data: { state: "open", head: { sha: "head" }, base: { sha: "base-sha" } } }) }
    } } as unknown as Octokit;
    const deps = createReviewDeps(octokit, { owner: "acme", repo: "web", pullNumber: 1, headSha: "head", baseSha: "base-sha" });
    await deps.getConfig!();
    await deps.getPolicy!();
    await deps.getBaseline!();
    await deps.getSuppressions!();
    expect(requested.map((request) => request.path)).toEqual(expect.arrayContaining([
      ".quorate.yml", ".quorate/packs", ".quorate/policy.yml", ".quorate.baseline.json", ".quorate/suppressions.json"
    ]));
    expect(requested.every((request) => request.ref === "base-sha")).toBe(true);
    expect(await deps.isCurrent!()).toBe(true);
  });
});

describe("ReviewQueue", () => {
  it("deduplicates deliveries, serializes each PR, and marks older work stale", async () => {
    const queue = new ReviewQueue(2);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let latest!: () => boolean;
    const first = queue.enqueue("delivery-1", "repo/1", async (current) => { latest = current; await blocked; });
    await Promise.resolve();
    const duplicate = vi.fn();
    expect(queue.enqueue("delivery-1", "repo/1", duplicate)).toBe(first);
    const next = vi.fn(async () => {});
    const second = queue.enqueue("delivery-2", "repo/1", next);
    const other = vi.fn(async () => {});
    await queue.enqueue("delivery-3", "repo/2", other);
    expect(other).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    expect(latest()).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(next).toHaveBeenCalledOnce();
    expect(duplicate).not.toHaveBeenCalled();
    await queue.drain();
    expect(() => queue.enqueue("delivery-4", "repo/3", other)).toThrow("unavailable");
  });

  it("rejects saturation without admitting more work and permits failed delivery retries", async () => {
    const queue = new ReviewQueue(1, 1);
    let release!: () => void;
    const first = queue.enqueue("delivery-1", "repo/1", () => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();
    expect(() => queue.enqueue("delivery-2", "repo/2", async () => {})).toThrow("unavailable");
    release();
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    await expect(queue.enqueue("delivery-2", "repo/2", async () => { throw new Error("transient"); })).rejects.toThrow("transient");
    await new Promise((resolve) => setImmediate(resolve));
    await expect(queue.enqueue("delivery-2", "repo/2", async () => {})).resolves.toBeUndefined();
  });
});

describe("durable review jobs", () => {
  const identity = { id: "delivery-1", owner: "acme", repo: "web", installationId: 7, pullNumber: 1, headSha: "head", baseSha: "base" };

  it("recovers interrupted work with its check ID and stores no extra payload fields", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quorate-app-spool-"));
    try {
      const store = new ReviewJobStore(directory);
      await store.initialize();
      await store.accept({ ...identity, body: "must never persist", token: "must never persist" } as typeof identity);
      await store.update(identity.id, { status: "running", attempts: 1, checkRunId: 42 });
      const files = await readdir(directory);
      expect(files).toHaveLength(1);
      const stored = await readFile(join(directory, files[0]), "utf8");
      expect(stored).not.toContain("must never persist");
      if (process.platform !== "win32") expect((await stat(join(directory, files[0]))).mode & 0o777).toBe(0o600);
      const recovered = new ReviewJobStore(directory);
      await recovered.initialize();
      expect(recovered.entries).toMatchObject([{ id: identity.id, status: "queued", checkRunId: 42 }]);
      await recovered.accept(identity);
      expect(recovered.entries).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("reconciles a remotely completed check after a crash before its ID was recorded", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quorate-app-spool-"));
    try {
      const store = new ReviewJobStore(directory);
      await store.initialize();
      await store.accept(identity);
      const job = await store.update(identity.id, { status: "running", attempts: 1 });
      const create = vi.fn();
      const octokit = {
        paginate: vi.fn(async () => [{ id: 42, external_id: identity.id }]),
        rest: {
          pulls: { get: async () => ({ data: { title: "Current", state: "open", head: { sha: "head" }, base: { sha: "base" } } }) },
          checks: { listForRef: {}, get: async () => ({ data: { status: "completed" } }), create }
        }
      } as unknown as Octokit;
      await runStoredReviewJob(job, octokit, store, () => true);
      expect(create).not.toHaveBeenCalled();
      expect(octokit.paginate).toHaveBeenCalledOnce();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("cancels an interrupted check when the PR moved, without loading config or running providers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quorate-app-spool-"));
    try {
      const store = new ReviewJobStore(directory);
      await store.initialize();
      await store.accept(identity);
      const job = await store.update(identity.id, { status: "running", attempts: 1, checkRunId: 42 });
      const update = vi.fn(async () => ({}));
      const create = vi.fn();
      const octokit = { rest: {
        pulls: { get: async () => ({ data: { title: "Current", state: "open", head: { sha: "new-head" }, base: { sha: "base" } } }) },
        checks: { get: async () => ({ data: { status: "in_progress" } }), update, create }
      } } as unknown as Octokit;
      await runStoredReviewJob(job, octokit, store, () => true);
      expect(create).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ check_run_id: 42, conclusion: "cancelled" }));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("retries an internal-error check instead of treating that completed failure as job success", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quorate-app-spool-"));
    try {
      const store = new ReviewJobStore(directory);
      await store.initialize();
      await store.accept(identity);
      const job = await store.update(identity.id, { status: "running", attempts: 2, checkRunId: 42 });
      const create = vi.fn(async () => ({ data: { id: 43 } }));
      const update = vi.fn(async () => ({}));
      const octokit = { rest: {
        pulls: { get: async () => ({ data: { title: "Current", state: "open", head: { sha: "new-head" }, base: { sha: "base" } } }) },
        checks: { get: async () => ({ data: { status: "completed", conclusion: "failure", output: { title: "Quorate: internal error" } } }), create, update }
      } } as unknown as Octokit;
      await runStoredReviewJob(job, octokit, store, () => true);
      expect(create).toHaveBeenCalledOnce();
      expect(store.entries[0].checkRunId).toBe(43);
      // Retrying still checks the current PR and cancels obsolete work.
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ check_run_id: 43, conclusion: "cancelled" }));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("keeps a completed policy failure terminal rather than rerunning the council", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quorate-app-spool-"));
    try {
      const store = new ReviewJobStore(directory);
      await store.initialize();
      await store.accept(identity);
      const job = await store.update(identity.id, { status: "running", attempts: 2, checkRunId: 42 });
      const create = vi.fn();
      const octokit = { rest: {
        pulls: { get: async () => ({ data: { title: "Current", head: { sha: "head" }, base: { sha: "base" } } }) },
        checks: { get: async () => ({ data: { status: "completed", conclusion: "failure", output: { title: "Quorate: FAIL" } } }), create }
      } } as unknown as Octokit;
      await runStoredReviewJob(job, octokit, store, () => true);
      expect(create).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
