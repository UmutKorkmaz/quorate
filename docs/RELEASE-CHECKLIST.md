# Quorate Release Checklist

Use this checklist for the v1.2.0 candidate and later releases. The order is
deliberate: npm publication is the final distribution step, not the first proof.

## Automated entry point

Run the release helper from the merged, clean `main` branch:

```bash
npm run release:verify -- 1.2.0
```

Verification is the default and has no release side effects. It reproduces
dependencies, runs the complete build/test/package/smoke matrix below, and checks
that generated artifacts are already committed.

After the pull request and pinned-Action follow-up have passed their required
checks, finalize the changelog date and run the publishing mode with an exact
version confirmation:

```bash
CONFIRM_RELEASE=v1.2.0 npm run release:publish -- 1.2.0
```

Publishing enforces this order: annotated Git tag → GitHub Release → `quorate`.
The CLI bundles the workspace core, so `@quorate/core` is package-smoked but is
not a separate public npm artifact. GitHub Actions adds npm provenance. A local
publish fails closed unless `ALLOW_NO_PROVENANCE=1` is explicitly set; the
provenance path is recommended.

## 1. Confirm scope

```bash
git status --short --branch
git diff --check
```

- Verify every dirty or untracked file belongs to the intended release.
- Do not release from a tree with unexplained changes.

## 2. Reproduce dependencies

```bash
npm ci
npm audit --audit-level=high
```

## 3. Build and verify every surface

```bash
npm run build:js
npm run typecheck
npm run typecheck --workspace @quorate/github-app
npm run build --workspace @quorate/github-app
npm run build:website
npm run package:vscode
npm test
```

The Action build must recreate `packages/github-action/dist/index.js`. Build it a
second time and compare its SHA-256 hash to prove generation is deterministic.

## 4. Package dry-runs

```bash
npm pack --workspace @quorate/core --dry-run
npm pack --workspace quorate --dry-run
```

Inspect the file lists. The CLI package must include its executable bundle and the
core package must include runtime JavaScript plus declarations.

## 5. CLI smokes

```bash
node packages/cli/dist/index.js --version
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js supply-chain scan --help
node packages/cli/dist/index.js supplychain scan --help
```

Run one clean fixture and one deliberately unsafe fixture. Verify:

- JSON and Markdown outputs are valid.
- `.quorate/supply-chain/latest.json` is written.
- a clean gate exits zero.
- an unsafe gate exits non-zero at the configured threshold.
- untracked relevant files are scanned.

## 6. Review and publish

1. Create a release branch and pull request.
2. Wait for required CI and review checks.
3. Merge the reviewed candidate.
4. Record the merged commit containing `packages/github-action/dist/index.js` and
   replace tag-based Action references in generated workflows and public examples
   with that full 40-character SHA in a reviewed follow-up change.
5. Create the Git tag only after the pinned-reference follow-up passes CI.
6. Create the GitHub Release with final notes.
7. Publish npm packages.
8. Install the published CLI in a clean temporary directory and repeat the version,
   help, clean-gate, and failing-gate smokes.

The helper validates the clean branch, aligned workspace versions, release notes,
GitHub/npm authentication, immutable public Action references, absent tag/release/
package versions, and `origin/main` parity before it creates any release artifact.

### v1.2.0 Action evidence

- Canonical Action commit: `34afb7c13faa405bdf833a096f401a42a71f6f1b`,
  committed on `main` before the immutable-reference follow-up.
- Bundled runtime SHA-256:
  `8abbb1bf1f927ef1a4224eb3c5396928ef3f0fd35579ec6800386f1c049052b1`.

The Action pin intentionally predates the docs/setup follow-up: a commit cannot
contain its own hash. The release helper proves that every public ref uses this
single commit, that it is an ancestor of the release commit, and that its
`packages/github-action/dist/index.js` is byte-identical to the release bundle.

If any stage fails, fix it and restart verification from the earliest affected
stage. Do not skip ahead to npm publication.
