<div align="center">

# quorate

**A council of AI reviewers for your code — in one CLI.**

[![npm](https://img.shields.io/npm/v/quorate.svg?color=6e97ff)](https://www.npmjs.com/package/quorate)
[![node](https://img.shields.io/node/v/quorate.svg?color=6e97ff)](https://www.npmjs.com/package/quorate)
[![license](https://img.shields.io/npm/l/quorate.svg?color=6e97ff)](https://github.com/UmutKorkmaz/quorate/blob/main/LICENSE)

</div>

**Quorate** convenes a *quorate* — a body able to reach a binding decision — of AI
reviewers over a diff or a plan, deduplicates and ranks their findings, and returns
**one verdict** with file-and-line evidence. It drives the AI CLIs you already have
(`claude`, `codex`, `qwen`, …) and any OpenAI-compatible endpoint, ships an
interactive shell, and runs in CI as a GitHub Action.

```text
  ◷ review   ⌘ claude+codex   ⎇ git working tree   ⠹ 00:08

  heuristic:maintainer                              ✔ 2 findings
  claude:security                                      ⠹ running
  codex:qa                                                queued

  ╭─ FAIL · 3 findings · agreement 67% ──────────────────────────╮
  │ ████████████████░░░░░░░░                                     │
  │ FAIL HIGH  src/auth.ts:42                                    │
  │ Missing authorization check — token introspection result is │
  │ trusted without verifying the audience claim.               │
  │ agreed by claude, codex · confidence 0.82                   │
  ╰──────────────────────────────────────────────────────────────╯
```

## Install

```bash
npm install -g quorate
quorate
```

Requires **Node ≥ 22**. Running `quorate` with no arguments opens the interactive shell.

## Why Quorate

- **Many models, one verdict.** Independent perspectives, deduplicated and ranked into a single **PASS / WARN / FAIL**.
- **Honest by default.** A heuristic-only review is reported as *degraded* — never a confident green.
- **Watch it work.** During a review, each agent shows a live activity line; drill into one to follow its output, and `/logs` reviews any agent afterward (and shows *why* a run failed).
- **Safe by design.** Real agents are opt-in, spawned without a shell, with explicit headless args, byte/time caps, and a dangerous-flag denylist.

## Quick start

```bash
quorate                                   # open the interactive shell
quorate doctor                            # see which AI CLIs are installed
quorate review --base main --head HEAD    # one-shot review of the current branch
```

In the shell:

```text
/git                  load the working tree as a diff
/use available        enable every installed agent
/review               convene the council
/logs claude:security read one agent's full output after a run
/route security codex reassign which agent covers a role (this session)
```

## Configure providers

Each provider's `roles:` decides which council voice it covers (`architect`,
`security`, `qa`, `performance`, `maintainer`). Add one without hand-editing YAML:

```bash
quorate provider presets                              # ollama, vllm, lmstudio, hf-router, openrouter, …
quorate provider add ollama --preset ollama --model qwen2.5-coder:7b
quorate provider add reviewer --type api \
  --base-url https://openrouter.ai/api/v1 \
  --model anthropic/claude-sonnet-4.6 \
  --api-key-env OPENROUTER_API_KEY --roles security,architect
```

## GitHub Action

```yaml
- uses: actions/checkout@v4
- uses: UmutKorkmaz/quorate@v0.5.0
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

`type: api` providers run real model review on standard GitHub-hosted runners — no
self-hosting required.

## Documentation

Full docs, slash-command reference, provider/model configuration, and the GitHub
Action: **<https://umutkorkmaz.github.io/quorate>**

MIT © Umut Korkmaz
