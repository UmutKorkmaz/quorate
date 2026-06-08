# quorate

> A council of AI reviewers for your code — in one CLI.

**Quorate** convenes a *quorate* (a body able to reach a binding decision) of AI
code reviewers over a diff or a plan, deduplicates and ranks their findings, and
returns **one verdict** — PASS / WARN / FAIL — with concrete file-and-line evidence.
It drives the AI CLIs you already have (`claude`, `codex`, `qwen`, …) and any
OpenAI-compatible endpoint, and ships an interactive shell plus a GitHub Action.

```bash
npm install -g quorate
quorate
```

Requires **Node ≥ 22**.

## Quick start

```bash
quorate                                   # open the interactive shell
quorate doctor                            # see which AI CLIs are installed
quorate review --base main --head HEAD    # one-shot review of the current branch
quorate provider add ollama --preset ollama --model qwen2.5-coder:7b
```

In the shell: `/git` to load a diff, `/use available` to enable agents, `/review`
to convene the council. While it runs you can watch each agent live and drill in;
afterward, `/logs` reviews any agent's full output and `/route` reassigns which
agent covers which role (architect, security, qa, performance, maintainer).

- **Many models, one verdict** — independent perspectives, deduplicated and ranked.
- **Honest by default** — a heuristic-only review is reported as *degraded*, never a
  confident green.
- **Safe by design** — real agents are opt-in, spawned without a shell, with
  explicit headless args, byte/time caps, and a dangerous-flag denylist.

## Documentation

Full docs, the slash-command reference, provider/model configuration, and the
GitHub Action: **<https://umutkorkmaz.github.io/quorate>**

MIT © Umut Korkmaz
