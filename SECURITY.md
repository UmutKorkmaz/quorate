# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in Quorate, please report it privately by
emailing **umutkorkmaz@outlook.com.tr**. Include enough detail to reproduce the
issue. Please do not open a public issue for security reports.

You can expect an acknowledgement of your report, and we will keep you informed as
we investigate and prepare a fix.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| 0.10.x | Yes |
| < 0.10 | No |

## Provider safety model

Quorate drives AI CLIs that live on your machine, so provider isolation is a core
part of its design:

- **Opt-in providers.** Real CLI providers are disabled by default; only the
  built-in heuristic runs with zero setup. You enable real reviewers explicitly.
- **Workspace trust gate.** `.quorate/commands/` and `.quorate/packs/` load only
  when `QUORATE_TRUST_WORKSPACE=1` is set. An untrusted clone therefore never
  contributes commands, packs, or their regexes and prompts to a review.
- **No shell.** Providers are spawned directly, never through a shell, so there is
  no shell-injection surface.
- **Explicit headless args.** Providers require nonempty argv. A configured
  `headlessAllowlist` additionally requires a normalized argument matching one of
  its entries; it does not imply every argument is allowlisted. Dangerous flags
  are checked independently. Standard presets supply their supported headless flags.
- **Dangerous-flag denylist.** Session/resume and `--dangerously*`/`--yolo`-style
  flags are matched by boundary-prefix, so compound flags such as
  `--dangerously-skip-permissions` are rejected too — not just exact tokens —
  unless a profile explicitly opts in with `allowDangerousArgs`.
- **Byte and time caps.** Prompts and output are bounded by `maxInputBytes` /
  `maxOutputBytes`, and runtime is bounded by `timeoutMs` with a forced-kill grace
  period.
- **Scrubbed environment.** Providers receive a scrubbed environment built from an
  explicit allowlist rather than the caller's full environment.
- **Redaction on persist.** Provider raw output, errors, exports, and diagnostics
  bundles pass through secret redaction — known key formats, provider-configured
  env values, and URL credentials — before anything is written or shared.

### Platform limits

On Windows, Node's POSIX mode bits do not establish owner-only access; keep the
Quorate state directory in an account-private location with appropriate Windows
ACLs. Audit files are flushed, but Node cannot flush directory handles on
Windows, so directory-entry durability across power loss is not guaranteed.
Signature, hash-chain, file-type and identity checks still apply. ProofRunner
refuses execution on Windows because portable Node cannot guarantee containment
of the complete child process tree.

### GitHub Action

The Action loads `.quorate.yml` from the pull request's **base branch**, never
from the PR head. A pull request therefore cannot supply the configuration that
governs its own review.
