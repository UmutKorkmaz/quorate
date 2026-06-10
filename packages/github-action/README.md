# Quorate GitHub Action

Run a [Quorate](https://github.com/UmutKorkmaz/quorate) review council on every pull
request: multiple AI reviewers over the PR diff, deduplicated into **one verdict**
(PASS / WARN / FAIL) with a summary comment, optional inline comments, and a check
that can fail on severity.

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
      - uses: UmutKorkmaz/quorate@v0.7.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Which reviewers run in CI?

The council is defined by `.quorate.yml`, read from the pull request's **base branch**
(never the PR head — a PR can't supply the config that governs its own review). With
no config, only the built-in **heuristic** runs and the result is reported as
**degraded** (an honest WARN, never a confident green).

| Provider `type` | Runs on a GitHub-hosted runner? | How |
| --- | --- | --- |
| `mock` (heuristic) | ✅ always | Zero setup. |
| **`api`** (hosted/local model) | ✅ **yes** | Point at a hosted OpenAI-compatible gateway and put the key in `secrets`. No CLI install needed — the recommended way to get real AI review in CI. |
| `cli` (`claude`, `codex`, …) | ⚠️ no | Needs a **self-hosted runner** where those CLIs are installed and authenticated. |

The default `runner-mode: auto` is **runner-aware**: on GitHub-hosted runners it
keeps only `api` providers (+ the heuristic), so a council that also lists local
CLI agents never produces doomed "command not found" lanes in CI. Set
`runner-mode: cli` explicitly if your workflow preinstalls and authenticates
agent CLIs.

### Real AI review on GitHub-hosted runners (recommended)

Commit a `.quorate.yml` to your **base branch** with a `type: api` provider pointing
at a hosted gateway (OpenRouter, Hugging Face router, Groq, …):

```yaml
providers:
  - id: heuristic
    type: mock
    enabled: true
  - id: openrouter
    type: api
    enabled: true
    baseUrl: https://openrouter.ai/api/v1
    model: anthropic/claude-sonnet-4.6
    apiKeyEnv: OPENROUTER_API_KEY
    roles: [security, architect]
```

Then pass the key through as an environment variable:

```yaml
      - uses: UmutKorkmaz/quorate@v0.7.1
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          runner-mode: api   # only run HTTP-endpoint providers (+ heuristic)
```

Generate provider entries with `quorate provider add <id> --preset openrouter …`
(run `quorate provider presets` for the full list). Which model covers
which role is the `roles:` field per provider; tune it with `/route` locally before
committing.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | — | Token to read PR files and write comments. |
| `config-path` | `.quorate.yml` | Config file, read from the **base** branch. |
| `providers` | — | Comma-separated provider ids to enable for this run. |
| `fail-on` | `high` | Minimum severity that fails the check (`critical`…`info`, or `never`). |
| `post-comment` | `true` | Post/update the Quorate summary comment. |
| `inline-comments` | `false` | Post findings as inline review comments on changed lines. |
| `inline-comment-limit` | `10` | Max inline comments per run. |
| `runner-mode` | `auto` | Restrict providers by type: `auto` (all), `cli` (local agents only), `api` (HTTP endpoints only). The heuristic always runs. |
| `mode` | `review` | Only `review` is implemented for the Action. |

## Outputs

- `verdict` — the final verdict, lowercase `pass` / `warn` / `fail`.
- `findings` — the number of findings in the report.

```yaml
      - id: quorate
        uses: UmutKorkmaz/quorate@v0.7.1
        with: { github-token: ${{ secrets.GITHUB_TOKEN }} }
      - if: steps.quorate.outputs.verdict == 'fail'
        run: echo "Quorate found ${{ steps.quorate.outputs.findings }} findings"
```

## Security

- Config is loaded from the **base branch**, so a pull request cannot enable a
  provider (or an arbitrary command) that governs its own review.
- API keys are read from the named `apiKeyEnv` at runtime — never stored in
  `.quorate.yml`. Keep them in repository/organization **secrets**.

See the full docs at
[umutkorkmaz.github.io/quorate/docs/github-action](https://umutkorkmaz.github.io/quorate/docs/github-action).

## Solana / Anchor

Quorate ships a Solana/Anchor pack with ten deterministic on-chain heuristics (unchecked
accounts, raw CPI invocations, disabled preflight, panics, non-canonical PDA bumps, unsafe
account closing, unvalidated token accounts, unchecked arithmetic on funds, hardcoded
keypairs, and removed Anchor constraints) plus dedicated council roles for program security,
account safety, transaction correctness, token safety, and maintainability.

Bootstrap a Solana-ready config:

```bash
quorate init --pack solana
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp .github/workflows/quorate-solana.example.yml .github/workflows/quorate.yml
```

The example workflow lives at `.github/workflows/quorate-solana.example.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack solana`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/solana](https://umutkorkmaz.github.io/quorate/docs/solana).

## EVM / Solidity

Quorate ships an EVM / Solidity pack with ten deterministic on-chain heuristics (tx.origin
authorization, delegatecall to untrusted targets, selfdestruct, inline assembly, block
timestamp/number dependence, unbounded loops, floating pragma, Ether send via low-level call,
unchecked low-level call return, and unchecked ERC20 transfer return) plus dedicated council
roles for EVM security, access control, reentrancy, external calls, upgrade safety, and
maintainability.

Bootstrap an EVM-ready config:

```bash
quorate init --pack evm
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp .github/workflows/quorate-evm.example.yml .github/workflows/quorate.yml
```

The example workflow lives at `.github/workflows/quorate-evm.example.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack evm`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/evm](https://umutkorkmaz.github.io/quorate/docs/evm).

## Infrastructure / IaC

Quorate ships an Infrastructure / IaC pack with ten deterministic heuristics (public storage
ACL, unrestricted ingress from 0.0.0.0/0, encryption disabled, public IP assignment, hardcoded
secrets in IaC, privileged containers, host namespace sharing, containers running as root,
privilege escalation allowed, and mutable image tags) plus dedicated council roles for IaC
security, network exposure, secrets management, identity and access, resilience, and
maintainability. Heuristics gate on `.tf`, `.yaml`, and `.yml` files so they never interfere
with Solana or EVM packs.

Bootstrap an IaC-ready config:

```bash
quorate init --pack iac
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp .github/workflows/quorate-iac.example.yml .github/workflows/quorate.yml
```

The example workflow lives at `.github/workflows/quorate-iac.example.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack iac`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/iac](https://umutkorkmaz.github.io/quorate/docs/iac).

## AI / LLM apps

Quorate ships an AI / LLM app pack with ten deterministic heuristics (untrusted input
interpolated into prompt, model output passed to code execution, model output rendered as
unsanitised HTML, unvalidated tool-call arguments, hardcoded LLM API key, LLM prompt/response
logged, model safety/moderation disabled, secret or PII included in prompt, authorisation
decision based on model output, and untrusted external content fed into prompt) plus dedicated
council roles for prompt injection, data privacy, tool safety, output safety, model governance,
and maintainability. Heuristics gate on `.py`, `.ts`, and `.js` files and map to the OWASP LLM
Top 10 and EU AI Act risk categories.

Bootstrap an LLM-app-ready config:

```bash
quorate init --pack llm
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp .github/workflows/quorate-llm.example.yml .github/workflows/quorate.yml
```

The example workflow lives at `.github/workflows/quorate-llm.example.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack llm`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/llm](https://umutkorkmaz.github.io/quorate/docs/llm).

## Move (Sui / Aptos)

Quorate ships a Move pack with ten deterministic heuristics (public entry functions, global
storage mutated without owner check, resource removed from storage, objects shared publicly,
structs with copy ability, integer downcasts, unguarded privileged functions, unchecked vector
index access, key resources with drop ability, and initializer/admin entrypoints) plus dedicated
council roles for move security, capability safety, resource safety, access control, and
maintainability. Heuristics gate on `.move` files and map to common Sui and Aptos audit findings.

Bootstrap a Move-ready config:

```bash
quorate init --pack move
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp .github/workflows/quorate-move.example.yml .github/workflows/quorate.yml
```

The example workflow lives at `.github/workflows/quorate-move.example.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack move`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/move](https://umutkorkmaz.github.io/quorate/docs/move).

## CI/CD & Supply Chain

Quorate ships a CI/CD & Supply Chain pack with ten deterministic heuristics (pull_request_target
trigger misuse, untrusted input interpolated into workflow expressions, actions not pinned to a
commit SHA, over-broad workflow permissions, self-hosted runner usage, checkouts of untrusted PR
heads, install scripts added, hardcoded registry or auth tokens, pipe-to-shell of remote scripts,
and unpinned base images or remote ADD in Dockerfiles) plus dedicated council roles for workflow
security, dependency integrity, secrets exposure, build provenance, and maintainability. Heuristics
gate on `.github/workflows` paths, `Dockerfile`, and shell scripts so they never interfere with
language-specific packs.

Bootstrap a CI-ready config:

```bash
quorate init --pack ci
```

Then activate the ready-to-copy example workflow:

```bash
# copy and rename to activate
cp .github/workflows/quorate-ci-supplychain.example.yml .github/workflows/quorate.yml
```

The example workflow lives at `.github/workflows/quorate-ci-supplychain.example.yml` in the
[Quorate repository](https://github.com/UmutKorkmaz/quorate). Set `OPENROUTER_API_KEY`
in your repository secrets and commit the `.quorate.yml` generated by `init --pack ci`
to your base branch — that is all that is needed for real AI review on a standard
GitHub-hosted runner.

Full reference: [umutkorkmaz.github.io/quorate/docs/ci](https://umutkorkmaz.github.io/quorate/docs/ci).
