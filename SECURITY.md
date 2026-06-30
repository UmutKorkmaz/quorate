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
- **No shell.** Providers are spawned directly, never through a shell, so there is
  no shell-injection surface.
- **Explicit headless args.** Each provider runs with explicit headless arguments;
  empty args are refused so no interactive session is ever opened.
- **Dangerous-flag denylist.** Session/resume and `--dangerously*`/`--yolo`-style
  flags are rejected unless a profile explicitly opts in with `allowDangerousArgs`.
- **Byte and time caps.** Prompts and output are bounded by `maxInputBytes` /
  `maxOutputBytes`, and runtime is bounded by `timeoutMs` with a forced-kill grace
  period.
- **Scrubbed environment.** Providers receive a scrubbed environment built from an
  explicit allowlist rather than the caller's full environment.

### GitHub Action

The Action loads `.quorate.yml` from the pull request's **base branch**, never
from the PR head. A pull request therefore cannot supply the configuration that
governs its own review.
