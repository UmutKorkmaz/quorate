# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
