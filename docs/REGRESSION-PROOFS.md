# Regression proofs (local candidate)

A regression proof overlays exactly the selected HEAD test bundle onto disposable BASE and HEAD checkouts. It verifies one named assertion only when BASE reproduces the declared failure and HEAD passes. The original checkout must be clean and remains untouched. This feature is implemented locally and has not been published.

Supported execution: Linux/macOS, Node 22.22+, configuration-free standalone npm packages and installed Vitest 4.x. Workspaces, nested packages, custom Vite/Vitest configuration, dependency/configuration changes, executable support files and Windows execution are refused or inconclusive. Windows can inspect reports. This is a conservative first adapter, not a sandbox for untrusted tests: execute only operator-approved test code and dependencies. Disposable checkouts protect source preservation; tests still run as your OS user.

## Explicit manifest

Store the manifest outside the source checkout or in its ignored `.quorate/regressions` directory. Commit the selected test and support files to HEAD first. BASE must be an ancestor of HEAD.

```json
{
  "schemaVersion": 1,
  "id": "value-fix",
  "base": "<base-commit>",
  "head": "<head-commit>",
  "runner": "vitest",
  "testFiles": ["test/value.test.js"],
  "supportFiles": [],
  "assertion": {"fullName": "fixes value", "expectedFailureText": "expected +0 to be 1"},
  "setupArgv": ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
  "runArgv": ["node_modules/.bin/vitest", "run", "test/value.test.js", "--reporter=json"],
  "timeoutMs": 120000,
  "setupTimeoutMs": 600000,
  "maxOutputBytes": 65536
}
```

Setup is optional and explicit. Only `npm ci --ignore-scripts` and the documented no-audit/no-fund/offline options are accepted. There is no implicit dependency installation. BASE and HEAD use the same committed lockfile and an owned HOME/cache. Installation can access the configured npm registry and selected tests can access the network. Runner results, stream sizes, timeouts, process-group teardown and immutable input hashes are checked. Setup/import failures, missing or skipped assertions, truncated/malformed output, cancellation, mutation and failed cleanup cannot verify a fix.

Selected asset paths and their parent components must not alias differently spelled committed paths in either revision, including case-only renames. Suite totals must reconcile with file outcomes and nested assertion ancestors. Empty or duplicate-named nested suites that cannot be reconstructed from reporter JSON remain inconclusive; suite counters are never assumed to be trustworthy on their own.

```sh
quorate proof regression run --manifest /absolute/path/regression.json --json
quorate proof regression show --report .quorate/regressions/latest.json
quorate proof regression verify --report .quorate/regressions/latest.json \
  --manifest /absolute/path/regression.json --base <base-sha> --head <head-sha> \
  --key-dir /absolute/trusted/key-directory --json
```

Run exits: 0 verified, 1 contradicted (not reproduced or not fixed), 2 inconclusive or invalid input. Cancellation saves an inconclusive report when inputs can be safely resolved and owned checkouts cleaned. Show and verify execute and install nothing. Show is unverified inspection. Verify checks content/trust/revision identity, not a new execution; read the report outcome separately.

Reports bind full revisions, manifest/bundle/environment digests, source fingerprint and bounded redacted observations. `.quorate/regressions/history/<artifactHash>.json` is immutable; per-ID and latest JSON/Markdown are atomic copies. The newest publication plus 99 prior valid signed records are retained. Signing keys live outside the repository, by default `~/.quorate/regressions`, mode 0700 with a 0600 key. `--key-dir` or `QUORATE_REGRESSION_KEY_DIR` explicitly selects local trust. Symlinked key directories are refused; use their canonical absolute path. A local signature is a **local assertion**, not hosted execution attestation. `verify --expected-hash <sha256>` checks **content-only** integrity and never establishes execution authority.

## Opt-in review attachment

```sh
quorate review --base <base-sha> --head <head-sha> \
  --regression-report .quorate/regressions/latest.json \
  --regression-manifest /absolute/path/regression.json \
  --regression-key-dir /absolute/trusted/key-directory --require-regression
```

Required evidence is enforced before contacting providers. Missing, stale, contradicted or inconclusive evidence blocks; invalid, tampered, unsupported or untrusted artifacts are errors. Without `--require-regression`, current or incomplete valid evidence is visibly attached and normal AI review policy controls the exit. Omitted regression flags preserve normal review behavior. Explicit Git BASE/HEAD is required, and its merge base must match the regression BASE. Existing ordinary proof evidence is combined within 8 KiB; if necessary its content is replaced by a digest and an omission label. The decision receipt's `inputs.proofHash` binds the exact combined summary. Generic `--proof` files never acquire regression authority. No head-controlled policy discovery or automatic GitHub App/Action gate is included.

## Evidence coverage

The frozen corpus has 24 labeled cases: four each for fixed bugs, unfixed bugs, ineffective tests, setup/environment problems, skipped/empty/unsupported observations, and interrupted/malformed executions. Four cases execute real installed Vitest; the other 20 are deterministic captured-output fixtures. Additional real-process tests cover import errors, production mutation, secret redaction, setup-output truncation and cancellation. These checks provide regression coverage, not a general accuracy score. macOS acceptance is recorded in `INTEGRATION-ACCEPTANCE.md`; Linux and Windows hosted checks require the candidate to reach CI before release.
