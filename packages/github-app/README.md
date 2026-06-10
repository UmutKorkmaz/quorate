# Quorate GitHub App

A hosted webhook service that runs the [Quorate](https://github.com/UmutKorkmaz/quorate)
review council on every pull request and reports results through GitHub's **native
Check Runs with inline annotations** — no per-repo workflow file, installs once
across an organization.

## App vs Action

| | GitHub **Action** (`UmutKorkmaz/quorate@v…`) | GitHub **App** (this package) |
| --- | --- | --- |
| Setup | a `.github/workflows/*.yml` in **each** repo | install **once**, org-wide |
| Where it runs | the repo's Actions runner | your hosted server |
| UI | a PR comment + a check | a **Check Run with inline annotations** + PR comment |
| Re-run | re-run the workflow | GitHub's native **Re-run** button on the check |

Use the Action if you want everything inside GitHub Actions; use the App for
zero-config, org-wide review with the richest native UI.

## What a review produces

1. An in-progress **Check Run** named *Quorate* on the PR's head commit.
2. The PR diff is built, **domain packs are auto-detected** from the changed
   files (`detectPacks`), and the council runs (api providers + the heuristic —
   a hosted App has no local agent CLIs).
3. Findings become **inline annotations** (path + line, severity → `failure` /
   `warning` / `notice`), and the run completes with a PASS / WARN / FAIL summary
   and a **"Re-run Quorate"** action button.
4. A summary **PR comment** is upserted.

Re-run a review by clicking GitHub's native **Re-run** on the check
(`check_run.rerequested`) or the **Re-run Quorate** action button
(`requested_action`).

## Create the App

**Manifest flow (recommended):** use `app.yml` in this directory with GitHub's
[App manifest creation flow](https://docs.github.com/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
to create the App in one click with the right permissions and events.

**Manually:** create a GitHub App with:
- **Permissions:** Checks `write`, Pull requests `write`, Contents `read`, Metadata `read`.
- **Events:** `pull_request`, `check_run`.
- **Webhook URL:** `https://<your-host>/api/webhook` and a webhook secret.

Then download the App's private key and note its App ID.

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_ID` | yes | the GitHub App ID |
| `PRIVATE_KEY` *or* `PRIVATE_KEY_PATH` | yes | the App private key (PEM); `PRIVATE_KEY` may use `\n`-escaped newlines |
| `WEBHOOK_SECRET` | yes | the webhook secret (signatures are verified) |
| `PORT` | no | default `3000` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `QUORATE_PROVIDERS` | no | provider keys for the council |

Secrets are never logged; on boot the server reports which optional vars are absent.

## Run & deploy

```bash
npm install
npm run build --workspace @quorate/github-app
APP_ID=… WEBHOOK_SECRET=… PRIVATE_KEY_PATH=./key.pem npm run start --workspace @quorate/github-app
```

- **Docker:** `docker build -f packages/github-app/Dockerfile -t quorate-app .` (the
  image ships `dist/` + the static `public/` landing page).
- **Render:** `deploy/render.yaml`. **Fly.io:** `deploy/fly.toml`. Set the env
  vars as secrets in either platform.

Routes: `GET /` serves the setup/landing page · `GET /health` is a JSON health
check · `POST /api/webhook` receives GitHub webhooks.

## Architecture

- `src/review.ts` — `reviewPullRequest(deps)`: the dependency-injected core
  (create check run → diff → detect packs → `runCouncil` → annotations → complete
  → comment). Unit-tested with a stub octokit.
- `src/server.ts` — `@octokit/app` auth + `@octokit/webhooks` signature
  verification; routes events to the review core. `isCheckRerunEvent` decides
  re-runs.
- `src/check-run.ts` — maps a `CouncilReport` to a Check Run output + annotations.
- `app.yml`, `Dockerfile`, `deploy/`, `public/index.html` — packaging.
