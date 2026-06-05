# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - Unreleased

### Added

- Cross-model consensus/agreement scoring on findings, so a verdict reflects how
  many reviewers independently raised the same issue.
- Structured (JSON) provider output parsing, with a graceful fallback to text.
- Opt-in inline PR comments from the GitHub Action, anchored to file and line.
- Severity and agreement gates for deciding when a review should fail the check.
- Standard repository documentation (license, contributing guide, security policy,
  issue and pull-request templates).

### Changed

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
