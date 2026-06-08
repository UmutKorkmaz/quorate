# Quorate Ship — Launch Playbook

**SKU:** Quorate Ship  
**Anchor product:** VerdictGate (merge-blocking council check)  
**Repo:** [github.com/UmutKorkmaz/quorate](https://github.com/UmutKorkmaz/quorate)  
**Target ship date:** 30-day GTM window starting now

---

## What is Quorate Ship?

Quorate Ship is the **Agent Quality Platform** SKU for engineering teams that need
binding AI review governance — not advisory comments. It packages three products on
top of the open-source `@quorate/core` engine:

| Product | What it does | Buyer pain |
| --- | --- | --- |
| **VerdictGate** | Merge-blocking PR check via GitHub Action + `.quorate/policy.yml` | "Our AI agents ship code; nothing stops a bad merge." |
| **PlanCourt** | Council review of implementation plans *before* code is written (`quorate plan`, `/plan`) | "We approve architecture in Slack, then regret it in review." |
| **ReviewGraph** | Multi-agent agreement evidence (`agreement`, `agreedBy`, `confidence` on findings) | "One model hallucinated a bug and blocked our release." |

Ship SKU customers get policy templates, FinReg vertical commands, audit export, and
priority support. The OSS CLI and Action remain free; Ship adds **enforceable gates**
and **compliance artifacts**.

---

## Pricing

| Tier | Price | Includes |
| --- | --- | --- |
| **Quorate Ship** | **$49 / repo / month** | VerdictGate merge gate, PlanCourt plan reviews, ReviewGraph agreement export, `.quorate/policy.yml` templates, FinReg command pack |
| OSS (free) | $0 | `quorate` CLI, heuristic + self-hosted agents, advisory GitHub Action |

**Billing model:** per GitHub repository (not per seat). Unlimited PR reviews and plan
runs on that repo. Annual prepay: 2 months free ($490/year).

**Who pays $49/repo?** A team of 5–20 engineers on one critical service repo —
cheaper than one hour of incident response, and far cheaper than a dedicated AppSec
hire for AI-generated code review.

---

## EU AI Act Positioning (August 2026)

The EU AI Act's high-risk system obligations ramp through **August 2026**. Teams
building or deploying AI-assisted software need:

1. **Documented human oversight** — a council of independent reviewers, not one chatbot.
2. **Traceable decisions** — verdict, severity, file:line evidence, provider attribution.
3. **Technical robustness checks** — security and QA roles on every material change.
4. **Audit logs** — JSON/Markdown reports retained per PR, exportable for regulators.

Quorate Ship maps directly:

| EU AI Act theme | Quorate Ship capability |
| --- | --- |
| Human oversight | Multi-agent council (`architect`, `security`, `qa`, …) with explicit roles |
| Logging & traceability | `CouncilReport` JSON, PR comments, optional inline review comments |
| Risk management | VerdictGate blocks merge on `FAIL`; `min_agreement` reduces single-model false positives |
| Pre-deployment review | PlanCourt evaluates plans before implementation |

**Messaging:** *"Quorate Ship is the merge gate and audit trail for AI-assisted
development — built for EU AI Act high-risk documentation deadlines in August 2026."*

**Landing copy (one-liner):**  
> Bind your AI code reviewers to a quorate decision — with evidence regulators can read.

---

## Architecture (monorepo)

```
packages/
  core/           @quorate/core — council engine, config, verdict logic
  cli/            quorate binary — shell, review, plan, custom commands
  github-action/  PR check — diff, comment, merge gate (VerdictGate)
  website/        docs site
.quorate/
  policy.yml      Ship SKU merge policy (see policy.yml.example)
  commands/       Vertical wedges (e.g. finreg-review.md)
```

VerdictGate runs on every PR: base-branch config (`.quorate.yml` + `policy.yml`),
council orchestration, dedupe/rank, then `shouldFailForReport` → block merge on FAIL.

---

## 30-Day GTM Plan

### Week 1 — Foundation (Days 1–7)

- [ ] Tag `v0.5.0-ship-preview` with `policy.yml.example` and VerdictGate docs
- [ ] Publish `docs/products/VERDICT-GATE.md` on docs site
- [ ] Add **Quorate Ship** section to README (done)
- [ ] Create Stripe product: "Quorate Ship — $49/repo/month"
- [ ] Draft landing page: `quorate.dev/ship` (hero + EU AI Act callout + pricing)
- [ ] Record 3-min demo: PR → council → FAIL → merge blocked → inline evidence

### Week 2 — Design Partners (Days 8–14)

- [ ] Outreach: 10 fintech / regtech repos (FinReg wedge — `finreg-review` command)
- [ ] Offer 30-day free Ship trial for 3 design partners
- [ ] Collect feedback on `min_agreement` defaults (start: 2) and `roles_required`
- [ ] Write case study template: before/after merge incident rate
- [ ] Post on HN / dev Twitter: "We block merges when 2+ AI reviewers agree on HIGH"

### Week 3 — Compliance Narrative (Days 15–21)

- [ ] Publish EU AI Act mapping PDF (1-pager for security/compliance buyers)
- [ ] Webinar: "Merge gates for AI-generated code before August 2026"
- [ ] Add `quorate review --write-json .quorate/last-report.json` to CI artifact step
- [ ] Partner pitch: EU-based dev-tool newsletters, AI governance communities
- [ ] Enable `failOnDegraded: true` in Ship default policy (no silent heuristic-only green)

### Week 4 — Launch (Days 22–30)

- [ ] Public launch: Product Hunt + GitHub README badge "Quorate Ship"
- [ ] Open self-serve checkout ($49/repo)
- [ ] Ship **ReviewGraph** export: PR comment section "Agreement graph" (agreedBy counts)
- [ ] Ship **PlanCourt** template: `.quorate/commands/plan-gate.md` for RFC reviews
- [ ] Retrospective: conversion rate, top objections, policy.yml field requests

### Success metrics (Day 30)

| Metric | Target |
| --- | --- |
| Paying repos | 10 |
| Design-partner NPS | ≥ 40 |
| GitHub Action installs (Ship policy) | 50 repos |
| Demo → trial conversion | ≥ 20% |

---

## Quick Install (VerdictGate)

```yaml
# .github/workflows/quorate-ship.yml
name: VerdictGate
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: UmutKorkmaz/quorate@v0.4.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          config-path: .quorate.yml
          fail-on: high
```

Copy `.quorate/policy.yml.example` → `.quorate/policy.yml` and enable
`merge_gate.block_on_verdict: [fail]`.

See [products/VERDICT-GATE.md](./products/VERDICT-GATE.md) for the full spec.

---

## FinReg Vertical Wedge

First vertical: **financial regulation code review** (PCI-DSS patterns, audit logging,
PII handling). Shipped as a custom command:

```
packages/cli/.quorate/commands/finreg-review.md
```

Design partners in fintech get this pack bundled with Ship. Expands to
`healthcare-review`, `govsec-review` in Q3.

---

## Support & Sales

- **Self-serve:** Stripe checkout → GitHub App install (future) or license key in `policy.yml`
- **Design partner:** `ship@quorate.dev` (placeholder)
- **Docs:** [umutkorkmaz.github.io/quorate](https://umutkorkmaz.github.io/quorate)

---

## Related

- [VERDICT-GATE.md](./products/VERDICT-GATE.md) — merge gate product spec
- [README.md](../README.md) — OSS quick start
- [.quorate/policy.yml.example](../.quorate/policy.yml.example) — starter policy