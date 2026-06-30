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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import type { QuorateConfig } from "@quorate/core";
import { loadRepoConfig } from "./handler.js";
import { reviewPullRequest } from "./review.js";
import { logger } from "./logger.js";

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

async function handlePullRequestEvent(
  event: EmitterWebhookEvent<"pull_request">,
  appId: string,
  privateKey: string
): Promise<void> {
  const payload = event.payload as typeof event.payload & { installation?: { id: number } };
  const { action, pull_request: pr, repository, installation } = payload;
  if (!["opened", "synchronize", "reopened"].includes(action)) return;
  if (!installation) {
    logger.warn("pull_request event missing installation payload — skipping");
    return;
  }

  const owner = repository.owner.login;
  const repo = repository.name;
  const pullNumber = pr.number;
  const headSha = pr.head.sha;
  const baseRef = pr.base.ref;
  const prTitle = pr.title;

  logger.info("Handling pull_request event", { owner, repo, pullNumber, action });

  const octokit = makeInstallationOctokit({
    appId,
    privateKey,
    installationId: installation.id
  });

  let resolvedConfig: QuorateConfig | undefined;

  await reviewPullRequest({
    octokit: octokit as never,
    owner,
    repo,
    pullNumber,
    headSha,
    prTitle,
    getConfig: async () => {
      if (!resolvedConfig) {
        resolvedConfig = await loadRepoConfig(octokit, { owner, repo, ref: baseRef });
      }
      return resolvedConfig;
    }
  });
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

async function handleCheckRunRequestedAction(
  event: EmitterWebhookEvent<"check_run">,
  appId: string,
  privateKey: string
): Promise<void> {
  const { check_run: checkRun, repository, installation } = event.payload;
  if (!isCheckRerunEvent(event.payload as { action: string; requested_action?: { identifier?: string } })) return;
  if (!installation) {
    logger.warn("check_run re-run event missing installation payload — skipping");
    return;
  }

  const pullRequests = checkRun.pull_requests as Array<{
    number: number;
    base: { ref: string };
    head: { sha: string };
  }>;
  if (!pullRequests || pullRequests.length === 0) {
    logger.warn("check_run.requested_action: no pull_requests in payload — cannot re-run");
    return;
  }

  const pr = pullRequests[0];
  const owner = repository.owner.login;
  const repo = repository.name;
  const pullNumber = pr.number;
  const headSha = pr.head.sha;
  const baseRef = pr.base.ref;

  logger.info("Re-running council (check_run re-run requested)", { owner, repo, pullNumber });

  const octokit = makeInstallationOctokit({
    appId,
    privateKey,
    installationId: installation.id
  });

  let resolvedConfig: QuorateConfig | undefined;

  await reviewPullRequest({
    octokit: octokit as never,
    owner,
    repo,
    pullNumber,
    headSha,
    getConfig: async () => {
      if (!resolvedConfig) {
        resolvedConfig = await loadRepoConfig(octokit, { owner, repo, ref: baseRef });
      }
      return resolvedConfig;
    }
  });
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

export function startServer(): void {
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

  webhooks.on("pull_request", (event) => {
    handlePullRequestEvent(event, appId, privateKey).catch((err: unknown) => {
      logger.error("pull_request handler error", {
        error: err instanceof Error ? err.message : String(err)
      });
    });
  });

  webhooks.on("check_run", (event) => {
    handleCheckRunRequestedAction(event, appId, privateKey).catch((err: unknown) => {
      logger.error("check_run handler error", {
        error: err instanceof Error ? err.message : String(err)
      });
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
      res.end(JSON.stringify({ status: "ok", version: "0.1.0" }));
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
}

// Start the server when this module is the process entry (the deployed bundle).
if (!process.env.VITEST) {
  startServer();
}
