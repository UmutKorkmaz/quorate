# Quorate

> A council of AI reviewers for your code — in one CLI.

**Quorate** convenes a *quorate* (a body able to reach a binding decision) of AI
code reviewers over a diff or a plan, aggregates their findings, and returns **one
verdict** with concrete, file-and-line evidence. It runs the AI CLIs you already
have on your machine — `claude`, `codex`, `qwen`, `kimi`, and more — and ships a
Claude-Code-style interactive shell, a safe heuristic default, and a GitHub Action.

**Docs:** [umutkorkmaz.github.io/quorate](https://umutkorkmaz.github.io/quorate)

## Quorate Ship

**Quorate Ship** is the paid SKU for teams that need merge-blocking council checks,
plan governance, and audit trails — not just advisory PR comments. It bundles
**VerdictGate** (CI merge gate), **PlanCourt** (plan-mode review), and **ReviewGraph**
(multi-agent agreement evidence). **$49/repo/month.** Positioned for EU AI Act
high-risk documentation (August 2026). See [docs/LAUNCH.md](./docs/LAUNCH.md).

[![npm](https://img.shields.io/npm/v/quorate.svg)](https://www.npmjs.com/package/quorate)
![node](https://img.shields.io/node/v/quorate.svg)
[![license](https://img.shields.io/npm/l/quorate.svg)](./LICENSE)

<p align="center">
  <img src="https://raw.githubusercontent.com/UmutKorkmaz/quorate/main/packages/website/public/verdict-card.png" alt="Quorate verdict card — several reviewers reach one FAIL verdict with file-and-line evidence" width="560" />
</p>

---

## Install

```bash
npm install -g quorate
quorate
```

Requires **Node ≥ 22**. Running `quorate` with no arguments opens the interactive shell.

## Why Quorate

- **Many models, one verdict.** Get several independent AI perspectives on a change, deduplicated and ranked into a single PASS / WARN / FAIL.
- **Uses the CLIs you already have.** No API keys to wire up — Quorate detects local **agents** (`claude`, `codex`, `qwen`, `kimi`, `crush`, `goose`, …) and drives them in headless mode.
- **Honest by default.** The built-in heuristic runs with zero setup and never pretends: a heuristic-only review is reported as **degraded**, not a confident green.
- **Safe by design.** Real agents are opt-in, spawned without a shell, with explicit headless args, byte/time caps, and a dangerous-flag denylist.
- **A shell that feels like Claude Code.** Inline transcript, a `/` command palette with fuzzy-style filtering, an animated braille spinner, and native severity cards.

## Quick start

```bash
quorate                                   # open the shell
quorate doctor                            # see which AI CLIs are installed
quorate review --diff changes.diff        # one-shot review of a diff
quorate review --base main --head HEAD    # review the current branch
quorate plan "migrate auth to passkeys"   # evaluate a plan instead of a diff
```

In the shell, type `/` to open the command palette:

```text
/setup                guided setup wizard (/git → /use → /review)
/inspect              session diagnostics: config, agents, roles, spawn status
/resume [id]          list or restore a saved session
/providers            list agents and local availability
/plugins (agents)     browse the agent roster
/skills (councils)    show council roles and routing
/use available        enable every runnable agent for this session
/roles <ids>          limit which roles review
/route <role> <ids>   reassign role→provider for this session
/merge <id|off>       pick a master agent that merges duplicate findings
/models <id> [model]  list an api provider's live models, or switch its model
/git [base] [head]    load a git diff
/review [subject]     convene the council on the loaded diff
/plan <text>          evaluate a plan
/fix [n]              list fixable findings and get the delegation command
/last · /rerun        show or re-run the last report
/logs [id]            read each agent's full output (and why a run failed)
/json · /markdown     export the last report
/exit                 leave
```

Bare text follows the current mode — in `review` it reviews the loaded diff with
your text as the subject; in `plan` it evaluates the text as a plan.

The full command reference is generated from the CLI registry for the [docs site](https://umutkorkmaz.github.io/quorate/docs/commands).

## CLI commands

Every subcommand respects the global `-c, --config <path>` and `--cwd <path>` flags.

| Command | What it does | Key flags |
| --- | --- | --- |
| `quorate` / `quorate shell` | Open the interactive shell (default). | `--providers <ids>`, `--mode review\|plan`, `--continue`, `--resume [id]`, `--classic` |
| `quorate review` | One-shot review of a diff. | `--diff <path>`, `--base <ref>`, `--head <ref>`, `--pr <n>`, `--subject <text>`, `--providers <ids>`, `--merge <id>`, `--json`, `--write-json <path>` |
| `quorate plan "<text>"` | Evaluate an implementation/architecture plan. | `--providers <ids>`, `--json` |
| `quorate fix` | Delegate a finding to a write-mode agent — snapshotted, watchable, revertible. | `--list`, `--finding <n>`, `--provider <id>`, `--revert [fixId]`, `--force`, `--no-review` |
| `quorate doctor` | Council-readiness verdict: environment + provider grid + next step. | `--json`, `--bundle`, `--bundle-file <path>` |
| `quorate providers` | List configured providers and availability. | `--json` |
| `quorate provider add <id>` | Add a provider to `.quorate.yml` — picks the model from the live list on a TTY. | `--preset <name>`, `--type`, `--base-url`, `--model`, `--api-key-env`, `--command`, `--args`, `--roles`, `--no-pick`, `-f` |
| `quorate provider models <id\|preset>` | List an endpoint's live models (`GET {baseUrl}/models`). | `--json` |
| `quorate provider set-model <id> [model]` | Switch an api provider's model — interactive picker when no model given. | — |
| `quorate provider remove <id>` / `presets` | Remove a provider; list API presets. | — |
| `quorate init` | Write a starter `.quorate.yml` (real providers disabled). | `-f, --force` |

`--diff`, `--base/--head`, and `--pr` select the diff source; `--json` streams NDJSON
events with the final report as the last line, ideal for piping into other tools.

## Domain packs

`quorate init --auto` detects your repo's stack (Rust/Solidity/Move/Terraform/
workflows/Swift/Kotlin + framework deps) and scaffolds the matching pack(s);
`quorate init --pack <id>` (or a comma-separated `<id,id>`) picks them explicitly.
Each scaffolds a domain-aware council — ecosystem-specific
councils + per-role reviewer guidance — and turns on **deterministic, diff-based
heuristics** for that domain (always-on, zero setup, layered under whatever real
agents you enable). `quorate packs` lists them.

| Pack | `init --pack` | Classes | Catches (examples) |
| --- | --- | --- | --- |
| **Solana / Anchor** | `solana` | 10 | unchecked accounts, raw CPI, skipPreflight, non-canonical bump, manual close, constraint removal |
| **EVM / Solidity** | `evm` | 10 | tx.origin auth, delegatecall, selfdestruct, unchecked call, reentrancy surface, unchecked ERC20 |
| **Move (Sui/Aptos)** | `move` | 10 | public entry auth, borrow_global_mut, shared objects, copy/drop abilities, privileged fns |
| **IaC (Terraform/K8s)** | `iac` | 11 | public ACLs, 0.0.0.0/0 ingress, encryption off, privileged containers, host namespaces |
| **AI / LLM apps** | `llm` | 12 | prompt injection, output→eval, raw-HTML output, tool-arg validation, PII in prompts |
| **CI/CD + supply chain** | `ci` | 10 | pull_request_target, expression injection, unpinned actions, install scripts, pipe-to-shell |
| **Fintech / PCI** | `fintech` | 10 | money as float, card data in logs, CVV stored, unverified webhooks, financial PII |
| **Web / API (OWASP)** | `web` | 10 | SSRF, command injection, path traversal, XSS, mass assignment, CORS, CSRF, deserialization |
| **Healthcare / HIPAA** | `healthcare` | 10 | PHI in logs/URLs/responses, plaintext PHI, patient-record IDOR, clinical credentials |
| **Mobile (iOS/Android)** | `mobile` | 10 | insecure storage, cleartext/ATS, exported components, disabled TLS, debuggable builds |
| **GraphQL API** | `graphql` | 10 | introspection in prod, no depth/complexity limit, resolver N+1, field auth, batch amplification |
| **Accessibility (WCAG)** | `accessibility` | 10 | missing alt text, unlabelled inputs, non-interactive handlers, invalid ARIA, skipped headings |
| **ML / MLOps** | `mlops` | 10 | pickle/torch.load, missing seeds, train/test leakage, registry creds, unpinned hub downloads |
| **Data & SQL** | `data-sql` | 10 | SQL interpolation, `SELECT *`, missing WHERE on UPDATE/DELETE, unguarded DROP, PII in logs |
| **Kubernetes** | `k8s` | 10 | privileged containers, runAsNonRoot:false, privilege escalation, empty limits, wildcard RBAC |
| **Privacy (GDPR)** | `privacy` | 10 | PII in logs/URLs, analytics before consent, missing retention TTLs, soft-delete vs erasure |
| **Performance & SRE** | `performance` | 10 | await-in-loop, N+1 queries, missing pagination, no fetch timeout, O(n²) scans, leaked intervals |
| **Embedded (MISRA)** | `embedded` | 10 | unbounded string ops, unchecked malloc/memcpy, missing volatile, alloc on ISR, float equality |

Every pack ships a vulnerable/clean demo corpus proving each class is detected
with zero false positives on clean code, a docs page (`/docs/<pack>`), and a
ready-to-copy GitHub Action example. A pack is **data, not a code path** — adding
an ecosystem is one registry entry, so the set grows without rewrites.

## Fix findings — and revert them

The council **judges**; one agent **fixes**; the council **re-reviews the fix**.
`quorate fix` delegates a finding to a write-mode agent (`claude`, `codex`, `agy`)
running interactively **in your real terminal** — you watch every step, and the
agent's own permission flow stays active (Quorate never passes bypass flags).

```bash
quorate review                 # findings persist to .quorate/last-report.json
quorate fix --list             # numbered fixable findings (+ past fixes)
quorate fix --finding 1        # pick agent → confirm → terminal hands over
quorate fix --revert           # undo the last fix
```

Before the agent touches anything, the pre-fix state is pinned (`git stash
create` — nothing in your worktree moves) plus a manifest of new files. Revert
restores tracked files, deletes agent-created files, and **re-applies your own
pre-fix uncommitted work** — and refuses when the tree changed since the fix
(`--force` to override). After each fix, Quorate offers a council re-review.

## Agents & roles

Quorate uses two terms consistently:

- **Agents** — the AI CLIs on your machine (`claude`, `codex`, `qwen`, …) plus the
  built-in **heuristic** reviewer. Enable agents per session with `/use available`,
  browse them with `/plugins`, and inspect spawn readiness with `/inspect`.
- **Roles** — the council voices that review your code (`architect`, `security`,
  `qa`, `performance`, `maintainer`). Limit which roles participate with `/roles`,
  and see how agents map to roles with `/skills`.

Quorate detects these agent CLIs by default:

`claude` · `codex` · `agy` · `hermes` · `kimi` · `qwen` · `minimax` · `opencode` ·
`kilo` · `droid` · `crush` · `cline` · `goose` · `copilot` · `grok` · `agent` · `ollama`

The default agent is **`heuristic`** — four fast static checks (focused tests,
hard-coded secrets, stray `console.log`, TODO/FIXME). It needs no setup and never
calls an external tool.

### Roles & routing

Each enabled provider runs one lane per entry in its `roles:` array, so one
provider can cover several roles (e.g. `roles: [architect, security]` makes that
agent review as **both**). A provider's `roles:` array **is** the role→provider
map.

To give different roles different **models**, define separate providers — two
`type: cli` entries with different `args:`, or two `type: api` entries with
different `model:` — and assign each the roles you want. CLIs share one local
authentication, so per-role model differences come from distinct providers rather
than per-role settings.

Use `/route <role> <providers...>` to remix routing for a single session;
`/route reset` restores the config routing; edit `roles:` in `.quorate.yml` to
persist a change. `/logs [id]` reads each agent's full captured output after a
run (and shows why a provider failed).

## Project defaults & custom commands

Two optional, per-repo files let a project carry its own conventions:

- **Project memory** — `QUORATE.md` or `.quorate/QUORATE.md` sets default council
  `roles` and preferred `agents` for the repo (via `## Default roles` /
  `## Preferred agents` sections or `roles:` / `agents:` frontmatter). `/inspect`
  shows what was loaded.
- **Custom slash commands** — drop a Markdown file in `.quorate/commands/` and its
  body becomes a reusable prompt. Frontmatter supports `description`,
  `argument-hint`, and `mode: review|plan`; `{{args}}` interpolates user input;
  nested folders namespace as `folder:command`. Built-in commands win on a name clash.
  Because these are repo-controlled and feed straight into a council prompt, they
  are **only loaded when you opt in** with `QUORATE_TRUST_WORKSPACE=1` — opening
  the shell in an untrusted clone never runs them.

## Configure

```bash
quorate init        # writes a starter .quorate.yml (real agents disabled)
```

Then enable only the agents you trust, with explicit headless arguments:

```yaml
councils: [architect, security, qa, performance, maintainer]
providers:
  - id: heuristic
    type: mock
    enabled: true
  - id: codex
    type: cli
    enabled: true
    inputMode: stdin
    roles: [maintainer, qa]
    args: ["exec", "--sandbox", "read-only", "-"]
```

Provider safety fields:

| Field | Meaning |
| --- | --- |
| `args` | Command arguments; empty args are refused (no interactive sessions). |
| `inputMode` | `stdin`, `prompt-file`, or `none`. |
| `headlessAllowlist` | Optional per-agent allowlist of permitted flags. |
| `timeoutMs`, `killGraceMs` | Runtime cap and forced-kill grace period. |
| `maxInputBytes`, `maxOutputBytes` | Prompt/output caps before an agent is refused or killed. |
| `{promptFile}`, `{diffFile}`, `{role}`, `{subject}` | Placeholders expanded in args. |

Session/resume flags and `--yolo`/`--dangerously`-style tokens (a fixed denylist)
are rejected unless a profile sets `allowDangerousArgs`. Alternatively, give a
profile a `headlessAllowlist` and only those flags are permitted — that path
replaces the denylist entirely.

### Local & hosted API models

Beyond local CLIs, Quorate can call any **OpenAI-compatible HTTP endpoint** — a
local server (Ollama, llama.cpp, LM Studio, vLLM) or a hosted gateway — with a
`type: api` provider:

```yaml
providers:
  - id: local-llama
    type: api
    enabled: true
    baseUrl: http://localhost:11434/v1   # any OpenAI-compatible /v1 base
    model: llama3.1                       # required
    apiKeyEnv: OPENAI_API_KEY             # optional: read the key from this env var
    roles: [qa, maintainer]
```

`type` is one of `cli` (drive a local agent), `api` (HTTP endpoint), or `mock`
(the built-in `heuristic`). For `api` providers, **`model` is required**; `baseUrl`
is optional and defaults to `http://localhost:11434/v1`; and the key — if any — is
read from `apiKeyEnv`, never stored in the file.

Or skip the hand-editing — **`quorate provider add`** writes the entry for you,
with presets for the common endpoints (`quorate provider presets` lists them):

```bash
quorate provider add ollama --preset ollama --model qwen2.5-coder:7b
quorate provider add reviewer --type api \
  --base-url http://localhost:8000/v1 --model Qwen/Qwen2.5-Coder-32B-Instruct \
  --api-key-env VLLM_API_KEY --roles security,architect
```

Presets cover **ollama · lmstudio · vllm · llamacpp · hf-router · openrouter ·
openai · together · groq · fireworks · deepseek · mistral · gemini · zai** —
run `quorate provider presets` for the full list, or see
[`.quorate.example.yml`](./.quorate.example.yml) for ports, models, and example councils.

#### Hosted gateways at a glance

Any of these is a one-liner. Pick a row, drop in your key, and you have real model
review — locally or in CI. The shape is always the same: a `baseUrl`, a `model`,
and the name of the env var holding the key.

| Preset | `baseUrl` | Example `model` | `apiKeyEnv` |
| --- | --- | --- | --- |
| `openrouter` | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4.6` | `OPENROUTER_API_KEY` |
| `openai` | `https://api.openai.com/v1` | `gpt-4o` | `OPENAI_API_KEY` |
| `deepseek` | `https://api.deepseek.com` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| `groq` | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| `mistral` | `https://api.mistral.ai/v1` | `codestral-latest` | `MISTRAL_API_KEY` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` | `GEMINI_API_KEY` |
| `zai` (GLM) | `https://api.z.ai/api/coding/paas/v4` | `glm-5.1` | `ZAI_API_KEY` |

Optional example — this repo currently selects Z.ai's GLM-5.1 for hosted review:

```bash
export ZAI_API_KEY=…                       # your key, never written to the file
quorate provider add glm --preset zai      # writes the entry to .quorate.yml
quorate review                             # runs the configured provider roles
```

Swap `zai`/`glm-5.1` and the env var for your own provider, token, and model.
GLM is this repo's selected example, not a Quorate requirement.

## Terminal & theming

Quorate adapts to your terminal and honors the standard environment conventions:

- `NO_COLOR` — disable all color (any value, per [no-color.org](https://no-color.org)).
- `FORCE_COLOR` — force color even when piped; `FORCE_COLOR=0` forces it off.
- `QUORATE_ASCII=1` — use plain-ASCII glyphs instead of the Unicode council set.

`quorate doctor` reports council readiness as a verdict-style checklist — environment
checks (Node, git, gh), each agent's state (`runnable` / `needs-profile` / `not
installed`) with a copy-paste fix, and a closing verdict that names the next command.
A heuristic-only review is always reported as **degraded**, never a confident green —
in the shell, the Markdown report, and the PR comment alike.

## Verdicts & degraded reviews

Every review ends in one verdict:

- **PASS** — no blocking findings.
- **WARN** — non-blocking issues, *or* the run was degraded (see below).
- **FAIL** — at least one finding at or above the failure severity.

A review is **degraded** when no real (`cli`/`api`) provider finished
successfully, so the verdict rests on the heuristic alone. Quorate never shows a
confident green for a degraded run: a would-be PASS is downgraded to **WARN**.

You'll see degraded in three situations:

1. **No real provider enabled** — only the heuristic ran. Enable agents with
   `/use available` (or a comma-separated list, e.g. `/use claude,codex`).
2. **All real providers failed** — they were enabled but none succeeded. Common
   causes: the agent isn't authenticated, doesn't support headless/stdin, or its
   configured args are wrong for the installed version. Run `/inspect` or
   `quorate doctor` to check spawn readiness.
3. **Prompt too large** — the review prompt (diff plus context) exceeds a CLI
   provider's `maxInputBytes` (default **250 KB**), so it's refused before spawning.
   `/git` already excludes common lock/generated files (`package-lock.json`,
   `*.lock`, `go.sum`, …), but a large source diff can still hit the cap. Review a
   narrower diff — e.g. `git diff HEAD -- src > review.diff` then `/diff review.diff`
   — or raise `maxInputBytes` for that provider.

## GitHub Action

Run the council on every pull request:

```yaml
name: Quorate
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: UmutKorkmaz/quorate@v0.8.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

The Action posts a single PR summary comment (and optional inline review comments
on changed lines) and can fail the check based on severity. Use a **self-hosted
runner** when the bot should call locally authenticated CLIs (`claude`, `codex`, …);
use GitHub-hosted runners for the default heuristic or `type: api` providers.

**Real AI review on GitHub-hosted runners** — commit a `.quorate.yml` (base branch)
with a `type: api` provider pointing at a hosted gateway, pass the key from secrets,
and set `runner-mode: api`:

```yaml
      - uses: UmutKorkmaz/quorate@v0.8.0
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          runner-mode: api
```

See [`packages/github-action/README.md`](./packages/github-action/README.md) for the
full CI provider guide.

**Inputs:**

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | — | Token to read PR files and write comments. |
| `config-path` | `.quorate.yml` | Config file (read from the **base** branch). |
| `providers` | — | Comma-separated provider ids to enable for this run. |
| `fail-on` | `high` | Minimum severity that fails the check (`critical`…`info`, or `never`). |
| `post-comment` | `true` | Post/update the Quorate summary comment. |
| `inline-comments` | `false` | Post findings as inline review comments on changed lines. |
| `inline-comment-limit` | `10` | Max inline comments per run. |
| `runner-mode` | `auto` | Restrict providers by type: `auto` (all), `cli` (local agents only), `api` (HTTP endpoints only). The heuristic always runs. |
| `mode` | `review` | Council mode — only `review` is implemented for the Action. |

**Outputs:** `verdict` (the final verdict — lowercase `pass`, `warn`, or `fail`) and
`findings` (the finding count) — use them to gate later steps.

**Security:** the Action loads `.quorate.yml` from the pull request's **base
branch**, never from the PR head — a pull request cannot supply the config that
governs its own review.

## How it works

```text
 diff / plan ─▶ council orchestrator ─▶ agents (heuristic + CLI/API, in parallel)
                       │                         │ headless, sandboxed, capped
                       ▼                         ▼
                 dedupe + rank ◀──── findings (severity, file:line, evidence)
                       │
                       ▼
            one verdict  (pass · warn · fail, with degraded honesty)
```

The engine (`@quorate/core`) is shared by the CLI, the interactive shell, and the
GitHub Action, so a review behaves identically everywhere.

## Development

```bash
git clone https://github.com/UmutKorkmaz/quorate
cd quorate
npm install
npm run build
npm test
npm run dev:website    # local docs site (regenerates command table from CLI)
```

An npm workspace: `packages/cli` (the `quorate` binary + Ink TUI),
`packages/core` (the engine), `packages/github-action`, `packages/website`
(the docs site at [umutkorkmaz.github.io/quorate](https://umutkorkmaz.github.io/quorate)).
Pure TypeScript/Node — no native build step.

Shell command docs are generated from `packages/cli/src/tui/commands.ts`:

```bash
npm run generate:command-docs
```

## License

MIT © Umut Korkmaz
