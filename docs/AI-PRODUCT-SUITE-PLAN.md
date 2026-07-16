# AI Product Suite Plan

**Date:** 2026-06-30
**Status:** Horizon strategy and backlog; not current engineering status
**Anchor:** Quorate remains the verdict engine.

The canonical implementation sequence is [`ROADMAP.md`](./ROADMAP.md). Phase 0
SupplyChainGate stabilization must complete before this document's product concepts
can enter active development.

## Thesis

AI tools are getting good at generating code, UI, documentation, tests, and fixes.
The durable product opportunity is not another single agent. It is the operating
layer that plans the work, assigns it to the right tools, proves the result,
records the evidence, and decides what can ship.

Working line:

> Use any AI agent. Use any AI design tool. Quorate decides what is safe to ship.

Quorate already owns the strongest foundation for this: multi-agent review,
PlanCourt, VerdictGate, ReviewGraph, domain packs, policy, suppressions,
baseline, audit exports, and CI integration. The suite below expands around that
core without weakening the core product.

## Product Map

| Product | Role | Buyer pain | First user surface |
| --- | --- | --- | --- |
| SpecGate | Turns vague requests into gated specs | Bad AI output starts from bad instructions | `quorate spec` |
| ProofRunner | Proves a change works before review | Teams do not trust AI patches | `quorate prove` |
| ReleasePilot | Runs release workflows end to end | Releases are risky and repetitive | `quorate release` |
| IncidentCourt | Diagnoses production failures and opens fix branches | Incidents need fast, evidenced repair | `quorate incident` |
| VulnIntel | Finds latest relevant vulnerabilities from trusted sources | Teams miss new advisories for packages they actually use | `quorate vuln` |
| Architecture Intelligence | Finds structural decay, dependency risk, and blast radius | AI patches make architecture drift faster | `quorate arch` |
| DataGate | Reviews data, privacy, SQL, analytics, and retention changes | Data mistakes are expensive and regulated | `quorate data` |
| Security Drill Agent | Runs proactive adversarial checks | Security teams need drills, not only PR review | `quorate drill` |
| DocsOps | Keeps docs and examples aligned with code | Docs drift silently | `quorate docs` |
| Migration Agent | Performs framework and dependency upgrades in phases | Upgrades are delayed because they are risky | `quorate migrate` |
| Agent Rules Compiler | Generates config for every AI tool from one policy | Multi-agent teams duplicate instructions | `quorate rules compile` |
| EvidenceGraph | Stores proof, runs, prompts, approvals, and verdicts | Teams need auditability for AI work | hosted dashboard + JSONL |

DesignGate and Conductor remain important, but they are support pillars:

- **Conductor:** routes work to Codex, Claude Code, OpenCode, Aider, Goose,
  Cursor, and future tools.
- **DesignGate:** gates UI and design-system changes before merge.
- **Quorate:** judges plans, diffs, fixes, releases, and evidence.

## Priority Order

### 1. ProofRunner

**Why first:** It has daily value, demos clearly, and strengthens every other
product. A review verdict is more trusted when attached to build, test, browser,
and screenshot proof.

MVP:

- Detect repo test/build commands.
- Run configured proof steps in a clean working tree.
- Capture command output, exit codes, duration, screenshots, and changed files.
- Write `.quorate/proof/<run-id>.json`.
- Add `review --proof <path>` so Quorate can include proof in the final report.

Example:

```bash
quorate prove --changed
quorate review --base main --head HEAD --proof .quorate/proof/latest.json
```

Initial checks:

- unit tests
- typecheck
- lint
- build
- Playwright smoke path, if configured
- package install sanity
- generated artifact diff check

Exit criterion:

- A PR can show: "Tests passed, build passed, browser smoke passed, Quorate
  verdict passed."

### 2. ReleasePilot

**Why second:** It matches existing Quorate release habits and has obvious paid
value for maintainers.

MVP:

- Read release config from `.quorate/release.yml`.
- Check version, changelog, package metadata, git cleanliness, CI status, tags,
  and package registry state.
- Run ProofRunner.
- Run Quorate review and PlanCourt release plan gate.
- Create release notes from merged PRs and commits.
- Execute a dry run by default.

Example:

```bash
quorate release plan --target 1.1.0
quorate release dry-run
quorate release publish
```

Initial targets:

- npm
- GitHub tags and releases
- Docker image publish
- static docs/site deploy

Do not start with mobile app stores. Add them after the core release path is
stable.

Exit criterion:

- A maintainer can run one command and get a release checklist with hard blockers
  and exact next commands.

### 3. SpecGate

**Why third:** It moves Quorate upstream from "review the implementation" to
"approve the work before it starts."

MVP:

- Convert an issue, prompt, or markdown request into:
  - problem statement
  - constraints
  - non-goals
  - acceptance criteria
  - test plan
  - rollout plan
  - risk list
- Run PlanCourt over the generated spec.
- Export a spec artifact to `docs/specs/` or `.quorate/specs/`.

Example:

```bash
quorate spec from-issue 123 --write docs/specs/123-proofrunner.md
quorate plan --gate docs/specs/123-proofrunner.md
```

Exit criterion:

- AI implementation begins from a reviewed spec, not a loose chat prompt.

### 4. EvidenceGraph

**Why fourth:** This is the paid/team layer. It turns local AI work into an audit
asset.

MVP:

- Define a local event schema for:
  - prompt
  - plan
  - agent run
  - command run
  - proof artifact
  - Quorate report
  - approval
  - PR link
  - release link
- Store local JSONL under `~/.quorate/evidence/`.
- Export a bundle for a PR or release.
- Later: hosted dashboard.

Example:

```bash
quorate evidence show --pr 42
quorate evidence export --release v1.1.0 --format markdown
```

Exit criterion:

- A team can answer: who asked the AI to do what, what changed, what proof ran,
  what Quorate decided, and who approved it.

### 5. Agent Rules Compiler

**Why fifth:** Teams will use multiple agents, and each tool has its own rules
file. A compiler makes Quorate the source of policy truth.

MVP:

- Create `.quorate/agent-policy.yml`.
- Generate:
  - `AGENTS.md`
  - `CLAUDE.md`
  - Cursor rules
  - OpenCode agent config
  - Goose recipes
  - Aider conventions
  - Quorate packs and role guidance
- Detect drift and open a patch.

Example:

```bash
quorate rules init
quorate rules compile
quorate rules doctor
```

Exit criterion:

- One policy controls how every agent behaves in a repo.

## Secondary Products

### VulnIntel

VulnIntel is a vulnerability intelligence pack for packages, libraries,
frameworks, runtimes, languages, and infrastructure components. It should answer:
"What new vulnerabilities matter to this repository today?"

This is different from a generic dependency scanner. It combines package
inventory, live advisory sources, vendor-specific security pages, exploit
maturity, reachability hints, and Quorate policy into one verdict.

Scope:

- detect package ecosystems from lockfiles, manifests, containers, SBOMs, and
  runtime files
- query trusted vulnerability sources for only the ecosystems in use
- let teams pin extra source websites per library, framework, language, or
  vendor
- normalize advisories into one schema with source, package, affected versions,
  fixed versions, severity, exploit status, publication date, and confidence
- deduplicate CVE, GHSA, OSV, vendor advisory, and ecosystem advisory records
- distinguish known vulnerable dependency, newly disclosed vulnerability,
  malicious package, abandoned package, and unfixed/no-patch risk
- gate PRs and releases when a change adds a vulnerable dependency or when a
  release includes a newly relevant high-risk advisory

Primary sources:

- OSV / OpenSSF for cross-ecosystem package advisories and malicious package
  records
- NVD CVE/CPE APIs for CVE enrichment and product-level advisories
- GitHub Advisory Database for GHSA and GitHub-reviewed advisories
- npm audit bulk advisory endpoint for npm packages
- PyPA advisory database / PyPI JSON vulnerability data for Python packages
- Go Vulnerability Database and `govulncheck` for Go module reachability
- RustSec Advisory Database for Rust crates
- RubySec / bundler-audit database for Ruby gems
- vendor and framework security pages configured in `.quorate/vuln.yml`

MVP surface:

```bash
quorate vuln scan
quorate vuln watch --ecosystem npm,pypi,go
quorate vuln explain CVE-2026-1234
quorate release dry-run --vuln-gate
```

Config:

```yaml
version: 1

sources:
  osv: true
  nvd: true
  github_advisories: true
  ecosystem_advisories: true

watch:
  ecosystems: [npm, pypi, go, cargo]
  packages:
    - react
    - next
    - express
    - django
    - rails
  websites:
    - name: Next.js security advisories
      url: https://github.com/vercel/next.js/security/advisories
      match: [next]

gate:
  block_on:
    severity: high
    newly_disclosed_days: 14
    malicious_package: true
    no_fixed_version: true
  warn_on:
    severity: medium
```

Output:

- `.quorate/vuln/latest.json`
- PR comment section: "New relevant advisories"
- release gate section: "Known vulnerabilities in shipped dependency graph"
- optional EvidenceGraph events for source refresh, advisory match, and
  suppression/acceptance decision

Exit criterion:

- A maintainer can ask which advisories matter to the repo today and get a
  source-backed answer with package/version evidence and a Quorate gate decision.

### DataGate

Start this after ProofRunner and ReleasePilot because it can reuse the same proof
and evidence pipeline.

Scope:

- SQL interpolation and destructive query review
- PII in logs, URLs, analytics, and exports
- GDPR deletion and retention paths
- migration safety
- analytics consent
- dashboard metric drift

MVP surface:

```bash
quorate data review --base main --head HEAD
```

### Security Drill Agent

This is proactive security work instead of reactive PR review.

Scope:

- attempt to weaken CI config
- attempt to leak secrets through logs
- test auth bypass paths
- test prompt injection paths in LLM apps
- verify dependency and install-script risk

MVP surface:

```bash
quorate drill run --pack ci,llm,web
```

### IncidentCourt

High value but integration-heavy. Do this after EvidenceGraph exists.

Scope:

- ingest Sentry, logs, CI failures, uptime alerts, or user reports
- identify likely root cause
- create a fix branch
- run ProofRunner
- run Quorate review
- write incident timeline and follow-up actions

MVP surface:

```bash
quorate incident from-log ./incident.log
```

### DocsOps

Useful and easier than IncidentCourt. It can be built as a small product or as a
ProofRunner plugin.

Scope:

- README drift
- CLI help versus docs mismatch
- API examples that no longer compile
- screenshots that no longer match UI
- changelog generation

MVP surface:

```bash
quorate docs check
quorate docs fix --dry-run
```

### Migration Agent

Good for a verticalized paid SKU once Conductor can run isolated worktrees.

Scope:

- dependency upgrades
- framework upgrades
- codemods
- staged tests
- rollback plan
- Quorate review after each phase

MVP surface:

```bash
quorate migrate plan react-19
quorate migrate run --phase 1
```

## Feature Backlog

This backlog captures 100 Quorate gates and analysis products to
build around the suite. The first five are the priority architecture track:

1. BoundaryGuard
2. CycleBreaker
3. BlastRadius
4. LayerLens
5. HotspotMapper

These five should share one dependency/call graph core. They create the first
strong architecture intelligence product: Quorate can say whether a change makes
the system structure worse, not only whether the diff has a bug.

| # | Feature | What it detects or does | Why it matters | First CLI surface |
| --- | --- | --- | --- | --- |
| 1 | **BoundaryGuard** | Wrong module boundaries, such as UI importing DB, core importing CLI, or app code reaching into internals. | AI agents add imports freely; this is the cheapest high-signal architecture gate. | `quorate arch boundaries` |
| 2 | **CycleBreaker** | Circular dependencies and the smallest dependency edge to cut. | Cycles hurt incremental builds, tree-shaking, refactors, and code ownership. | `quorate arch cycles` |
| 3 | **BlastRadius** | Importers, downstream packages, tests, owners, and risky dependents for a changed node. | Reviewers need to know what a change can break before trusting it. | `quorate impact --file src/x.ts` |
| 4 | **LayerLens** | Violations of declared architecture layers from `.quorate/layers.yml`. | Layering violations are how repos turn into unmaintainable systems. | `quorate arch layers` |
| 5 | **HotspotMapper** | Churn, complexity, graph centrality, high fan-in/fan-out, and risky files. | Hotspots predict where the next bug, incident, or bad AI patch will land. | `quorate arch hotspots` |
| 6 | **OwnerLens** | CODEOWNERS drift, no-owner modules, cross-team files, and non-owner edits. | Ownership drift weakens review routing and accountability. | `quorate arch owners` |
| 7 | **HiddenCoupling** | Files that change together frequently without an explicit dependency edge. | Hidden coupling is why isolated AI refactors pass locally but break real behavior. | `quorate arch coupling` |
| 8 | **GhostHunter** | Dead exports, orphaned modules, single-use interfaces, and speculative abstractions. | AI creates scaffolding quickly; unused abstractions become future confusion. | `quorate arch dead` |
| 9 | **LeakyLens** | Raw persistence models, internals, `any`, or trust-boundary leaks crossing public layers. | Leaky abstractions turn local changes into system-wide risk. | `quorate arch leaks` |
| 10 | **MonoRepoScout** | Workspace/package structure problems, eroded internal boundaries, and cyclic workspace dependencies. | Monorepos decay when internal APIs become de facto public APIs. | `quorate arch monorepo` |
| 11 | **SurfaceGuard** | Accidental public API drift, unintended exports, removed symbols, and internal symbols leaking. | AI does not know which APIs are contractual unless the repo enforces it. | `quorate arch surface` |
| 12 | **CloneCourt** | Semantic duplication across modules, not just copied text. | Agents often paste working patterns; duplicated logic multiplies bugs. | `quorate arch duplicates` |
| 13 | **RefactorCourt** | Phased refactor plans against a target architecture, gated by proof and Quorate review. | Large AI refactors need staged plans, rollback points, and repeated gates. | `quorate refactor plan` |
| 14 | **TechDebtLedger** | Debt items pinned to code locations, tracked over time, and closed only with proof. | Converts "refactor later" into an auditable backlog. | `quorate debt show` |
| 15 | **TestCourt** | Whether changed code has meaningful tests, not only passing tests. | ProofRunner proves commands pass; TestCourt checks whether the tests exercise the change. | `quorate test court` |
| 16 | **FlakeCourt** | Flaky tests, weakened assertions, and unreliable test gates. | Flakes hide real regressions and make teams ignore quality gates. | `quorate test flake` |
| 17 | **DiffDiet** | Oversized PRs, mixed concerns, generated noise, and hard-to-review diffs. | Bad diffs defeat both humans and AI reviewers. | `quorate diff score` |
| 18 | **PerfGuard** | Bundle size, query count, allocation, latency, build-time, and runtime budget drift. | AI patches often add hidden performance cost. | `quorate perf budget` |
| 19 | **DependencyCourt** | New dependency risk: license, maintenance, install scripts, transitive blast radius, and supply-chain concerns. | A dependency addition is often a security and maintenance decision, not just code. | `quorate deps review` |
| 20 | **ConfigGuard** | Drift between env vars, `.env.example`, config schemas, IaC, and docs. | Config drift is a common deploy failure and secret-leak source. | `quorate config check` |
| 21 | **ContractGate** | API, GraphQL, protobuf, event-schema, and SDK/client drift. | Cross-service contract breaks are often invisible in a single repo diff. | `quorate contract check` |
| 22 | **ReadinessGate** | Production readiness: runbook, rollback, SLOs, dashboards, flags, on-call, and error budget. | A service can pass tests and still be unready to operate. | `quorate ready check` |
| 23 | **ObservabilityCourt** | Logs, metrics, traces, alert labels, dashboards, and error instrumentation coverage. | New code should be debuggable before it reaches production. | `quorate obs review` |
| 24 | **CostGuard** | Infra, API, model, storage, and compute cost impact of a change. | Teams need to catch expensive AI-generated changes before merge. | `quorate cost diff` |
| 25 | **PromptOpsGate** | Prompts, evals, tool schemas, model changes, prompt-injection risk, and AI app release safety. | AI apps need domain-specific review beyond ordinary code security. | `quorate ai review` |
| 26 | **ProvenanceGate** | Build provenance, artifact signing, release origin, and tamper resistance. | Teams need to know an artifact came from trusted source and workflow state. | `quorate provenance check` |
| 27 | **SBOM/VEX Court** | SBOM generation plus exploitability status for known vulnerabilities. | Vulnerability lists need context: reachable, not reachable, fixed, or accepted. | `quorate sbom vex` |
| 28 | **MCPGuard** | MCP server tools, scopes, filesystem access, network access, and secret exposure. | Agent tool access can become a new exfiltration and privilege path. | `quorate mcp audit` |
| 29 | **RolloutGuard** | Canary plan, rollback path, migrations, feature flags, and staged release safety. | Passing CI is not the same as safe production rollout. | `quorate rollout check` |
| 30 | **EvalGate** | Prompt, model, tool, and eval-suite regressions for AI features. | AI product changes need measured behavior gates, not only code review. | `quorate eval gate` |
| 31 | **SecretsLifecycle** | Stale, duplicated, unrotated, over-scoped, or undocumented secrets. | Secret hygiene decays after the first safe setup. | `quorate secrets lifecycle` |
| 32 | **IAMGuard** | Cloud IAM, service accounts, policies, roles, and privilege creep. | Permission drift creates high-impact security failures. | `quorate iam review` |
| 33 | **SandboxGuard** | Agent sandbox, approval policy, filesystem access, network access, and shell permissions. | Teams need one view of how much power their AI tools have. | `quorate sandbox audit` |
| 34 | **BuildHermeticity** | Hidden network calls, machine-local dependencies, time variance, and unreproducible builds. | Non-hermetic builds make proof and releases unreliable. | `quorate build hermetic` |
| 35 | **ArtifactCourt** | Release artifacts matching source tags, checksums, package metadata, and CI outputs. | Release integrity breaks when artifacts do not match reviewed source. | `quorate artifact verify` |
| 36 | **BackupDrill** | Backup coverage, restore proof, recovery objectives, and disaster recovery readiness. | Backups are only useful when restore has been proven. | `quorate recovery drill` |
| 37 | **ChaosCourt** | Safe resilience drills for queues, databases, APIs, cron jobs, and external dependencies. | Teams need controlled failure testing before production finds the failure mode. | `quorate chaos plan` |
| 38 | **QueueGuard** | Async job idempotency, retries, dead letters, ordering, fanout, and backpressure. | Queue bugs are hard to see in ordinary request/response tests. | `quorate queue review` |
| 39 | **CacheGuard** | Cache invalidation, stale reads, key collisions, TTL drift, and poisoning risk. | Cache bugs create correctness and security failures that often evade tests. | `quorate cache review` |
| 40 | **StateMachineCourt** | Invalid states, missing transitions, impossible workflows, and inconsistent status models. | Many production bugs are state bugs, not syntax bugs. | `quorate state review` |
| 41 | **BrowserFlowCourt** | Critical user journeys with browser proof, screenshots, console logs, and network evidence. | Teams need real workflow proof, not only unit-level confidence. | `quorate flow review` |
| 42 | **MobileReleaseGate** | Signing, build numbers, store tracks, app metadata, entitlements, and release destinations. | Mobile releases fail through metadata and signing mistakes as often as code. | `quorate mobile release` |
| 43 | **LicenseCourt** | License compatibility, obligations, notices, copyleft risk, and policy exceptions. | License risk deserves its own gate separate from vulnerability risk. | `quorate license review` |
| 44 | **MaintainerHealth** | Bus factor, stale owners, inactive modules, abandoned packages, and review coverage. | Unmaintained code becomes risk even when it still passes tests. | `quorate health maintainers` |
| 45 | **APIChangelogCourt** | API migration notes, semantic versioning, deprecations, and consumer-facing changelogs. | Breaking changes need explicit communication and versioning discipline. | `quorate api changelog` |
| 46 | **LocalizationGate** | i18n key drift, missing translations, hardcoded strings, locale formatting, and RTL risk. | Global product quality fails when localization is reviewed late. | `quorate i18n check` |
| 47 | **PrivacyDPIA** | Data-flow changes, privacy impact, lawful basis, retention, consent, and user rights. | Privacy risk needs a structured impact review tied to the code change. | `quorate privacy dpia` |
| 48 | **ComplianceMapper** | Maps Quorate evidence to SOC2, PCI, HIPAA, GDPR, ISO, and internal controls. | Evidence is more useful when it maps to the control language buyers use. | `quorate compliance map` |
| 49 | **CustomerImpact** | Affected users, accounts, regions, tiers, features, and operational ownership. | Risk decisions improve when the blast radius includes customers, not only code. | `quorate impact customers` |
| 50 | **KnowledgeSync** | Architecture maps, decisions, onboarding docs, and repo knowledge updated from changes. | AI work creates drift unless repo knowledge is refreshed continuously. | `quorate knowledge sync` |
| 51 | **FeatureFlagCourt** | Stale flags, unsafe defaults, missing cleanup owners, flag nesting, and rollout exposure. | Feature flags become permanent complexity unless governed. | `quorate flags review` |
| 52 | **MigrationSafetyGate** | Data migration locks, down paths, batching, backfills, and online migration safety. | Schema changes can pass tests while still locking or corrupting production data. | `quorate migration safety` |
| 53 | **DBIndexGuard** | Missing indexes, unused indexes, query-plan regressions, and dangerous scans. | Database performance failures often arrive as harmless-looking code changes. | `quorate db indexes` |
| 54 | **SchemaDriftGuard** | ORM models, database schema, migrations, generated types, and docs falling out of sync. | Schema drift breaks runtime assumptions and developer tooling. | `quorate schema drift` |
| 55 | **AccessPathCourt** | IDOR, object-level authorization, tenant-aware lookups, and ownership checks. | Many serious app bugs are missing access checks on existing paths. | `quorate access paths` |
| 56 | **MultiTenantGuard** | Tenant isolation, cross-tenant queries, shared caches, data exports, and background jobs. | Multi-tenant leaks are high-severity and often subtle. | `quorate tenant review` |
| 57 | **RateLimitGuard** | Missing rate limits, unauthenticated hot paths, retry amplification, and abuse ceilings. | AI-generated endpoints often omit abuse controls. | `quorate rate-limit review` |
| 58 | **WebhookCourt** | Signature verification, replay protection, idempotency, retries, and event ordering. | Webhooks combine security and distributed-systems failure modes. | `quorate webhook review` |
| 59 | **PaymentFlowGate** | Money precision, refunds, disputes, settlement, webhook ordering, and reconciliation. | Payment bugs quickly become financial and trust incidents. | `quorate payment review` |
| 60 | **EmailDeliverabilityGate** | SPF/DKIM/DMARC, unsubscribe links, template rendering, bounces, and spam risk. | User-facing communication fails when deliverability is not treated as a release gate. | `quorate email review` |
| 61 | **NotificationCourt** | Fanout, dedupe, user preferences, unsubscribe, retries, and noisy alert risk. | Notification systems can create user harm even when code is correct. | `quorate notifications review` |
| 62 | **SearchRelevanceGate** | Search index schema, ranking changes, synonyms, filters, and zero-result regressions. | Search quality regressions are hard to catch in ordinary tests. | `quorate search review` |
| 63 | **MLDataLeakageGate** | Train/test leakage, label leakage, feature leakage, and evaluation contamination. | ML performance claims are invalid when data boundaries leak. | `quorate ml leakage` |
| 64 | **ModelRegistryGate** | Model artifact provenance, registry metadata, evals, versions, and rollback readiness. | Model changes need release discipline like code artifacts. | `quorate model registry` |
| 65 | **DataQualityCourt** | Nulls, ranges, freshness, uniqueness, referential integrity, and anomaly thresholds. | Bad data can invalidate correct code and dashboards. | `quorate data quality` |
| 66 | **AnalyticsContractGate** | Event schemas, naming, consent, identity joins, and downstream dashboard contracts. | Product decisions fail when analytics events drift. | `quorate analytics contract` |
| 67 | **ExperimentCourt** | A/B test guardrails, exposure logic, sample ratio mismatch, and metric validity. | Experiments need statistical and rollout safety, not only code correctness. | `quorate experiment review` |
| 68 | **A11yFlowCourt** | Full-journey accessibility, keyboard flow, focus order, screen-reader labels, and contrast. | Component-level accessibility misses workflow-level barriers. | `quorate a11y flow` |
| 69 | **ContentSafetyGate** | UGC moderation paths, unsafe output handling, report flows, and policy coverage. | User-generated and AI-generated content need release-time safety gates. | `quorate content safety` |
| 70 | **AbuseCaseCourt** | Fraud, scraping, spam, credential stuffing, privilege abuse, and business logic abuse cases. | Security review needs abuse-case thinking, not only vulnerability patterns. | `quorate abuse cases` |
| 71 | **LegalTermsGate** | Terms, privacy policy, cookie notice, license text, and legal copy drift from product behavior. | Product changes can create legal/documentation mismatches. | `quorate legal terms` |
| 72 | **RegionResidencyGate** | Data residency, region routing, cross-border transfer, backups, and analytics export paths. | Regional compliance failures are architecture and deployment issues. | `quorate residency check` |
| 73 | **EncryptionCourt** | TLS, key usage, crypto primitives, at-rest encryption, rotation, and weak algorithms. | Crypto regressions are high impact and hard to review manually. | `quorate crypto review` |
| 74 | **TokenScopeGuard** | OAuth scopes, API tokens, PAT usage, app permissions, and scope expansion. | Token scope creep silently increases blast radius. | `quorate token scopes` |
| 75 | **SessionCourt** | Cookie flags, session lifetime, refresh rotation, logout, fixation, and CSRF boundaries. | Session bugs sit between auth, browser, and backend behavior. | `quorate session review` |
| 76 | **DependencyFreshness** | Outdated dependencies, upgrade windows, unsupported versions, and patch cadence. | Old dependencies become operational risk before they become known CVEs. | `quorate deps freshness` |
| 77 | **RuntimeEOLGuard** | Node, Python, Java, .NET, OS, database, and framework end-of-life risk. | Unsupported runtimes block security patching and support. | `quorate runtime eol` |
| 78 | **ContainerHardening** | Dockerfile, OCI image, user, capabilities, base image, package manager, and secret handling. | Containers need hardening beyond dependency scanning. | `quorate container harden` |
| 79 | **KubernetesRuntimeGate** | Runtime security context, RBAC, network policy, probes, resources, and pod disruption. | K8s manifests can pass static IaC checks while still being unsafe to operate. | `quorate k8s runtime` |
| 80 | **TerraformPlanCourt** | Terraform plan risk, destructive changes, public exposure, drift, and state hazards. | IaC diffs are hard to evaluate without the resolved plan. | `quorate terraform plan` |
| 81 | **EdgeCaseGenerator** | Generates edge-case tests from the diff and known failure classes. | AI often implements happy paths and misses boundary behavior. | `quorate edgecases generate` |
| 82 | **SyntheticMonitorPlan** | Creates or verifies synthetic monitors for new endpoints and critical journeys. | A shipped feature should have production visibility. | `quorate monitors plan` |
| 83 | **SLOImpactGate** | Error-budget impact, latency objectives, availability targets, and alert thresholds. | Performance and reliability changes need service-level context. | `quorate slo impact` |
| 84 | **LogPrivacyGuard** | PII, secrets, tokens, patient data, payment data, and sensitive identifiers in logs. | Logging is a frequent privacy and security leak path. | `quorate logs privacy` |
| 85 | **TraceCoverageGate** | Missing spans, broken trace propagation, cardinality risk, and critical-path visibility. | Distributed systems need traceability before incidents. | `quorate traces coverage` |
| 86 | **APIUsageCourt** | API quota, rate, billing, pagination, retry, and provider contract risk. | Third-party API usage can create cost and reliability failures. | `quorate api usage` |
| 87 | **SDKCompatibilityGate** | SDK backward compatibility, generated clients, examples, and consumer migration impact. | SDK breaks damage external developers even when server tests pass. | `quorate sdk compat` |
| 88 | **CLISmokeGate** | CLI command registry, help output, install paths, shell behavior, and interactive smoke tests. | CLIs often break at packaging or interaction boundaries. | `quorate cli smoke` |
| 89 | **PluginSandboxGate** | Plugin permissions, lifecycle hooks, extension APIs, untrusted inputs, and isolation. | Plugin ecosystems need stricter trust boundaries than app code. | `quorate plugin sandbox` |
| 90 | **MarketplaceReadiness** | Extension/app listing metadata, screenshots, privacy notes, permissions, and packaging rules. | Marketplace releases fail through policy and packaging gaps. | `quorate marketplace ready` |
| 91 | **DocsExampleRunner** | Executes README, docs, API, and tutorial examples as release proof. | Broken examples destroy trust and hide package drift. | `quorate docs examples` |
| 92 | **OnboardingFriction** | Fresh clone setup, bootstrap time, missing env docs, first command, and common failure paths. | Developer experience is measurable and can be gated. | `quorate onboarding check` |
| 93 | **RepoHygieneGate** | Generated files, lockfile drift, ignore rules, formatting churn, and repository metadata. | Repo hygiene issues create noisy diffs and broken releases. | `quorate repo hygiene` |
| 94 | **GitHistoryGuard** | Commit hygiene, sensitive metadata, attribution policy, tag consistency, and release history. | Public history is part of the product surface. | `quorate git hygiene` |
| 95 | **LicenseNoticeGenerator** | Generates and verifies third-party notices from dependency inventory. | License compliance often fails through missing notices, not only bad licenses. | `quorate license notices` |
| 96 | **ArchitectureADRSync** | ADRs matching current architecture, stale decisions, and missing decisions for major changes. | Architecture governance needs memory, not only diagrams. | `quorate adr sync` |
| 97 | **RoadmapDriftCourt** | Roadmap claims, completed work, docs status, and source reality alignment. | Product docs drift into wishful status unless checked against code. | `quorate roadmap check` |
| 98 | **RiskAcceptanceCourt** | Suppressions, expiries, accepted risk reasons, owners, and renewal decisions. | Accepted risk must remain visible and time-bound. | `quorate risk acceptances` |
| 99 | **SupportPlaybookGate** | Support docs, troubleshooting paths, known errors, escalation, and customer-facing recovery steps. | Shipped products need support readiness, not only engineering readiness. | `quorate support playbook` |
| 100 | **ExecutiveRiskBrief** | Summarizes technical, security, release, customer, and compliance risk for leadership. | High-level decisions need concise, source-backed evidence from the whole suite. | `quorate brief executive` |

Notes:

- **VulnIntel** stays separate from DependencyCourt. DependencyCourt reviews the
  dependency decision in a PR; VulnIntel watches latest advisories from trusted
  sources and gates newly relevant vulnerability risk.
- The architecture features should support both advisory mode and VerdictGate
  mode. Teams can start with reports, then block merges once baselines are
  accepted.
- Every feature should emit a structured artifact that EvidenceGraph can store.

## Architecture

The suite should share a small set of primitives.

### Core primitives

1. **Task**
   - desired outcome
   - risk class
   - repo context
   - allowed agents
   - proof requirements

2. **Run**
   - command or agent invocation
   - inputs
   - outputs
   - cost and duration
   - files changed

3. **Proof**
   - tests
   - builds
   - browser evidence
   - screenshots
   - logs
   - smoke checks

4. **Verdict**
   - Quorate report
   - PlanCourt report
   - ReviewGraph
   - policy result

5. **Evidence**
   - append-only event log
   - exportable bundle
   - PR/release linkage

### Suggested package shape

```text
packages/
  core/              existing Quorate core
  cli/               existing CLI plus suite commands
  proof-runner/      proof command discovery and execution
  evidence/          event schema, local store, exporters
  release-pilot/     release workflows
  vuln-intel/        advisory sources, normalization, matching, watch mode
  arch-intel/        dependency graph, boundary, cycle, layer, impact checks
  rules-compiler/    agent policy compiler
  design-gate/       UI/design-system checks
```

Keep product logic modular. The CLI can expose everything, but the internal
packages should be separable enough for GitHub Action and hosted surfaces.

## Six-Month Sequence

### Month 1: ProofRunner

- proof config schema
- command discovery
- local runner
- proof JSON artifact
- `review --proof`
- docs and demo PR

### Month 2: ReleasePilot

- release config schema
- dry-run checks
- npm and GitHub release target
- changelog generation
- release evidence bundle

### Month 3: SpecGate

- issue/prompt to spec artifact
- PlanCourt integration
- acceptance criteria and test-plan output
- spec drift check against implementation

### Month 4: EvidenceGraph Local

- event schema
- local JSONL store
- export by PR/release
- markdown and JSON bundle
- privacy redaction pass

### Month 5: Agent Rules Compiler

- canonical policy schema
- generators for major agent tools
- drift detector
- `rules doctor`

### Month 6: Architecture Intelligence MVP

Build the priority five together on top of one graph engine:

- BoundaryGuard: `quorate arch boundaries`
- CycleBreaker: `quorate arch cycles`
- BlastRadius: `quorate impact --file <path>`
- LayerLens: `quorate arch layers`
- HotspotMapper: `quorate arch hotspots`

MVP artifacts:

- `.quorate/arch/latest.json`
- `.quorate/layers.yml`
- dependency graph summary
- boundary violation findings
- cycle findings with suggested cut edges
- changed-file blast-radius summary
- hotspot report

Exit criterion:

- A PR can show whether a change worsens module boundaries, introduces cycles,
  violates layers, touches high-blast-radius files, or lands in an architecture
  hotspot.

### After Month 6: First Vertical

Pick one:

- DesignGate if targeting frontend/product teams.
- VulnIntel if targeting maintainers and security-conscious teams.
- DataGate if targeting regulated SaaS and fintech.
- Security Drill Agent if targeting security teams.

## Packaging

### Open source

- Quorate CLI
- ProofRunner local mode
- SpecGate local artifacts
- basic release dry run
- rules compiler for local files

### Paid

- hosted EvidenceGraph
- team dashboards
- compliance exports
- GitHub App automation
- release audit history
- advanced vertical packs
- policy templates

## Go-To-Market

Start with maintainers and small teams already using AI agents.

Primary message:

> AI can write the patch. Quorate proves whether it is ready to ship.

First demos:

1. **ProofRunner demo:** AI patch -> tests/build/browser proof -> Quorate verdict.
2. **ReleasePilot demo:** release plan -> dry run -> Quorate gate -> GitHub release.
3. **SpecGate demo:** vague issue -> reviewed spec -> implementation begins.
4. **EvidenceGraph demo:** PR evidence bundle with prompts, proof, verdict, and approval.

## Decision Rules

- Do not build a general chatbot.
- Do not compete head-on with Codex, Claude Code, Cursor, OpenCode, Goose, or Aider.
- Treat those tools as workers and Quorate as the judge.
- Favor repo-local, file-backed workflows before hosted SaaS.
- Every automated action needs proof, rollback, and a Quorate verdict.
- Public docs and release surfaces should stay vendor-neutral and attribution-clean.

## Next Horizon Candidate

After Phase 0 and only if the active roadmap still selects it, build
**ProofRunner Lite** as the first concrete suite expansion.

Smallest useful version:

```bash
quorate prove --changed
quorate review --proof .quorate/proof/latest.json
```

That would create the suite's core loop:

```text
AI changes code -> ProofRunner proves behavior -> Quorate judges risk -> EvidenceGraph records it
```
