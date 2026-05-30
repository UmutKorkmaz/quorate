# Quorate

Quorate is a CLI-first, GitHub-ready review council for software projects.
It routes a diff or plan to specialist reviewers, aggregates their findings, and
returns one verdict with concrete evidence.

The local CLI can detect AI tools already available on this laptop. The first
implementation supports these provider ids by default:

`claude`, `codex`, `agy`, `hermes`, `kimi`, `qwen`, `minimax`, `opencode`,
`kilo`, `droid`, `crush`, `cline`, `goose`, `copilot`, `grok`, `agent`, `ollama`.

The safe default provider is `heuristic`, which does not call external AI tools.
Real CLI providers are opt-in in `.quorate.yml`.

## Install

```bash
npm install -g quorate
quorate
```

`quorate` opens the interactive shell. Node >= 22 is required.

For development in this repository:

```bash
npm install
npm run build
```

`npm run build` builds the TypeScript packages. There is no native build step.

Use the local CLI through npm workspace execution:

```bash
npm exec --workspace quorate -- quorate doctor
npm exec --workspace quorate -- quorate review --diff examples/sample.diff
npm exec --workspace quorate -- quorate shell
```

## Configure

Create a starter config:

```bash
npm exec --workspace quorate -- quorate init
```

Then enable only providers you have authenticated and tested. Provider commands
are spawned without a shell, prompts are sent through an explicit input mode, and
dangerous/session-resume flags are rejected unless a provider profile opts out.
If `.quorate.yml` is absent, Quorate falls back to the safe built-in
heuristic config.

## Interactive Shell

The interactive shell is a slash-command-first review console. Press `/` to
open the command palette, use arrow keys to select a command, `Tab` to
complete it, and `Enter` to run it.

```bash
npm exec --workspace quorate -- quorate shell
```

Useful shell flags:

| Flag | Purpose |
| --- | --- |
| `--classic` | Use the legacy inline shell instead of the native TUI. |
| `--providers ids` | Start with a comma-separated provider selection. |
| `--mode review\|plan` | Choose how bare text is interpreted. |

The shell is slash-command first:

```text
/providers
/use heuristic
/diff examples/sample.diff
/review local smoke
/plan migrate auth to passkeys
/last
/json council-report.json
/exit
```

When stdin is piped, the shell falls back to line-by-line mode for scripts.

Bare text follows the current mode. In `review` mode it reviews the loaded/current
diff with that text as the subject. "Current diff" means staged plus unstaged
`git diff`; use `/git [base] [head]`, `/diff <path>`, or `/pr <number>` to load
a specific diff first. In `plan` mode, bare text asks the council to evaluate
the text as a plan.

Useful shell commands:

| Command | Purpose |
| --- | --- |
| `/providers`, `/doctor` | Show local availability and whether profiles are runnable. |
| `/use heuristic` | Use the safe built-in reviewer only. |
| `/use available` | Enable every detected provider for the session; this can spend tokens and only runnable profiles execute. |
| `/enable codex`, `/disable claude` | Add or remove providers without changing config files. |
| `/roles architect,qa` | Limit the council roles for the next runs. |
| `/mode review`, `/mode plan` | Change how bare text is interpreted. |
| `/rerun`, `/history` | Repeat the last request or inspect recent commands. |
| `/json path`, `/markdown path` | Export the last report. |

Real provider profiles must be headless and explicit. Important fields:

| Field | Meaning |
| --- | --- |
| `args` | Command arguments; empty CLI args are refused for safety. |
| `inputMode` | `stdin`, `prompt-file`, or `none`. |
| `timeoutMs`, `killGraceMs` | Runtime cap and forced-kill grace period. |
| `maxInputBytes`, `maxOutputBytes` | Prompt/output caps before a provider is refused or killed. |
| `{promptFile}`, `{diffFile}`, `{role}`, `{subject}` | Placeholders expanded in provider args. |

## GitHub Action

For this repo:

```yaml
jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: ./
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Use a self-hosted runner when the PR bot should call locally authenticated CLIs
such as `claude`, `codex`, `qwen`, or `kimi`. Use GitHub-hosted runners for the
default heuristic provider or future API-backed providers.
