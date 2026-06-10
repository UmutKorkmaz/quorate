# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Solana pack (slice 1).** `quorate init --pack solana` scaffolds a
  Solana/Anchor review council (councils: solana-security, anchor-accounts,
  transaction-safety, token-safety, maintainer) with per-role reviewer guidance;
  `quorate packs` lists available packs.
- **Shared reviewer prompt builder** (`buildReviewPrompt`) replaces the duplicated
  prompt logic in the api and cli provider runners — byte-identical output when no
  pack is active, and the single place pack `roleGuidance` is injected per role.
- **Three deterministic Solana heuristics**: UncheckedAccount/AccountInfo (high),
  raw CPI invoke/invoke_signed (medium), and skipPreflight: true (medium), with a
  vulnerable/clean Anchor + web3.js diff corpus proving detection and zero false
  positives.
- **Solana pack complete (10 sealevel classes).** Four more on-chain
  Rust heuristics (panic, non-canonical PDA bump, manual account closing,
  unvalidated token account, unchecked arithmetic) plus a diff-shaped Anchor
  constraint-removal check (via a new removedLines pass) and a hardcoded-keypair
  check — 10 distinct vulnerability classes proven by the demo corpus, clean
  Anchor/web3.js fixtures stay finding-free. New "Quorate for Solana / Anchor"
  docs page and a ready-to-copy GitHub Action example workflow.
- **EVM / Solidity pack.** `quorate init --pack evm` scaffolds a Solidity review
  council; 10 deterministic .sol heuristics (tx.origin auth, delegatecall,
  selfdestruct, inline assembly, block.timestamp dependence, unbounded loops,
  floating pragma, ether-via-call, unchecked low-level call, unchecked ERC20
  transfer) with a vulnerable/clean corpus — proves the pack registry
  generalizes (no CLI changes; adding a registry entry is enough). Docs page +
  Action example included.

## [0.7.2] - 2026-06-10

### Added

- `quorate provider set-roles <id> <roles>` — replace a provider's council
  roles in place (validated against the configured councils), without
  round-tripping the whole provider through `provider add`.

### Fixed

- VS Code: "Edit Roles" crashed with "object is not iterable" — the extension
  iterated `doctor --json`'s config object as an array; it now reads
  `config.providers` and uses `provider set-roles` (preserving exotic cli args
  like empty-string flags), surfacing real errors instead of failing silently.

## [0.7.1] - 2026-06-10

### Changed

- Documentation catch-up for 0.7.0 across the README, npm page, and docs site:
  `quorate fix` (snapshot/revert + the judge-fix-re-review loop), live model
  selection (`provider models`/`set-model`, `/models`), the runner-aware GitHub
  Action `auto` mode, and new FAQ entries. No code changes.

## [0.7.0] - 2026-06-10

### Added

- **`quorate fix`** — delegate a finding to a write-mode agent (claude/codex/agy)
  in your real terminal, snapshotted and revertible: the pre-fix state is pinned
  before the agent runs, `--revert` restores tracked files, deletes agent-created
  files, and re-applies your own pre-fix work — refusing when the tree changed
  since (`--force` to override). Offers a council re-review after each fix.
  `/fix` in the shell lists fixable findings.
- **Live model selection.** `quorate provider models <id|preset>` lists models
  from any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, OpenAI,
  OpenRouter, Groq, Together, HF router, DeepSeek, Mistral, Gemini, …);
  `provider set-model` and `provider add` pick interactively; `/models` switches
  a provider model in the shell.
- **VS Code:** full sidebar app (Council / Results / Status), diff-source picker,
  add-provider with live model picking, API keys in the OS keychain, per-reviewer
  live output channels (click a lane to watch the agent), find-path resolution,
  and clear failure reasons per reviewer.
- Opt-in NDJSON chunk passthrough (`QUORATE_JSON_CHUNKS=1`) for streaming UIs.

### Changed

- **GitHub Action: runner-aware `auto` mode** — on GitHub-hosted runners only
  `api` providers (+ heuristic) run, so local CLI agents never produce doomed
  lanes in CI. Marketplace branding added.
- One-shot `quorate review` persists `.quorate/last-report.json` (feeds `fix`).

### Fixed

- API providers are classified as runnable from config (model + key env), not
  PATH; `doctor`/`/inspect` label them correctly.

## [0.6.1] - 2026-06-09

### Changed

- npm README: replaced the misaligned ASCII verdict art with a rendered
  verdict-card image. (Docs only — no code changes since 0.6.0.)

## [0.6.0] - 2026-06-09

### Added

- **9 new API provider presets** for `quorate provider add --preset`: openai, tgi,
  litellm, together, groq, fireworks, deepseek, mistral, gemini (15 total) — any
  OpenAI-compatible endpoint, keys read from env vars.
- Website provider section now tells the full story: local agent CLIs (all 17),
  local model servers, hosted gateways, and the always-on heuristic.

### Fixed

- **API providers are now correctly classified as runnable.** They were treated
  like PATH-detected CLIs, so a configured `type: api` provider showed as "not on
  PATH" and never counted as runnable. Readiness now checks model + key env, and
  `doctor`/`/inspect`/preflight label api providers as configured or missing-env.

## [0.5.2] - 2026-06-09

### Fixed

- The verdict card now stays contained at ~72 columns on wide terminals (it
  previously stretched edge-to-edge into long, sprawling lines), and the
  agreement bar spans the card instead of a fixed 28-char stub — matching the
  designed result view.

## [0.5.1] - 2026-06-09

### Fixed

- Slash-commands docs table no longer shatters on commands whose args contain `|`
  (e.g. `/use <ids|default|available|heuristic>`).
- Docs-site code blocks now render with syntax highlighting.

### Changed

- Improved docs content (a "Common workflows" section, clearer intros) and a
  polished npm README.

## [0.5.0] - 2026-06-08

### Added

- **Live council streaming.** Each running lane shows a one-line activity preview
  of what the agent is doing; drill into a lane (↑/↓ pick, → watch, ←/Esc back) to
  follow its live output, with Esc-again to interrupt the run.
- **`/logs`** (alias `/agent`) — review each agent's full captured output after a
  run, including the real error for a failed provider.
- **`/route`** — view and reassign role→provider routing for the session
  (`/route <role> <providers…>`, `/route reset`).
- **`quorate provider add`** / `remove` / `presets` — manage providers in
  `.quorate.yml` from the CLI, with presets for Ollama, LM Studio, vLLM, llama.cpp,
  the Hugging Face router, and OpenRouter.
- Semantic mode colors in the TUI (review = blue, plan = green, `!` shell = red).
- A README for the GitHub Action documenting how `type: api` providers run real
  review on GitHub-hosted runners.

### Changed

- Redesigned the welcome, running panel, and verdict views to match the design.
- **No input size cap by default** — `maxInputBytes` is now opt-in, and `/git`
  excludes lockfiles/generated files, so large diffs aren't rejected.
- Removed the default `--max-budget-usd` from the built-in `claude` profile
  (subscription auth has no per-token billing).
- `runner-mode` now actually filters providers by type in the GitHub Action.

### Fixed

- **EPIPE crash** when a provider closed stdin before the prompt finished writing.
- **Hidden provider errors** — a failed run now surfaces the real reason instead of
  a generic "all providers failed" / silent degrade.
- The website CSS pipeline (Tailwind was never wired up, so the docs rendered
  unstyled) and finished the redesign.
- Gated untrusted `.quorate/commands` behind `QUORATE_TRUST_WORKSPACE`, constrained
  `/compare` to the repo, and gitignored `.quorate/` session artifacts.

## [0.4.0] - 2026-06-06

### Added

- Cross-model consensus/agreement scoring on findings, so a verdict reflects how
  many reviewers independently raised the same issue.
- Structured (JSON) provider output parsing, with a graceful fallback to text.
- Opt-in inline PR comments from the GitHub Action, anchored to file and line.
- Severity and agreement gates for deciding when a review should fail the check.
- Standard repository documentation (license, contributing guide, security policy,
  issue and pull-request templates).
- Grouped, colored, examples-led `--help` (Setup / Review / Interactive sections)
  with "did you mean?" suggestions for mistyped subcommands.
- `quorate doctor` rebuilt as a verdict-style readiness check: environment
  (Node/git/gh), per-provider state (runnable / needs-profile / not installed)
  with a copy-paste fix, and a closing verdict that names the next command.
- A first-run welcome banner (TUI and shell) showing version, detected reviewer
  count, the honest heuristic-only state, and the next three actions.
- "Did you mean?" suggestions for unknown slash commands, provider ids, and roles.
- A shared `@quorate/core` theme — one palette and glyph set — honoring `NO_COLOR`,
  `FORCE_COLOR`, and `QUORATE_ASCII` across the TUI, the classic shell, and doctor.
- A segmented status line (mode · providers available · diff · last verdict),
  modeled on Oh My Posh segments.
- The **indigo + amber "Council Chamber" visual identity** from the Quorate design
  system: a truecolor palette (indigo `#6E97FF` brand, amber `#FBBF24` council
  accent), an amber braille spinner, amber cross-model agreement dots, per-role
  hues (architect/security/qa/performance/maintainer), and a refined severity ramp.
  Colors render as 24-bit truecolor and downsample gracefully on limited terminals.

### Changed

- Honest degraded verdicts are now a visual law everywhere: a heuristic-only PASS
  renders as an amber `PASS · heuristic` chip in the TUI and a `(heuristic only)`
  marker on the Markdown / PR-comment verdict line — never a confident green block.
- `--version` is read from the package manifest at runtime, so it can never drift
  from the published version.
- Semantic (lexical-similarity) finding clustering replaces exact-text dedup, so
  near-duplicate findings from different models collapse into one.
- All packages aligned to version 0.3.0.

### Fixed

- GitHub Action comment upsert now matches by marker, so it correctly updates
  comments authored under a PAT rather than posting duplicates.
- Base-branch fallback uses the repository default branch when no base is given.
- Total-diff size guard for large pull requests.
- Friendlier CLI errors when a diff cannot be loaded.

## [0.2.2]

- Initial public release line.
