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

<div align="center">

<img src="https://raw.githubusercontent.com/UmutKorkmaz/quorate/main/packages/website/public/verdict-card.png" alt="Quorate verdict card — reviewers reach one FAIL verdict with file-and-line evidence" width="540" />

</div>

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
- **Fix — and revert.** `quorate fix` hands a finding to a write-mode agent in your real terminal, snapshotted first; `--revert` undoes it, and the council re-reviews the fix.
- **Safe by design.** Real agents are opt-in, spawned without a shell, with explicit headless args, byte/time caps, and a dangerous-flag denylist.

## Quick start

```bash
quorate                                   # open the interactive shell
quorate doctor                            # see which AI CLIs are installed
quorate review --base main --head HEAD    # one-shot review of the current branch
quorate supply-chain scan --base main --json --gate
quorate solana doctor --strict            # Solana release-readiness gate
quorate solana test-plan                  # next Solana release-test commands
quorate fix --list                        # then delegate a finding to an agent — revertible
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
quorate provider presets                  # 15 presets: ollama, vllm, openrouter, groq, …
quorate provider add local --preset ollama        # picks the model from the LIVE list
quorate provider models openrouter                # list an endpoint's models
quorate provider set-model local                  # switch a provider's model by picking
```

## GitHub Action

```yaml
- uses: actions/checkout@v4
- uses: UmutKorkmaz/quorate@v1.1.0
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

`type: api` providers run real model review on standard GitHub-hosted runners — no
self-hosting required.

## SupplyChainGate

```bash
quorate supply-chain scan --base main --json --gate
```

With `--base` alone, SupplyChainGate runs deterministic dependency and provenance checks
over the complete working-tree diff, including lockfiles and untracked files. Supplying
both `--base` and `--head` compares committed refs and excludes untracked files. It requires matching
lockfile evidence for added npm packages, full commit SHAs for third-party actions,
full image digests for Docker references, and per-publishing-job npm provenance.
`--gate` applies resolved severity/verdict rules but not council-only coverage
constraints, and writes `.quorate/supply-chain/latest.json`.

## Solana / Anchor

```bash
quorate init --pack solana
quorate solana doctor --strict
quorate solana test-plan
quorate review --fail-on high
```

The Solana pack layers 21 deterministic checks for Anchor accounts, CPI and
`remaining_accounts`, transaction confirmation/blockhash expiry, Token-2022, and
constraint/invariant regressions, plus an offline release gate over Anchor/Cargo,
IDL, deployed-program evidence, verifiable-build evidence, and Quorate config.

## Documentation

Full docs, slash-command reference, provider/model configuration, and the GitHub
Action: **<https://umutkorkmaz.github.io/quorate>**

MIT © Umut Korkmaz
