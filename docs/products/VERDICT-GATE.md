# VerdictGate — Product Spec

**SKU:** Quorate Ship  
**Component:** Merge-blocking council check for pull requests  
**Engine:** `@quorate/core` + `@quorate/github-action`

---

## Summary

VerdictGate convenes a council of AI reviewers on every pull request, aggregates
findings into a single **PASS / WARN / FAIL** verdict, and **blocks merge** when the
policy says so. It is the enforceable layer on top of Quorate's advisory PR comments.

**One sentence:** VerdictGate turns multi-agent code review into a required CI check
with configurable agreement thresholds and role coverage.

---

## Problem

Teams adopting AI coding agents (Claude Code, Codex, Cursor, etc.) face:

- No binding quality gate — reviewers comment, merges happen anyway
- Single-model blind spots — one agent misses what another catches
- Compliance gaps — no auditable record of *who* reviewed *what* before merge

VerdictGate solves merge enforcement and multi-agent agreement in one GitHub check.

---

## How It Works

```text
 PR opened
    │
    ▼
 checkout (base branch config — not PR head)
    │
    ▼
 load .quorate.yml + .quorate/policy.yml
    │
    ▼
 build diff (base…head)
    │
    ▼
 runCouncil() — parallel agents per role
    │
    ▼
 dedupe + rank findings (agreement, confidence)
    │
    ▼
 compute verdict (pass · warn · fail)
    │
    ▼
 shouldFailForReport() — policy gate
    │
    ├── PASS/WARN (or FAIL below threshold) → check green, comment posted
    └── FAIL (policy match) → check red, merge blocked
```

**Security:** `.quorate.yml` and `policy.yml` are read from the **base branch** only.
A PR cannot weaken its own gate by editing config in the head branch.

---

## Policy Schema (`.quorate/policy.yml`)

VerdictGate policy is separate from provider wiring (`.quorate.yml`). Policy defines
*when a verdict blocks merge*; config defines *which agents run*.

### Example

```yaml
version: 1

# Merge gate — VerdictGate core
merge_gate:
  enabled: true
  block_on_verdict:
    - fail          # FAIL always blocks merge
  allow_warn_merge: false   # WARN is non-blocking by default

# Severity threshold (maps to github.failOn in .quorate.yml)
verdict:
  fail_on: high              # critical, high → FAIL verdict
  fail_on_degraded: true     # heuristic-only run cannot pass silently

# Multi-agent agreement (ReviewGraph integration)
agreement:
  min_agreement: 2           # finding must be raised by ≥2 providers to gate
  gate_severity: high        # only high+ findings with min_agreement block

# Required council roles — all must complete successfully
roles_required:
  - security
  - maintainer

# Optional: explicit provider floor
providers:
  min_real_providers: 1      # at least one cli/api provider (not heuristic-only)

# Audit (Ship SKU)
audit:
  retention_days: 90
  artifact_path: .quorate/last-report.json
  export_formats: [json, markdown]
```

### Field Reference

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `merge_gate.enabled` | boolean | `true` | Master switch for merge blocking |
| `merge_gate.block_on_verdict` | `pass\|warn\|fail[]` | `[fail]` | Verdicts that fail the GitHub check |
| `merge_gate.allow_warn_merge` | boolean | `false` | If true, WARN does not block (informational only) |
| `verdict.fail_on` | severity | `high` | Minimum severity for FAIL verdict |
| `verdict.fail_on_degraded` | boolean | `true` | Fail check when no real agent succeeded |
| `agreement.min_agreement` | int | `2` | Providers that must agree on a finding |
| `agreement.gate_severity` | severity | `high` | Severity floor for agreement gate |
| `roles_required` | string[] | `[]` | Council roles that must run and succeed |
| `providers.min_real_providers` | int | `1` | Minimum non-heuristic providers |
| `audit.retention_days` | int | `90` | Suggested artifact retention |
| `audit.artifact_path` | string | — | CI artifact path for JSON report |

### Mapping to `.quorate.yml`

Policy fields map to existing `github` config in `.quorate.yml`:

```yaml
# .quorate.yml (excerpt) — generated from policy or maintained in parallel
github:
  commentMode: update
  failOn: high                    # ← verdict.fail_on
  failOnDegraded: true            # ← verdict.fail_on_degraded
  runnerMode: auto
  gate:
    severity: high                # ← agreement.gate_severity
    minAgreement: 2               # ← agreement.min_agreement
```

`roles_required` is enforced by ensuring those roles appear in `councils` and have
at least one enabled provider assigned.

---

## GitHub Action Integration

```yaml
name: VerdictGate
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  verdict-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: UmutKorkmaz/quorate@v1.0.0
        id: quorate
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          config-path: .quorate.yml
          fail-on: high
          inline-comments: true
          inline-comment-limit: 10

      - name: Export audit artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: quorate-report
          path: .quorate/last-report.json
```

### Outputs

| Output | Values | Use |
| --- | --- | --- |
| `verdict` | `pass`, `warn`, `fail` | Downstream job conditions |
| `findings` | integer | Slack/PR status badges |

### Branch Protection

Enable **Require status checks to pass** and add the `VerdictGate` / `quorate` job name.
With `block_on_verdict: [fail]`, only FAIL blocks; WARN allows merge (unless
`allow_warn_merge: false` and you also add WARN to `block_on_verdict`).

---

## Verdict Logic

| Verdict | Condition | Default merge behavior |
| --- | --- | --- |
| **PASS** | No findings ≥ `fail_on` severity | Merge allowed |
| **WARN** | Findings below `fail_on`, or degraded heuristic-only | Merge allowed (Ship default) |
| **FAIL** | Any finding ≥ `fail_on`, or agreement gate tripped, or degraded when `fail_on_degraded` | **Merge blocked** |

Agreement gate (from `@quorate/core` `shouldFailForReport`):

```typescript
// Fails check when finding.severity >= gate.severity
// AND finding.agreement >= gate.minAgreement
github.gate: { severity: "high", minAgreement: 2 }
```

This prevents a single model from blocking a merge on a disputed finding.

---

## ReviewGraph Evidence

Each finding in the council report includes:

```json
{
  "severity": "high",
  "title": "Missing authorization check",
  "file": "src/auth.ts",
  "line": 42,
  "agreement": 3,
  "agreedBy": ["claude", "codex", "heuristic"],
  "confidence": 0.92
}
```

VerdictGate surfaces `agreement` and `agreedBy` in the PR comment. Ship SKU exports
full `CouncilReport` JSON as a CI artifact for compliance archives.

---

## PlanCourt & ReviewGraph (Sibling Products)

- **PlanCourt** — same council engine in `plan` mode; gate RFCs before code. Policy
  field `plan_gate.enabled` (future) mirrors `merge_gate`.
- **ReviewGraph** — the agreement graph across findings; VerdictGate consumes
  `min_agreement` from this layer.

---

## FinReg Pack

Ship SKU includes `.quorate/commands/finreg-review.md` — a custom slash command for
PCI/audit-log/PII review prompts. Opt in with `QUORATE_TRUST_WORKSPACE=1`.

---

## Pricing

Bundled in **Quorate Ship** at **$49/repo/month**. VerdictGate alone is not sold
separately — it is the anchor SKU component that justifies Ship vs. free OSS.

---

## Roadmap

| Version | Feature |
| --- | --- |
| v0.5.0 | `policy.yml.example`, docs, manual policy → `.quorate.yml` mapping |
| v0.6.0 | Native `policy.yml` parser in `@quorate/core` |
| v0.7.0 | GitHub App + Stripe license verification |
| v0.8.0 | `roles_required` enforcement in Action (fail if role skipped) |

---

## Files

- [`.quorate/policy.yml.example`](../../.quorate/policy.yml.example) — copy-paste starter
- [`docs/LAUNCH.md`](../LAUNCH.md) — GTM playbook
- [`action.yml`](../../action.yml) — GitHub Action inputs