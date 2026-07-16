# Quorate Go-to-Market Checklist

**Status:** GTM working document · not an engineering roadmap
**Engineering source of truth:** [`ROADMAP.md`](./ROADMAP.md)

This document keeps launch hypotheses and customer work separate from release
status. Completed features such as VerdictGate, PlanCourt, and ReviewGraph are not
future engineering commitments here.

## Product position

Quorate is the evidence-backed merge gate for teams using multiple AI coding and
review tools:

> Use any AI agent. Quorate decides what is safe to ship.

The open-source CLI and Action provide deterministic and multi-provider review.
Commercial packaging, pricing, compliance material, and hosted workflows remain
market hypotheses until validated with design partners.

## Current launch dependency

Do not begin a new launch push until Phase 0 in [`ROADMAP.md`](./ROADMAP.md) is
locally verified and the v1.1.0 candidate follows the sequence in
[`RELEASE-CHECKLIST.md`](./RELEASE-CHECKLIST.md).

## Design-partner sprint

### Week 1 — Release and demo

- [ ] Complete the reviewed v1.1.0 release path.
- [ ] Publish one reproducible SupplyChainGate demo: unsafe dependency/workflow →
  deterministic finding → blocked gate → corrected change → passing gate.
- [ ] Publish a short setup path for CLI and GitHub Action users.
- [ ] Instrument only metrics that can be collected transparently and with consent.

### Week 2 — Partner onboarding

- [ ] Recruit 3–5 repositories that actively use AI coding tools.
- [ ] Record setup time and the exact point where users hesitate or fail.
- [ ] Validate default severities, policy thresholds, base-ref trust, and suppression
  workflow.
- [ ] Capture false positives and missed findings as reproducible fixtures.

### Week 3 — Evidence and positioning

- [ ] Publish an evidence-backed case study from an opted-in partner.
- [ ] Compare deterministic-only, single-model, and council review workflows.
- [ ] Validate whether buyers value supply-chain gating, proof execution, contract
  compatibility, or audit history most.
- [ ] Keep legal/compliance claims reviewed and sourced before publication.

### Week 4 — Product decision

- [ ] Review adoption, repeated usage, actionable finding rate, and setup friction.
- [ ] Decide whether Phase 1 needs deeper ProofRunner work or whether observed demand
  changes the active roadmap.
- [ ] Publish the decision and update only [`ROADMAP.md`](./ROADMAP.md) as the canonical
  engineering sequence.

## Success signals

| Signal | Initial target |
| --- | --- |
| Active design-partner repositories | 3–5 |
| Median first-gate setup time | Under 20 minutes |
| Repositories completing a second week of use | At least 3 |
| High-severity findings judged actionable | Majority of reviewed findings |
| Reproducible false-positive fixtures | Captured for every reported blocker |

## Release rule

Local verification → branch/PR → CI and review → Git tag → GitHub Release → npm.
No launch announcement should precede a working published-package smoke test.
