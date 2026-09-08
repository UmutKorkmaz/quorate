/**
 * GitHub App HTTP server.
 *
 * Listens for webhook events from GitHub and calls reviewPullRequest for:
 * - pull_request (opened / synchronize / reopened)
 * - check_run.rerequested (native re-run) and requested_action (our "rerun" button)
 *
 * Authentication uses @octokit/auth-app (App JWT + installation token).
 * Webhook signature verification is handled by @octokit/webhooks.
 */

import { createServer } from "node:http";
import { constants, readFileSync } from "node:fs";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import {
  applyCustomPackDefinitions, DEFAULT_BASELINE_PATH, DEFAULT_POLICY_PATH,
  DEFAULT_SUPPRESSION_PATH
} from "@quorate/core";
import {
  loadBaseBaseline, loadBaseCustomPacks, loadBasePolicy,
  loadBaseRepositoryLockfiles, loadBaseSuppressionStore
} from "../../github-action/src/index.js";
import { loadRepoConfig } from "./handler.js";
import { reviewPullRequest, type AppDeps } from "./review.js";
import { logger } from "./logger.js";
import pkg from "../package.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v?.trim() ? v.trim() : undefined;
}

// ---------------------------------------------------------------------------
// Installation Octokit factory
// ---------------------------------------------------------------------------

function makeInstallationOctokit(params: {
  appId: string;
  privateKey: string;
  installationId: number;
}): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: params.appId,
      privateKey: params.privateKey,
      installationId: params.installationId
    }
  });
}

// ---------------------------------------------------------------------------
// Webhook event handlers
// ---------------------------------------------------------------------------

export function createReviewDeps(
  octokit: Octokit,
  input: { owner: string; repo: string; pullNumber: number; headSha: string; baseSha: string; prTitle?: string },
  isLatest: () => boolean = () => true
): AppDeps {
  const { owner, repo, baseSha: ref } = input;
  const client = octokit as never;
  return {
    ...input, octokit: client,
    getConfig: async () => applyCustomPackDefinitions(
      await loadRepoConfig(octokit, { owner, repo, ref }),
      await loadBaseCustomPacks(client, { owner, repo, ref })
    ),
    getPolicy: () => loadBasePolicy(client, { owner, repo, ref, path: DEFAULT_POLICY_PATH }),
    getBaseline: () => loadBaseBaseline(client, { owner, repo, ref, path: DEFAULT_BASELINE_PATH }),
    getSuppressions: () => loadBaseSuppressionStore(client, { owner, repo, ref, path: DEFAULT_SUPPRESSION_PATH }),
    getRepositoryFiles: () => loadBaseRepositoryLockfiles(client, { owner, repo, ref }),
    isCurrent: async () => {
      if (!isLatest()) return false;
      const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: input.pullNumber });
      return isLatest() && data.state === "open" && data.head.sha === input.headSha && data.base.sha === ref;
    }
  };
}

/** Whether a check_run event should re-run the council — either GitHub's native
 *  "Re-run" button (`rerequested`) or our custom "Re-run Quorate" action button. */
export function isCheckRerunEvent(payload: {
  action: string;
  requested_action?: { identifier?: string };
}): boolean {
  if (payload.action === "rerequested") return true;
  return payload.action === "requested_action" && payload.requested_action?.identifier === "rerun";
}

export interface ReviewJob {
  id: string;
  installationId: number;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  baseSha?: string;
  checkRunId?: number;
  createdAt: string;
  updatedAt: string;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
}

type NewReviewJob = Pick<ReviewJob, "id" | "installationId" | "owner" | "repo" | "pullNumber" | "headSha" | "baseSha">;

/** A delivery can supersede only a review of the same resolved revision pair. */
export function isLatestReviewJob(entries: ReviewJob[], id: string): boolean {
  const current = entries.find((job) => job.id === id);
  if (!current) return false;
  return entries.filter((candidate) => candidate.owner === current.owner && candidate.repo === current.repo
    && candidate.pullNumber === current.pullNumber && candidate.headSha === current.headSha
    && candidate.baseSha === current.baseSha)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)?.id === id;
}
const JOB_LIMIT = 1_000;
const JOB_ATTEMPTS = 3;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

function jobFilename(id: string): string {
  return `${createHash("sha256").update(id).digest("hex")}.json`;
}

function parseJob(input: unknown): ReviewJob {
  const job = input as ReviewJob;
  if (!job || typeof job !== "object"
    || ![job.id, job.owner, job.repo, job.headSha].every((value) => typeof value === "string" && value.length > 0 && value.length <= 256)
    || !Number.isSafeInteger(job.installationId) || job.installationId < 1
    || !Number.isSafeInteger(job.pullNumber) || job.pullNumber < 1
    || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > JOB_ATTEMPTS
    || !["queued", "running", "completed", "failed"].includes(job.status)
    || !Number.isFinite(Date.parse(job.createdAt)) || !Number.isFinite(Date.parse(job.updatedAt))
    || (job.baseSha !== undefined && (typeof job.baseSha !== "string" || job.baseSha.length > 256))
    || (job.checkRunId !== undefined && (!Number.isSafeInteger(job.checkRunId) || job.checkRunId < 1))) {
    throw new Error("Invalid persisted review job");
  }
  // Persist only this allowlist. Webhook bodies, titles, keys and tokens never
  // enter the spool, even if a caller supplies additional properties.
  const { id, installationId, owner, repo, pullNumber, headSha, baseSha, checkRunId, createdAt, updatedAt, status, attempts } = job;
  return { id, installationId, owner, repo, pullNumber, headSha, baseSha, checkRunId, createdAt, updatedAt, status, attempts };
}

/** Private, bounded, single-instance spool. Acknowledgement follows fsync and
 * atomic rename; running jobs are replayed after process/container restart. */
export class ReviewJobStore {
  private readonly jobs = new Map<string, ReviewJob>();
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly directory: string) {}

  get entries(): ReviewJob[] { return [...this.jobs.values()].map((job) => ({ ...job })); }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directoryInfo = await lstat(this.directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error("App state directory must be a real directory");
    const entries = await readdir(this.directory);
    for (const name of entries.filter((entry) => /^\.[a-f0-9-]{36}\.tmp$/.test(entry))) {
      await unlink(join(this.directory, name));
    }
    const names = entries.filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
    if (names.length > JOB_LIMIT) throw new Error("App state exceeds the review job storage limit");
    for (const name of names) {
      const file = await open(join(this.directory, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let job: ReviewJob;
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 16_384) throw new Error("Invalid review job file");
        job = parseJob(JSON.parse(await file.readFile("utf8")));
      } finally {
        await file.close();
      }
      if (jobFilename(job.id) !== name) throw new Error("Persisted review job identity mismatch");
      if (job.status === "completed" && Date.now() - Date.parse(job.updatedAt) > RETENTION_MS) {
        await unlink(join(this.directory, name));
        continue;
      }
      this.jobs.set(job.id, job);
      if (job.status === "running") {
        // A crash is not a completed attempt; reconcile its remote check before
        // retrying, including when it interrupted the final permitted attempt.
        await this.save({ ...job, status: "queued", attempts: Math.max(0, job.attempts - 1) });
      }
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation);
    this.writes = result.catch(() => {});
    return result;
  }

  private async save(job: ReviewJob): Promise<ReviewJob> {
    const checked = parseJob(job);
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      try {
        await file.writeFile(JSON.stringify(checked));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, join(this.directory, jobFilename(job.id)));
      if (process.platform !== "win32") {
        const directory = await open(this.directory, constants.O_RDONLY);
        try { await directory.sync(); } finally { await directory.close(); }
      }
      this.jobs.set(job.id, checked);
      return checked;
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async accept(input: NewReviewJob): Promise<ReviewJob> {
    return this.serial(async () => {
      const existing = this.jobs.get(input.id);
      if (existing) return existing;
      if (this.jobs.size >= JOB_LIMIT) {
        const oldest = this.entries.filter((job) => job.status === "completed" || (job.status === "failed" && job.attempts >= JOB_ATTEMPTS))
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
        if (!oldest) throw new Error("Review job storage is full; retry this delivery later");
        await unlink(join(this.directory, jobFilename(oldest.id)));
        this.jobs.delete(oldest.id);
      }
      const latestTimestamp = Math.max(0, ...this.entries.map((job) => Date.parse(job.createdAt)));
      const now = new Date(Math.max(Date.now(), latestTimestamp + 1)).toISOString();
      return this.save({ ...input, createdAt: now, updatedAt: now, status: "queued", attempts: 0 });
    });
  }

  async update(id: string, patch: Partial<Pick<ReviewJob, "status" | "attempts" | "checkRunId" | "baseSha">>): Promise<ReviewJob> {
    return this.serial(async () => {
      const previous = this.jobs.get(id);
      if (!previous) throw new Error("Unknown persisted review job");
      return this.save({ ...previous, ...patch, updatedAt: new Date().toISOString() });
    });
  }
}

/** Re-fetches PR state and reconciles remote checks before recovered work runs. */
export async function runStoredReviewJob(job: ReviewJob, octokit: Octokit, store: ReviewJobStore, isLatest: () => boolean): Promise<void> {
  const { owner, repo, pullNumber, headSha } = job;
  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  let checkRunId = job.checkRunId;
  if (!checkRunId && job.attempts > 0) {
    const checks = await octokit.paginate(octokit.rest.checks.listForRef, {
      owner, repo, ref: headSha, check_name: "Quorate", filter: "all", per_page: 100
    });
    checkRunId = checks.filter((check) => check.external_id === job.id).sort((a, b) => b.id - a.id)[0]?.id;
  }
  if (checkRunId) {
    const { data: check } = await octokit.rest.checks.get({ owner, repo, check_run_id: checkRunId });
    if (check.status === "completed") {
      // A completed policy verdict is terminal. Our internal-error check only
      // records a failed attempt; it must not turn a durable retry into success.
      if (check.conclusion !== "failure" || check.output.title !== "Quorate: internal error") return;
      checkRunId = undefined;
      await store.update(job.id, { checkRunId: undefined });
    }
  }
  const baseSha = job.baseSha ?? pr.base.sha;
  await store.update(job.id, { baseSha });
  await reviewPullRequest({
    ...createReviewDeps(octokit, { owner, repo, pullNumber, headSha, baseSha, prTitle: pr.title }, isLatest),
    externalId: job.id,
    checkRunId,
    onCheckCreated: async (id) => { await store.update(job.id, { checkRunId: id }); }
  });
}

/** Single-process admission control. Completed delivery IDs are bounded; jobs
 * are serialized per PR so an older comment cannot overwrite a newer result. */
export class ReviewQueue {
  private readonly deliveries = new Map<string, Promise<void>>();
  private readonly completed = new Set<string>();
  private readonly latest = new Map<string, string>();
  private readonly runningKeys = new Set<string>();
  private readonly pending: Array<{ id: string; key: string; run: (isLatest: () => boolean) => Promise<void>; resolve: () => void; reject: (error: unknown) => void }> = [];
  private stopping = false;

  constructor(private readonly concurrency = 4, private readonly capacity = 100) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(capacity) || capacity < concurrency) {
      throw new Error("Review queue requires positive concurrency and capacity >= concurrency.");
    }
  }

  enqueue(id: string, key: string, run: (isLatest: () => boolean) => Promise<void>): Promise<void> {
    const existing = this.deliveries.get(id);
    if (existing) return existing;
    if (this.stopping || this.pending.length + this.runningKeys.size >= this.capacity) {
      throw new Error("Review queue is unavailable; retry this delivery later.");
    }
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    this.deliveries.set(id, completion);
    this.latest.set(key, id);
    this.pending.push({ id, key, run, resolve, reject });
    this.pump();
    return completion;
  }

  private pump(): void {
    while (this.runningKeys.size < this.concurrency) {
      const index = this.pending.findIndex((job) => !this.runningKeys.has(job.key));
      if (index < 0) return;
      const job = this.pending.splice(index, 1)[0];
      this.runningKeys.add(job.key);
      void Promise.resolve().then(() => job.run(() => this.latest.get(job.key) === job.id)).then(
        () => { this.completed.add(job.id); job.resolve(); },
        (error: unknown) => { this.deliveries.delete(job.id); job.reject(error); }
      ).finally(() => {
        this.runningKeys.delete(job.key);
        if (this.latest.get(job.key) === job.id) this.latest.delete(job.key);
        while (this.completed.size > 1_000) {
          const oldest = this.completed.values().next().value;
          if (!oldest) break;
          this.completed.delete(oldest);
          this.deliveries.delete(oldest);
        }
        this.pump();
      });
    }
  }

  async drain(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled(this.deliveries.values());
  }
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

export async function startServer(): Promise<void> {
  // Validate required env vars up-front; log which optional ones are absent.
  const appId = requiredEnv("APP_ID");
  const privateKey = (() => {
    const keyPath = optionalEnv("PRIVATE_KEY_PATH");
    if (keyPath) {
      return readFileSync(keyPath, "utf8");
    }
    const raw = requiredEnv("PRIVATE_KEY");
    return raw.replace(/\\n/g, "\n");
  })();
  const webhookSecret = requiredEnv("WEBHOOK_SECRET");
  const port = Number(optionalEnv("PORT") ?? "3000");

  const optionalKeys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "QUORATE_PROVIDERS"];
  const missing = optionalKeys.filter((k) => !optionalEnv(k));
  if (missing.length > 0) {
    logger.info("Optional env vars not set (providers may be limited)", { missing });
  }

  const webhooks = new Webhooks({ secret: webhookSecret });
  const queue = new ReviewQueue(Number(optionalEnv("REVIEW_CONCURRENCY") ?? "4"));
  const store = new ReviewJobStore(resolve(optionalEnv("QUORATE_APP_STATE_DIR") ?? ".quorate-app"));
  await store.initialize();
  let stopping = false;

  const dispatch = (): void => {
    if (stopping) return;
    const jobs = store.entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const job of jobs) {
      if (job.status !== "queued" && !(job.status === "failed" && job.attempts < JOB_ATTEMPTS
        && Date.now() - Date.parse(job.updatedAt) >= job.attempts * 5_000)) continue;
      const key = `${job.owner}/${job.repo}/${job.pullNumber}`;
      try {
        queue.enqueue(job.id, key, async () => {
          const running = await store.update(job.id, { status: "running", attempts: job.attempts + 1 });
          try {
            const octokit = makeInstallationOctokit({ appId, privateKey, installationId: job.installationId });
            const isLatest = (): boolean => isLatestReviewJob(store.entries, job.id);
            await runStoredReviewJob(running, octokit, store, isLatest);
            await store.update(job.id, { status: "completed" });
          } catch (error) {
            await store.update(job.id, { status: "failed" });
            throw error;
          }
        }).catch((error: unknown) => logger.error("Review job failed", {
          deliveryId: job.id, error: error instanceof Error ? error.message : String(error)
        }));
      } catch {
        // Admission is bounded. Remaining jobs are already durable and the
        // dispatcher will admit them when a running review releases capacity.
        break;
      }
    }
  };

  const accept = async (job: NewReviewJob): Promise<void> => {
    if (stopping) throw new Error("App is shutting down; retry this delivery later");
    await store.accept(job);
    dispatch();
  };

  webhooks.on("pull_request", async (event) => {
    if (!["opened", "synchronize", "reopened"].includes(event.payload.action)) return;
    const { repository, pull_request: pr, installation } = event.payload as typeof event.payload & { installation?: { id: number } };
    if (!installation) throw new Error("Missing App installation");
    await accept({
      id: event.id, installationId: installation.id, owner: repository.owner.login, repo: repository.name,
      pullNumber: pr.number, headSha: pr.head.sha, baseSha: pr.base.sha
    });
  });

  webhooks.on("check_run", async (event) => {
    if (!isCheckRerunEvent(event.payload) || String(event.payload.check_run.app?.id) !== appId) return;
    const { repository, check_run: check, installation } = event.payload;
    const pr = check.pull_requests?.[0];
    if (!pr || !installation) return;
    await accept({
      id: event.id, installationId: installation.id, owner: repository.owner.login, repo: repository.name,
      pullNumber: pr.number, headSha: pr.head.sha
    });
  });

  const middleware = createNodeMiddleware(webhooks, { path: "/api/webhook" });

  const server = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "")) {
      // Serve the designed setup/landing page (public/index.html sits beside dist/).
      try {
        const html = readFileSync(join(__dirname, "../public/index.html"), "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(302, { Location: "https://quorate.dev" });
        res.end();
      }
      return;
    }
    if (req.method === "GET" && (req.url === "/health" || req.url === "/healthz")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: pkg.version }));
      return;
    }
    void middleware(req, res);
  });

  server.listen(port, () => {
    logger.info(`Quorate GitHub App listening on port ${port}`, {
      webhookPath: "/api/webhook",
      healthPath: "/health",
      landingPath: "/"
    });
  });
  dispatch();
  const dispatcher = setInterval(dispatch, 1_000);
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    clearInterval(dispatcher);
    void new Promise<void>((done) => server.close(() => done()))
      .then(() => queue.drain()).then(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

// Start the server when this module is the process entry (the deployed bundle).
if (!process.env.VITEST) {
  void startServer().catch((error: unknown) => {
    logger.error("App startup failed", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}
