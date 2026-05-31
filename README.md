# Quorate

> A council of AI reviewers for your code — in one CLI.

**Quorate** convenes a *quorate* (a body able to reach a binding decision) of AI
code reviewers over a diff or a plan, aggregates their findings, and returns **one
verdict** with concrete, file-and-line evidence. It runs the AI CLIs you already
have on your machine — `claude`, `codex`, `qwen`, `kimi`, and more — and ships a
Claude-Code-style interactive shell, a safe heuristic default, and a GitHub Action.

[![npm](https://img.shields.io/npm/v/quorate.svg)](https://www.npmjs.com/package/quorate)
![node](https://img.shields.io/node/v/quorate.svg)
[![license](https://img.shields.io/npm/l/quorate.svg)](./LICENSE)

```text
 ╭──────────────────────────────────────────────────────────────╮
 │ › /re                                                         │
 ╰──────────────────────────────────────────────────────────────╯
   ▸ /review     Review the loaded/current diff   [subject]
     /rerun      Run the last request again
     /roles      Limit council roles
   ↑/↓ select · Tab complete · Enter run · Esc close

  ⠹ reviewing · review · claude+codex · diff loaded · 00:08 · esc to interrupt

   FAIL  src/auth.ts:42
   HIGH  Missing authorization check — token introspection result is trusted
         without verifying the audience claim.
```

---

## Install

```bash
npm install -g quorate
quorate
```

Requires **Node ≥ 22**. Running `quorate` with no arguments opens the interactive shell.

## Why Quorate

- **Many models, one verdict.** Get several independent AI perspectives on a change, deduplicated and ranked into a single PASS / WARN / FAIL.
- **Uses the CLIs you already have.** No API keys to wire up — Quorate detects local agents (`claude`, `codex`, `qwen`, `kimi`, `crush`, `goose`, …) and drives them in headless mode.
- **Honest by default.** The built-in heuristic runs with zero setup and never pretends: a heuristic-only review is reported as **degraded**, not a confident green.
- **Safe by design.** Real providers are opt-in, spawned without a shell, with explicit headless args, byte/time caps, and a dangerous-flag denylist.
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
/providers            list providers and local availability
/use available        enable every detected, runnable provider for this session
/diff path            load a unified diff
/git [base] [head]    load a git diff
/pr 123               load a pull-request diff (uses gh)
/review [subject]     review the loaded/current diff
/plan text            evaluate a plan
/mode review|plan     how bare text is interpreted
/last · /rerun        show or re-run the last report
/json · /markdown     export the last report
/exit                 leave
```

Bare text follows the current mode — in `review` it reviews the loaded diff with
your text as the subject; in `plan` it evaluates the text as a plan.

## Providers

Quorate detects these agent CLIs by default and runs the ones you enable:

`claude` · `codex` · `agy` · `hermes` · `kimi` · `qwen` · `minimax` · `opencode` ·
`kilo` · `droid` · `crush` · `cline` · `goose` · `copilot` · `grok` · `agent` · `ollama`

The default provider is **`heuristic`** — four fast static checks (focused tests,
hard-coded secrets, stray `console.log`, TODO/FIXME). It needs no setup and never
calls an external tool. Enable real reviewers per session with `/use available`,
or persist them in config.

## Configure

```bash
quorate init        # writes a starter .quorate.yml (real providers disabled)
```

Then enable only the providers you trust, with explicit headless arguments:

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
| `headlessAllowlist` | Optional per-provider allowlist of permitted flags. |
| `timeoutMs`, `killGraceMs` | Runtime cap and forced-kill grace period. |
| `maxInputBytes`, `maxOutputBytes` | Prompt/output caps before a provider is refused or killed. |
| `{promptFile}`, `{diffFile}`, `{role}`, `{subject}` | Placeholders expanded in args. |

Session/resume and `--dangerously*`/`--yolo`-style flags are rejected unless a
profile explicitly opts in with `allowDangerousArgs`.

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
      - uses: UmutKorkmaz/quorate@v0.2.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

The Action posts a single report comment and can fail the check based on
`fail-on` severity. Use a **self-hosted runner** when the bot should call locally
authenticated CLIs (`claude`, `codex`, …); use GitHub-hosted runners for the
default heuristic.

**Security:** the Action loads `.quorate.yml` from the pull request's **base
branch**, never from the PR head — a pull request cannot supply the config that
governs its own review.

## How it works

```text
 diff / plan ─▶ council orchestrator ─▶ providers (heuristic + CLIs, in parallel)
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
```

An npm workspace: `packages/cli` (the `quorate` binary + Ink TUI),
`packages/core` (the engine), `packages/github-action`. Pure TypeScript/Node —
no native build step.

## License

MIT © Umut Korkmaz
