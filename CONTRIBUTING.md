# Contributing to Quorate

Thanks for your interest in improving Quorate. This guide covers the development
setup and the conventions we follow.

## Development setup

Quorate requires **Node ≥ 22.22.0**.

```bash
git clone https://github.com/UmutKorkmaz/quorate
cd quorate
npm install
npm run build
npm test
```

Tests run on [Vitest](https://vitest.dev/) via `npm test`. Keep them green before
opening a pull request.

## Repository layout

Quorate is an npm workspace with three packages:

| Package | Purpose |
| --- | --- |
| `packages/core` (`@quorate/core`) | The review engine: orchestration, providers, dedup/clustering, ranking, verdicts. Shared by the CLI and the Action so a review behaves identically everywhere. |
| `packages/cli` (`quorate`) | The `quorate` binary and the Ink-based interactive TUI. |
| `packages/github-action` (`@quorate/github-action`) | The GitHub Action wrapper around the engine. |

Pure TypeScript/Node — there is no native build step.

### The GitHub Action bundle

The Action ships a committed bundle at `packages/github-action/dist/index.js`.
This file is what the Action actually runs, so it **must be rebuilt** whenever the
Action's source changes. Run `npm run build` and include the regenerated
`dist/index.js` in the same pull request as the source change.

## Commit messages

Use conventional, descriptive commit messages — a short imperative subject that
explains the change (for example, `fix: match action comments by marker`). Keep
each commit focused on one logical change.

## Pull requests

- Keep `npm test` green. CI runs the suite on the **ubuntu / macOS / Windows**
  matrix on Node 22.22.0; a PR should pass on all three.
- If you touch the Action source, rebuild and commit `dist/index.js`.
- Update `CHANGELOG.md` under the in-progress section when your change is
  user-visible.
