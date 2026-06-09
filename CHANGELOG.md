# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
