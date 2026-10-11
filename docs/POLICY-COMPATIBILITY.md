# Policy compatibility audit

`quorate rules doctor --manifest rules-audit.json --json` reads explicitly selected files. It never starts an agent, executes hooks, applies patches or edits configuration. Fixture analysis proves parsing and classification; native runtime enforcement remains unverified unless separately observed.

Manifest schema 1 contains installed tool versions and selected file descriptors:

```json
{"version":1,"tools":{"claude-code":"2.1.0","cursor":"2026.10.01"},"files":[{"tool":"claude-code","path":".claude/settings.json","kind":"settings","scope":"project"},{"tool":"cursor","path":"src/AGENTS.md","kind":"instructions","scope":"project"}]}
```

Kinds are `settings`, `instructions` or `rules`; scopes are `user`, `project`, `local`, `managed` or `session`. All selected files must be inside the working directory. External user/managed files require a deliberately prepared disposable corpus rather than implicit home-directory discovery. Installed version strings are supplied explicitly; this command does not run tool executables to discover them. Absent version data remains unknown.

Each report record includes source path, content digest, path scope, precedence description, installed version, support classification and native observation status. `advisory` means prompt context. `runtime-control` means a documented settings capability, not proven enforcement. `unsupported` means a documented incompatibility or explicitly untranslatable request. `unknown` covers unrecognized syntax/settings, incomplete imports or unverified version compatibility.

The conservative MVP maps Claude `permissions.allow/deny/ask` and Cursor CLI `permissions.allow/deny`. Unsupported settings stay visible. Hooks and MCP configuration are not executed or analyzed into permissions. Claude inline instruction imports outside Markdown fenced code and code spans remain unexpanded and make the audit incomplete. Claude rule frontmatter accepts an array or comma-separated string of paths. Literal allow/deny overlap is a conflict; semantic pattern overlaps require separate evaluation and are not exhaustively inferred. Opaque prose contradictions cannot be reliably detected; structured translation requests and settings conflicts are reported without claiming natural-language completeness.

Optional `generated` descriptors include `path` and `expectedDigest` (SHA-256) for drift checks. `translations` contain `source`, `targetTool`, `capability`; runtime-control translation is unsupported. No compiler or patch application is provided in this MVP.

Reports are deterministic/versioned and avoid raw rule content or secrets. Exit 0 means a valid supported corpus, 1 means observed conflicts or digest drift, 2 means malformed, missing, unsupported or incomplete audit evidence. Maximum manifest/file size is 1 MiB, with 200 selected files maximum; symlink escape is rejected. Existing provider configuration remains untouched.

Official mappings researched 2026-10-11:

- [Claude settings](https://code.claude.com/docs/en/settings): strict JSON; managed/session/local/project/user precedence; permission lists merge.
- [Claude memory](https://code.claude.com/docs/en/memory): instruction files are context with no strict-compliance guarantee; nested files load on demand.
- [Claude permissions](https://code.claude.com/docs/en/permissions): documented permission capabilities and deny/ask evaluation.
- [Cursor rules](https://cursor.com/docs/rules): MDC frontmatter controls prompt inclusion; nested AGENTS instructions have directory scope.
- [Cursor CLI permissions](https://cursor.com/docs/cli/reference/permissions): permission tokens and deny-first resolution.
- [Cursor CLI configuration](https://cursor.com/docs/cli/reference/configuration): project configuration only supports permissions.
