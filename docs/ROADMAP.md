# Quorate Engineering Roadmap

**Canonical status source**
**As of:** v1.4.0 working tree · 2026-08-14

This file is the active engineering sequence. Product concepts in
[`AI-PRODUCT-SUITE-PLAN.md`](./AI-PRODUCT-SUITE-PLAN.md) are horizon/backlog material, and
[`LAUNCH.md`](./LAUNCH.md) is a go-to-market checklist. Neither overrides this roadmap.

Quorate currently includes the multi-provider council, VerdictGate, PlanCourt,
ReviewGraph, 19 domain packs, 15 provider presets, GitHub Action, GitHub App, CLI,
and VS Code surfaces.

## Active sequence

1. **Phase 0 — SupplyChainGate v1.1 stabilization** — done (v1.1.0)
2. **Phase 1 — ProofRunner Lite** — MVP implemented locally, uncommitted
3. **Phase 2 — ContractCourt MVP** — in progress (local candidate)
4. **Phase 3 — CI adoption hardening** — not started
5. **Phase 4 — Design-partner validation** — not started

Phase 0 satisfied its exit gate with the v1.1.0 release. Phase 1's MVP is
implemented in the local working tree, uncommitted, pending its formal review
gate. Phase 2 is in progress as a local candidate. Phases 3 and 4 are
unchanged and not started; later phases still begin only after the previous
phase satisfies its exit gate.

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

Status: the MVP is implemented in the local working tree, uncommitted
(`packages/cli/src/proof-runner.ts`): `quorate proof run/show/verify` writes
`.quorate/proofs/latest.{json,md}`, and review evidence attaches by proof
fingerprint rather than by trusting arbitrary artifact claims. Two spec gaps
are closing now: the implemented artifact path is `.quorate/proofs/` rather
than the `.quorate/proof/` named in the original spec, and explicit
`--proof <path>` attachment plus command discovery are being added.

**Exit gate:**

- [ ] A fixture PR produces a portable proof artifact showing tests and build
  passed.
- [ ] The council includes that evidence without trusting arbitrary artifact
  claims.

Both boxes are plausibly met in the local working tree — the fixture proof
artifact and the fingerprint-gated council evidence attachment exist — but they
stay unchecked: the formal review gate has never run, and portability across
machines is unverified.

## Phase 2 — ContractCourt MVP

**Goal:** detect externally visible contract drift before merge.

MVP:

- Compare API/schema/config surfaces selected by repository policy.
- Classify additive, breaking, and ambiguous changes.
- Emit stable findings and machine-readable evidence.
- Start with one proven contract type; do not launch a broad compatibility suite.

Status: in progress (local candidate). The core engine plus `quorate contract
check` with `--spec/--base/--head/--before/--after/--gate`, the
`.quorate/contract/latest.{json,md}` artifacts, and `quorate metrics` local
aggregation are being implemented in the working tree now; none of it is
committed or done.

**Exit gate:** a vulnerable/clean corpus proves detection of breaking changes with
bounded false positives.

## Phase 3 — CI adoption hardening

**Goal:** make first-week adoption predictable for real repositories.

- Generate and validate GitHub Action setup.
- Add contract-drift checks for Action metadata and public docs.
- Improve package/install smoke coverage and release automation dry-runs.
- Document baseline, suppression, policy, SARIF, and ReviewGraph paths as one flow.

**Exit gate:** a clean repository can install Quorate, run a real gate, export
evidence, and diagnose failure from documented commands alone.

## Phase 4 — Design-partner validation

**Goal:** validate which workflow deserves the next product investment.

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
| ProofRunner Lite | Done (local candidate) |

## Release order

For any public release: verify locally → branch/PR → required CI and review → Git
tag → GitHub Release → npm publication. Never publish npm first.
