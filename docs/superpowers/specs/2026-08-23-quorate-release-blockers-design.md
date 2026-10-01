# Quorate v1.4 Release-Blocker Remediation Design

**Status:** Approved for local implementation by the user on 2026-08-23

## Objective

Make the existing v1.4 candidate safe, deterministic, cross-platform, and release-reviewable without publishing or changing the open pull request from this worktree.

## Required outcomes

1. Provider output and diagnostic bundles never expose provider credentials through summaries, findings, errors, raw output, or copied reports.
2. Fixed `.quorate` report and ContractCourt artifact paths reject symlinked state directories or target files and publish owner-only files atomically.
3. ContractCourt resolves referenced request bodies, applies response-direction enum compatibility, bounds local spec input, and rejects tampered artifacts in metrics.
4. The baseline expiry test uses an explicit clock, and audit/trust-ledger behavior remains secure without treating unsupported Windows POSIX mode bits as failures.
5. User-facing examples describe the two valid ContractCourt modes, the roadmap/changelog describe the committed-but-unreleased candidate honestly, and research Markdown has no trailing whitespace.
6. Focused tests, the full suite, typecheck, production build, website build, GitHub Action bundle check, and production dependency audit pass before the branch is offered for integration.

## Design decisions

- Redact a provider response once, before deriving any persisted or returned field from it. Diagnostic bundle redaction recursively sanitizes report strings and includes configured provider environment values as explicit secrets.
- Add one CLI-owned secure-state helper for fixed workspace state. It validates the real workspace root and each state-directory component, refuses symlinks/non-directories, writes a uniquely named owner-only temporary file with no-follow/exclusive flags, fsyncs it, revalidates ownership, renames it, and fsyncs the parent directory when supported.
- Keep arbitrary user-selected export paths out of this change; only application-owned fixed `.quorate` paths are hardened.
- Give enum comparison an explicit request/response direction. Request narrowing is breaking; response widening is breaking because generated or exhaustive clients can receive a value they do not understand.
- Recompute a ContractCourt artifact hash from the canonical hash-bearing fields after parsing. Metrics ignore malformed or hash-mismatched artifacts.
- Reuse the existing 5 MiB git-spec ceiling for local spec files and fail before parsing an oversized file.
- Keep symlink/type/race checks on every platform. Skip only POSIX permission-bit equality checks on Windows, where Node cannot provide the same semantics.
- Preserve the immutable released Action used by the secret-bearing pull-request workflow; this remediation does not switch that workflow to PR-local code.

## Non-goals

- No merge, push, pull-request mutation, tag, GitHub Release, or npm publication.
- No broad dependency upgrade or automatic `npm audit fix`.
- No redesign of ContractCourt beyond the audited correctness and integrity gaps.
- No claim that a local pass is equivalent to GitHub, released-package, or production proof.

## Acceptance evidence

- Every behavioral fix has a test observed failing for the intended reason before implementation and passing afterward.
- Symlink tests prove an outside victim is unchanged.
- Secret tests assert the literal token is absent from every returned field and from the ZIP bytes.
- Contract tests cover referenced request bodies plus both response enum additions and removals.
- A tampered artifact cannot contribute to metrics.
- `git diff --check` is clean and generated Action output is committed if the build changes it.
- Final verification commands and their exit statuses are recorded in the SDD ledger.
