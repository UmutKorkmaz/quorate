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
