# Quorate Feature Roadmap

**As of:** v0.9.0 · 2026-06-13
**Method:** grounded against the live codebase (19-agent capability map + architecture pass), not a wishlist.

Quorate is already a strong *reviewer* — multi-agent council, dedup, agreement/confidence,
verdict, 18 packs, 16 provider presets, Action + App + VS Code. The gap is everything
**around the verdict** that makes a team trust it as a merge gate and adopt it without pain.
This roadmap sequences by the **adoption funnel**, not by novelty: don't get rejected on day
one → earn trust → control cost → improve precision → extend reach.

---

## Status

- **K0 keystones — DONE** (`packages/core/src/identity.ts`, v0.9.0). `fingerprintFinding`,
  `findingRuleId`, `computeReviewId`, frozen `normalizeFingerprintText`; findings are stamped
  with `fingerprint` and the report carries `metadata.reviewId`. 29 unit tests incl. pinned
  golden values; Action/App inherit both via `runCouncil`. Verified by a 3-lens adversarial
  pass — fixes applied: `mode` always in the review-id basis, Unicode-aware normalization with
  a degenerate-title fallback, JSON-encoded (unambiguous) keys, bare-CR diff handling.
  - *Accepted limitation:* `fingerprintFinding` includes severity, so if a finding's severity
    changes across runs (e.g. a provider is unavailable) its fingerprint changes — escape hatch
    is `baseline --update` (M1). Documented in `identity.ts`.
  - *Deferred migration:* the Action's `inline.ts` still uses its own `findingMarkerHash`
    (includes line number, for comment dedup). Migrate it onto `fingerprintFinding` during
    suppression/export (M2) so all four identity consumers share one scheme.

## Two keystones (build these first — they unblock half the list)

### K1. Canonical finding fingerprint — `fingerprintFinding()` in core
Baseline, suppression, SARIF `ruleId`, and the Action's inline-comment markers each
independently need a stable per-finding identity. Today the Action already has
`findingMarkerHash` (`github-action/src/inline.ts`); the baseline and suppression designs each
invent *another* one. **If they diverge, all four desync** (a suppressed finding reappears, a
baseline stops matching, Code Scanning treats every run as new rules).

→ One frozen pure function in core (`SHA256(severity : file : normalizeText(title))`, 16-hex),
re-exported, consumed everywhere. Pin the normalization in its own function so a patch release
can't silently shift every hash. **Effort: S.**

### K2. Stable `reviewId` — content identity of a whole run
Distinct from K1: `reviewId = SHA256(normalized diff + sorted provider ids + sorted councils)`,
stored on `CouncilReport.metadata`. Same diff+config → same id. Unblocks history, stats,
flake-comparison (identical-diff reruns), and CI artifact correlation. Today only an *ephemeral*
`councilRunId = randomUUID()` exists (`council.ts:249`). **Effort: S.**

> Cross-cutting security invariant for every repo-supplied file below (config, baseline,
> suppressions, custom packs): **load from the PR base ref, never the PR head** — a pull request
> must not be able to weaken the gate that reviews it. The Action already does this for
> `.quorate.yml`; every new repo-file feature must follow the same path.

---

## Milestone 1 — Adoption (don't get rejected on day one)

The funnel killers: a big existing repo can't enforce a gate without drowning in legacy
findings; the three surfaces (CLI/Action/App) disagree on pass/fail; security teams expect
findings in the Security tab; new users hit a DEGRADED verdict they don't understand.

| Feature | Effort | Depends | User surface |
|---|---|---|---|
| **Baseline mode** — gate only *new* findings | M | K1 | `quorate baseline [--update]`; `review --baseline`; Action `baseline:` |
| **Portable policy** — one verdict-gate for CLI/Action/App + `--fail-on` exit codes | M | — | `.quorate/policy.yml`; `quorate policy init\|doctor\|explain`; `review --fail-on` |
| **Export pipeline** — SARIF 2.1 + JUnit + HTML/MD; Code Scanning upload path | M | K1 | `review --write-sarif\|--write-junit\|--write-html\|--write-md`; Action `write-sarif`/`upload-sarif` |
| **Setup generators + risk report** | M | — | `quorate setup github-action\|github-app\|vscode\|provider <preset>`; `quorate doctor --risk` |

Notes:
- **Policy** is already designed in `docs/` (VerdictGate / Ship SKU) — this is wiring an
  existing design into code, with `github.failOn` kept as a backward-compat alias.
- **Export pipeline absorbs `ci-adapters` Phase 1**: GitLab Code Quality and Azure Advanced
  Security ingest SARIF/JUnit with zero bespoke code. Ship example pipelines for both here.

## Milestone 2 — Trust & auditability

| Feature | Effort | Depends | User surface |
|---|---|---|---|
| **Suppression management** — reasons + expiry + audit, findings tagged not dropped | L | K1 | `quorate suppress add\|list\|remove\|audit`; TUI `/suppress`; inline `quorate-ignore` |
| **Review history + stats** — local JSONL store, trend reporting | M | K2 | `quorate history`; `quorate stats [--since]` |
| **Budget guardrails + cost summary** — caps + per-provider usage | M | — | `.quorate.yml` `budget:` block (`maxFiles`, `maxChangedLines`, `maxCostUsd`, `skipGenerated`) |

Suppression is the single most-requested feature for high-noise environments — without it,
teams disable the tool instead of managing false positives. Always render suppressed findings
as `suppressed` (e.g. "3 active, 2 suppressed") so a suppressed critical can never pass silently.

## Milestone 3 — Precision & developer experience

| Feature | Effort | Depends | User surface |
|---|---|---|---|
| **PR context injection** — title/body/issues/commits into the prompt | M | — | Action `include-pr-context`; `github.includePrContext`; CLI `--pr-context` (auto with `--pr`) |
| **Single-provider rerun** — re-run one lane, reconcile into prior report | M | — | `quorate rerun --provider <id> [--role]`; TUI `/rerun <id> [role]` |
| **`quorate provider test <id>`** — end-to-end connectivity/auth check | M | — | `quorate provider test <id> [--json]` |

PR context cuts false positives but is **attacker-controlled** → fence it as read-only context,
hard byte-cap it (~4 KB default), and run the secret-redactor before injection. Off by default
in the App to avoid rate-limit surprises.

## Milestone 4 — Reach & enterprise

| Feature | Effort | Depends | User surface |
|---|---|---|---|
| **Custom pack format + 9 new built-in packs** | L | — | `.quorate/packs/<name>.yml`; `quorate pack scaffold <name>` |
| **CI adapters Phase 2** — bespoke GitLab MR / Azure DevOps PR commenters | L | Export pipeline | thin `packages/gitlab-adapter`, `packages/azure-adapter` |

New packs (highest value first): `secrets` and `auth` (cross-language), then `node-backend`,
`python`, `go`, `dotnet`, `java-spring`, `license-compliance`, `observability`.
Custom-pack YAML compiles to RegExp run server-side → load from base ref, wrap `new RegExp` in
try/catch, reject ids that collide with built-ins, and treat catastrophic-backtracking as a real risk.

---

## Deferred / explicitly not now

- **Bespoke GitLab/Azure commenters** — deferred to M4; native SARIF/JUnit (M1) covers most of
  the value at near-zero cost. Don't build platform SDKs before the file-based path proves demand.
- **GitHub App hosted setup page / manifest flow** — wait for real org-install demand.
- **HTML export** — lowest priority of the four export formats; ship behind SARIF/JUnit.

## Dependency graph

```
K1 fingerprint ──┬─> Baseline (M1)
                 ├─> Suppression (M2)
                 ├─> SARIF ruleId  ─┐
                 └─> inline markers ┤
                                    └─> Export pipeline (M1) ──> CI adapters P2 (M4)
K2 reviewId ─────┬─> History + Stats (M2)
                 └─> flake comparison (future)
Policy (M1) ── integrates ──> Baseline, Suppression, Budget gates
(no deps): Setup, Budget, PR-context, Single-provider rerun, provider test, Custom packs
```

## Why this order

1. **K1+K2** are S-effort and unblock baseline, suppression, export, history, stats.
2. **M1** removes the reasons a team rejects Quorate in the first hour.
3. **M2** is what makes them keep it past the first noisy week.
4. **M3** raises signal quality once it's in the workflow.
5. **M4** widens the market after the GitHub story is airtight.

Every architecture agent flagged the same base-ref-trust invariant independently — it is the
one rule that ties this whole roadmap together and must hold for every repo-supplied file.
