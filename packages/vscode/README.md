# Quorate — AI Review Council (VS Code)

Convene [Quorate](https://github.com/UmutKorkmaz/quorate)'s multi-agent AI review
council on your current change without leaving the editor. The extension drives
your installed `quorate` CLI, reads its `--json` report, and surfaces every finding
as an editor diagnostic with the single **PASS / WARN / FAIL** verdict in the status bar.

## Requirements

```bash
npm install -g quorate     # the extension shells out to this CLI
```

Requires **Node ≥ 22** and a git repository with a base branch to diff against.

## Use

- Run **Quorate: Review Current Changes** from the Command Palette (or click the
  `⚖ Quorate` status-bar item).
- Findings appear in the **Problems** panel and as squiggles on the offending lines;
  the status bar shows the verdict (`$(check)` PASS / `$(warning)` WARN / `$(error)` FAIL).
- **Quorate: Clear Findings** removes them.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `quorate.cliPath` | `quorate` | Path to the CLI (or `quorate` if on PATH). |
| `quorate.baseBranch` | `main` | Base branch to diff the current branch against. |
| `quorate.providers` | `` | Comma-separated provider ids to enable (blank = use `.quorate.yml`). |

## How it works

The extension spawns `quorate review --base <baseBranch> --json` in the workspace
root, parses the final NDJSON line (the full `CouncilReport`), maps findings to a
`DiagnosticCollection`, and shows the verdict. No engine code is duplicated — the
review runs entirely in the Quorate CLI, so it uses your `.quorate.yml` council
(local agent CLIs, `type: api` model endpoints, and the always-on heuristic).

## Build from source

```bash
npm install
npm run compile     # type-check
npm run build       # bundle -> dist/extension.js
# press F5 in VS Code to launch an Extension Development Host
```

MIT © Umut Korkmaz
