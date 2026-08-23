# Quorate v1.4 Release-Blocker Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the audited correctness, secret-handling, filesystem-safety, portability, and release-truth blockers from the v1.4 candidate.

**Architecture:** Keep core contract semantics in `@quorate/core`; centralize fixed workspace-state persistence in one CLI helper; make every external-data boundary redact, bound, validate, and fail closed; finish with documentation and generated-artifact reconciliation.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Vitest 4, YAML 2, React/Vite documentation, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-23-quorate-release-blockers-design.md`

## Global constraints

- Use strict red-green-refactor TDD for every production behavior change and record the RED and GREEN commands.
- Preserve existing user work and the released Action pin in `.github/workflows/quorate.yml`.
- Do not add runtime dependencies, weaken fail-closed checks, or broaden arbitrary export-path behavior.
- Do not merge, push, edit the pull request, tag, create a release, or publish npm packages.
- Commit each task separately and write the task report requested by the SDD brief.

### Task 1: Redact provider-derived data and diagnostic reports

**Files:**
- Modify: `packages/core/test/api-provider.test.ts`
- Modify: `packages/core/src/api-provider.ts`
- Modify: `packages/cli/test/doctor-bundle.test.ts`
- Modify: `packages/cli/src/doctor-bundle.ts`

**Interfaces:**
- Consumes: `redactSecrets`, provider `apiKeyEnv`, the existing doctor ZIP entry builder.
- Produces: no provider credential in API result fields or diagnostic ZIP bytes.

- [ ] Add an API-provider regression test whose successful response echoes a literal token in a first-line summary and a parsed finding; assert the token is absent from `summary`, every finding string, `error`, and `rawOutput`.
- [ ] Run `npx vitest run packages/core/test/api-provider.test.ts` and capture the expected RED leak.
- [ ] Redact/truncate response text before `parseFindings` and `firstMeaningfulLine`; keep the truncation message and status semantics unchanged.
- [ ] Run the focused core test and capture GREEN.
- [ ] Add a doctor-bundle regression test with secrets nested in report summary/findings/raw output and a provider env variable; assert the literal values are absent from the complete ZIP buffer.
- [ ] Run `npx vitest run packages/cli/test/doctor-bundle.test.ts` and capture RED.
- [ ] Recursively redact report string values with the repository redactor and explicit configured provider environment values before adding the report entry. Refuse unsafe or oversized report reads using the existing fixed-state trust boundary.
- [ ] Run both focused files and capture GREEN.
- [ ] Commit as `fix: redact provider and diagnostic output`.

### Task 2: Harden fixed `.quorate` state persistence

**Files:**
- Create: `packages/cli/src/secure-state.ts`
- Create: `packages/cli/test/secure-state.test.ts`
- Modify: `packages/cli/src/contract-command.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/tui/commands.ts`
- Modify focused integration tests under `packages/cli/test/` as required.

**Interfaces:**
- Consumes: canonical workspace root plus fixed workspace-relative path and UTF-8 content.
- Produces: symlink-safe private directories and atomic owner-only state files.

- [ ] Write helper tests that name the mutations they catch: a symlinked directory, a symlinked destination file, a non-directory component, a victim outside the workspace, and incomplete temporary publication.
- [ ] Run `npx vitest run packages/cli/test/secure-state.test.ts` and capture RED because the helper is absent.
- [ ] Implement the minimum reusable helper using `lstat`, realpath containment, no-follow/exclusive temporary creation, complete write, file fsync, ownership revalidation, atomic rename, cleanup, and parent-directory fsync where supported.
- [ ] Capture helper GREEN.
- [ ] Add integration tests that attack ContractCourt artifacts and the review/plan/TUI fixed `last-report.json` writes; capture RED at each migrated boundary before changing it.
- [ ] Replace direct `mkdirSync`/`writeFileSync` fixed-state writes with the helper. Leave explicit user export paths unchanged.
- [ ] Run all affected CLI tests and capture GREEN.
- [ ] Commit as `fix: harden workspace state writes`.

### Task 3: Correct ContractCourt references and response enum direction

**Files:**
- Modify: `packages/core/test/contract.test.ts`
- Modify: `packages/core/test/contract-edge.test.ts` if the cases fit the edge-case suite better.
- Modify: `packages/core/src/contract.ts`

**Interfaces:**
- Consumes: OpenAPI `$ref` request bodies and request/response field direction.
- Produces: stable breaking/additive findings with correct client/server compatibility semantics.

- [ ] Add a referenced-request-body regression proving a newly required referenced JSON field is detected; capture RED.
- [ ] Resolve the request body object before inspecting `content`; capture GREEN.
- [ ] Add literal expected findings for response enum widening and narrowing: adding a response value is breaking, removing one is additive. Capture RED.
- [ ] Make enum comparison direction explicit while preserving request parameter/body behavior and stable finding identities where semantically applicable.
- [ ] Run `npx vitest run packages/core/test/contract.test.ts packages/core/test/contract-edge.test.ts` and capture GREEN.
- [ ] Commit as `fix: correct contract compatibility semantics`.

### Task 4: Bound specs and verify ContractCourt artifact integrity

**Files:**
- Modify: `packages/cli/test/contract-command.test.ts`
- Modify: `packages/cli/src/contract-command.ts`
- Modify: `packages/cli/test/metrics-command.test.ts`
- Modify: `packages/cli/src/metrics-command.ts`

**Interfaces:**
- Consumes: local OpenAPI files and persisted ContractCourt artifacts.
- Produces: bounded parsing and metrics derived only from valid, hash-matching artifacts.

- [ ] Add a local-spec test over the 5 MiB ceiling and capture RED before YAML parsing.
- [ ] Apply the existing git-spec byte ceiling to local files using a pre-read stat plus bounded/read-length validation; capture GREEN.
- [ ] Add a metrics test that changes a hash-bearing artifact field without updating `artifactHash`; capture RED because it is currently counted.
- [ ] Export/reuse one artifact validator that shape-checks and recomputes the canonical hash. Remove or harden the raw fallback so both loading paths fail closed.
- [ ] Run both focused test files and capture GREEN.
- [ ] Commit as `fix: validate contract inputs and artifacts`.

### Task 5: Make time and audit portability deterministic

**Files:**
- Modify: `packages/cli/test/baseline-command.test.ts`
- Modify: `packages/cli/src/baseline-command.ts`
- Modify: `packages/cli/test/trust-ledger.test.ts`
- Modify: `packages/cli/src/trust-ledger.ts`
- Modify: `packages/cli/test/audit-command.test.ts`
- Modify: `packages/cli/test/hook-report.test.ts` only if an independent failure remains.

**Interfaces:**
- Produces: injectable baseline generation time and platform-correct audit permission validation.

- [ ] Make the existing expiry failure deterministic by passing an explicit creation clock; first record the current RED, then add the smallest optional `now` input and capture GREEN.
- [ ] Add unit coverage proving POSIX mode mismatches fail on POSIX but are not the deciding signal on Windows; keep symlink, file-type, identity, and malformed-state checks platform-independent.
- [ ] Capture RED, then gate only permission-bit equality on `process.platform !== "win32"` (or an injected equivalent) and capture GREEN.
- [ ] Replace the Windows-invalid ESC filename fixture with a platform-valid way to exercise terminal escaping, retaining the behavioral assertion.
- [ ] Run baseline, trust-ledger, audit-command, and hook-report focused tests; capture GREEN.
- [ ] Commit as `fix: stabilize time and windows audit checks`.

### Task 6: Reconcile release documentation and generated output

**Files:**
- Modify: `README.md`
- Modify: `packages/website/src/pages/docs/Contract.tsx`
- Modify: `docs/ROADMAP.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/research/teardown-aider-goose-crush-pi.md`
- Modify: `docs/research/teardown-claude-code-codex.md`
- Modify: `docs/research/teardown-gemini-amp-opencode.md`
- Modify if generated build changes it: `packages/github-action/dist/index.js`

**Interfaces:**
- Produces: valid mutually exclusive ContractCourt examples and honest committed-but-unreleased status.

- [ ] Correct file-mode examples to use only `--before` and `--after`; keep `--spec` only in git mode.
- [ ] Describe ProofRunner and ContractCourt as committed candidates awaiting merge/release verification, not uncommitted work.
- [ ] Consolidate v1.4 changes under one `## [1.4.0] - Unreleased` section while preserving all entries.
- [ ] Remove trailing whitespace from the three research documents without reflowing prose.
- [ ] Run `npm run build`, regenerate the GitHub Action bundle through its normal workspace build, and commit the generated bundle only if it changes.
- [ ] Run `npm run build:website` and `git diff --check`.
- [ ] Commit as `docs: align v1.4 release candidate`.

## Final verification (controller-owned)

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build` and `git diff --exit-code packages/github-action/dist/index.js`.
- [ ] Run `npm run build:website`.
- [ ] Run `git diff --check` and inspect the complete branch diff against `feat/contractcourt-security-batch`.
- [ ] Run `npm audit --omit=dev --audit-level=high` and report dev-only audit findings separately.
- [ ] Obtain a fresh whole-branch code review and resolve all blocking findings.
- [ ] Present the Superpowers finishing options before any integration or external side effect.
