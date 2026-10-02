# Quorate Engineering Roadmap

**Canonical status source**
**As of:** v1.4.1 published · 2026-10-02

This file is the active engineering sequence. Product concepts in
[`AI-PRODUCT-SUITE-PLAN.md`](./AI-PRODUCT-SUITE-PLAN.md) are horizon/backlog material, and
[`LAUNCH.md`](./LAUNCH.md) is a go-to-market checklist. Neither overrides this roadmap.

Quorate currently includes the multi-provider council, VerdictGate, PlanCourt,
ReviewGraph, 19 domain packs, 15 provider presets, GitHub Action, GitHub App, CLI,
and VS Code surfaces.

## Active sequence

1. **Phase 0 — SupplyChainGate v1.1 stabilization** — done (v1.1.0)
2. **Phase 1 — ProofRunner Lite** — local, trusted-signer, and GitHub-hosted proof paths verified
3. **Phase 2 — ContractCourt MVP** — merged; 14 fixture verdicts and exit codes verified on all three CI operating systems
4. **Phase 3 — CI adoption hardening** — container, CLI, editor Fix/Revert and remote CI verified; live installed-App acceptance remains open
5. **Phase 4 — Design-partner validation** — measurement tools and onboarding protocol available; partner validation pending

Phase 0 satisfied its exit gate with the v1.1.0 release. Phase 1 and Phase 2
MVPs and subsequent hardening are merged through [PR #35](https://github.com/UmutKorkmaz/quorate/pull/35)
at `a37fcde63edc11af6b26e1350258dc6938e8e3d4`. Linux, macOS and Windows CI passed.
The local release matrix passed 1,618 tests with one platform-specific skip;
Windows passed 1,578 tests with 41 skips for documented platform limits.
Dependency audit reports zero vulnerabilities. Publication is a separate gate:
check the Release workflow, GitHub release and published npm package rather than
inferring distribution from merged source. Cross-machine proof trust and partner
outcomes remain separate exit gates.

## Phase 0 — SupplyChainGate v1.1 stabilization

**Goal:** ship a deterministic dependency/provenance lane that is safe to use as
a merge gate across the CLI, normal council runs, and the GitHub Action.

### Scope

- Detect npm dependency additions without matching lockfile evidence.
- Detect mutable GitHub Actions, Docker-based Actions, and Docker base images.
- Detect token-based npm publishing without both OIDC permission and provenance.
- Preserve complete lockfile evidence outside the AI-review budget filter.
- Fail closed when the GitHub API omits or truncates diff content.
- Read opt-in Action configuration from the trusted base branch.
- Keep the standalone deterministic gate independent of council coverage rules.
- Publish aligned CLI, Action, website, config, changelog, and release guidance.
- Regenerate the tracked GitHub Action runtime bundle.

### Security invariants

- Repository policy/config/baseline/suppressions used by the Action come from
  canonical paths on the PR base ref; PR inputs cannot redirect or weaken them.
- PR-controlled inline comments cannot suppress SupplyChainGate findings.
- A lockfile update counts only when the repository's resolved package manager has
  exact, compatible resolution and integrity evidence for the dependency; adjacent,
  unrelated, deleted, ambiguous, or unavailable lockfile evidence does not pass.
- Action refs require a full 40-character commit SHA; container images require a
  full 64-hex SHA-256 digest.
- An incomplete diff is a high-severity finding, never silent success.

### Exit gate

- [x] Core, CLI, normal council, and opt-in Action paths implemented.
- [x] Fail-open regression cases covered by automated tests.
- [x] v1.1.0 workspace versions, changelog, and immutable Action refs finalized.
- [x] Action bundle and public docs included in the release surface.
- [x] Full local release verification passes: build, typecheck, all tests, website,
  GitHub App, VS Code package, package dry-runs, and CLI pass/fail smokes.
- [x] Changes are reviewed and handed off without publishing from a dirty tree.

The complete gate was verified from a clean snapshot with
[`scripts/release.sh`](../scripts/release.sh) before the v1.1.0 GitHub and npm release.

## Phase 1 — ProofRunner Lite

**Goal:** attach reproducible local proof to a Quorate verdict.

MVP:

- Detect or configure test, typecheck, lint, and build commands.
- Run proof steps with bounded output and duration.
- Record command, exit code, duration, and changed artifacts in
  `.quorate/proofs/latest.{json,md}`.
- Add `quorate review --proof <path>`.
- Support an optional Playwright smoke command when already configured.

Status: the MVP and hardening are merged on main
(`packages/cli/src/proof-runner.ts`): `quorate proof run/show/verify` writes
`.quorate/proofs/latest.{json,md}`, and review evidence attaches by proof
fingerprint rather than by trusting arbitrary artifact claims. The implemented
artifact path is `.quorate/proofs/`. Explicit `--proof <path>` attachment and
command discovery exist. Current hardening adds complete credential redaction,
bounded retained proof history, and portable content-integrity decision records;
the local proof signature is not a cross-machine execution attestation.

**Exit gate:**

- [x] A reviewed PR revision produces a portable proof artifact showing tests and build
  passed.
- [x] The council includes that evidence without trusting arbitrary artifact
  claims.

The local fixture proof verifies with its signing key. The optional
[portable proof statement](./PORTABLE-PROOFS.md) is verified in an independent
checkout and an offline Linux container using only an explicitly supplied public
key. Wrong signers, tampered payloads and stale checkouts fail. This closes the
portable trusted-signer statement path.

[Hosted proof run 36922893413](https://github.com/UmutKorkmaz/quorate/actions/runs/36922893413)
passed on PR #37's merged revision `b13f06059101d27af24f033d33eadefb044b0ddd`:
1,636 tests passed (one platform skip), typecheck passed, and build passed. Its
GitHub OIDC/SLSA attestation verified in a separate clean checkout; a wrong
workflow identity was rejected and a council review attached the verified proof.
The workflow is main-only. Provenance identifies the expected hosted producer;
it does not establish that trusted code or runner infrastructure is uncompromised.
A standalone public-key signer assertion remains a distinct trust mode.

## Phase 2 — ContractCourt MVP

**Goal:** detect externally visible contract drift before merge.

MVP:

- Compare API/schema/config surfaces selected by repository policy.
- Classify additive, breaking, and ambiguous changes.
- Emit stable findings and machine-readable evidence.
- Start with one proven contract type; do not launch a broad compatibility suite.

Status: merged and fixture-verified. The core
engine plus `quorate contract check` with `--spec/--base/--head/--before/--after/--gate`, the
`.quorate/contract/latest.{json,md}` artifacts, and `quorate metrics` local
aggregation are implemented. All 14 bundled fixtures have checked verdicts and
exit codes (8 BLOCK, 5 WARN, 1 PASS). Shared request/response enum changes and
unsupported schema facets are documented in the corpus README. This is regression
coverage, not a general precision/recall benchmark.

**Exit gate:** a vulnerable/clean corpus proves detection of breaking changes with
bounded false positives.

## Phase 3 — CI adoption hardening

**Goal:** make first-week adoption predictable for real repositories.

Local implementation now covers an offline fail/fix/pass demo, shared provider
readiness, portable decision records, report-bound editor fixes, trusted hosted
configuration/policy, durable webhook jobs, and App/Docker CI checks. Container
health and valid/invalid signed webhook pings pass. A real VS Code extension host
activates, completes Doctor, reviews a fixture, creates a diagnostic, opens the
correct file/line, and opens the verdict panel. The interactive editor Fix/Revert journey passed in a real extension host with a
deterministic fixture agent and native confirmation dialog; pre-existing dirty
content survived and the agent-created file was removed. Live installed-App
delivery still needs acceptance evidence.

Windows audit and spool behavior is tested on the Windows runner; ProofRunner
execution intentionally fails closed there. See [SECURITY.md](../SECURITY.md).
Codex turn-completion notify setup is implemented and preserves existing notify keys.

- Generate and validate GitHub Action setup.
- Add contract-drift checks for Action metadata and public docs.
- Improve package/install smoke coverage and release automation dry-runs.
- Document baseline, suppression, policy, SARIF, and ReviewGraph paths as one flow.

**Exit gate:** a clean repository can install Quorate, run a real gate, export
evidence, and diagnose failure from documented commands alone.

## Phase 4 — Design-partner validation

**Goal:** validate which workflow deserves the next product investment.

Local feedback and offline paired-report evaluation provide measurement tools.
The [partner validation protocol](./PARTNER-VALIDATION.md) specifies onboarding,
human labels, held-out comparisons and hosted-App evidence.
Adaptive scheduling is opt-in and preserves policy requirements. No partner
results, live-model precision/recall, cost improvement, or calibrated confidence
are established by these implementations or synthetic tests.

- Recruit a small set of active repositories.
- Measure setup time, gate reliability, actionable finding rate, and false-positive
  handling.
- Use observed workflows to choose between deeper ProofRunner, ContractCourt, and
  hosted EvidenceGraph work.

**Exit gate:** multiple repositories use the gate repeatedly and provide enough
evidence to prioritize the next build without relying on feature-count ambition.

## Completed foundation

| Capability | Status |
| --- | --- |
| Stable finding fingerprint and review identity | Done |
| Baseline mode | Done |
| Portable VerdictGate policy | Done |
| Setup generators and risk report | Done |
| Suppression management | Done |
| Review history and stats | Done |
| SARIF, JUnit, HTML, and Markdown export | Done |
| Budget guardrails and cost summary | Done |
| Provider readiness testing | Done |
| PR context injection | Done |
| ReviewGraph surfaces | Done |
| PlanCourt gate workflow | Done |
| Custom pack format | Done |
| Live monitor, approvals, trust ledger | Done (v1.4.0) |
| ProofRunner Lite | Local execution, trusted-signer portability, and hosted GitHub provenance verified |

## Release order

For any public release: verify locally → branch/PR → required CI and review → Git
tag → GitHub Release → npm publication. Never publish npm first.

v1.4.0 is available on [GitHub](https://github.com/UmutKorkmaz/quorate/releases/tag/v1.4.0)
and [npm](https://www.npmjs.com/package/quorate/v/1.4.0), from commit
`298b55ae60e76602fd97d97f29ffab3930bb5a0b`. The release workflow uses npm trusted
publishing (OIDC), with account 2FA retained and bypass tokens disallowed.
[Release run 36976291800](https://github.com/UmutKorkmaz/quorate/actions/runs/36976291800)
accepted the publish and signed provenance, but reported failure because its
immediate registry verification returned 404 during npm processing. The existing
published version was subsequently verified through a fresh install, version/help
checks, passing clean and failing unsafe supply-chain gates, registry signatures,
and provenance matching the release workflow and commit. The helper now retries
registry visibility before published CLI smokes; this version must not be republished.
Installed-App acceptance requires an accessible installation and test repository;
design-partner validation requires actual participants and held-out human labels.

## Approved regression proof work (2026-10-02)

Integration reliability repairs and the first Vitest regression-proof subsystem
are being implemented locally. See [integration acceptance](INTEGRATION-ACCEPTANCE.md)
for observed checks and pending native/platform evidence. This work does not imply
new publication, hosted App delivery or design-partner validation.
