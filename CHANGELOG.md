# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - 2026-07-20

### Added

- **Foreign-agent ingest + hook installer** — `quorate monitor setup`
  installs Quorate hook-report entries in foreign AI CLIs so the monitor can
  observe them. Claude Code gets the rich surface (lanes, subagents, and live
  approve/deny for `PermissionRequest` prompts); Codex gets a guarded notify
  shim only when its notify slot is empty (never clobbered). Other CLIs
  (gemini, qwen, kimi, opencode, crush, goose) are observed by process scan.
  See `docs/MONITOR-HOOKS.md` for the honest capability matrix.
- **`quorate hook-report --source <s> --event <E>`** — the foreign-CLI hook
  bridge. Writes external runs into the live spool as `kind: "external"` and,
  for `PermissionRequest` only, blocks the agent until the monitor answers an
  approve/deny card (defers silently when no monitor is attached — zero
  overhead when nobody is watching).
- **`quorate monitor --serve`** — a headless server mode that prints one
  `{url, token, pid}` JSON line and serves the SSE feed for the native app.
  Writes a `~/.quorate/live/monitor.json` discovery file with a 2s heartbeat
  on listen and removes it on close; this is what makes foreign
  `PermissionRequest` hooks block for an answer.
- **Approvals + foreign agents + jump across surfaces** — the SSE payload now
  carries top-level `approvals`, `external`, and `stats`; `POST /control`
  accepts `approve`/`deny` (approval id) and `jump` (runId) alongside
  abort/rerun. The TUI renders pending-approval cards at the top (`y`/`n`) and
  a detected-processes strip; the web page gains an approvals section, an
  external badge, per-run Jump, and a stats footer. `j` in the TUI (and the
  web's Jump button) focuses the run's terminal via tmux → iTerm2 →
  Terminal.app (macOS).
- **QuorateIsland native macOS app** — a thin menu-bar/notch renderer over
  the monitor server (Swift, macOS 14+, read-only over the SSE feed). Lives
  under `native/QuorateIsland/`; `bash native/QuorateIsland/scripts/bundle.sh`
  produces an ad-hoc-signed `dist/QuorateIsland.app` (bundle id
  `app.quorate.island`, version 1.4.0, `LSUIElement`). It finds or spawns
  `quorate monitor --serve`, renders approvals + runs + subagents + verdicts,
  and never writes the spool directly.
- **`quorate monitor install-companion`** — installs QuorateIsland. Default
  path downloads `QuorateIsland-<arch>.zip` + `.sha256` from a GitHub Release
  and verifies the checksum; `--from-local` builds from the in-tree SwiftPM
  package (the working path today, no signed release assets yet). macOS only.

## [1.3.0] - 2026-07-20

### Added

- **Live run spool** — every council run (review or plan, `--json` or not, CLI
  or interactive shell) now streams its events to `~/.quorate/live/<runId>.ndjson`
  with a per-run registry entry, so runs are observable across terminals without
  a daemon. Partial-line-tolerant tailing, pid-liveness reaping, atomic per-run
  meta files (no shared index to race on), and a `QUORATE_LIVE=0` opt-out.
- **`quorate monitor`** — a full-screen live dashboard over the spool: every
  run on the machine, its agents, and their `provider:role` lanes, with a
  per-lane output drill-in, an installed-agents grid, multi-run selection, and
  `--json` for machine output. Also available as `/monitor` inside the shell.
- **`quorate monitor --web`** — a loopback-only browser dashboard: 127.0.0.1
  binding, per-launch bearer token (constant-time compared), strict CSP,
  bounded SSE streaming, and an embedded single-page UI with zero static-file
  surface. `--port` and `--no-open` flags included.
- **Run controls** — abort a live run (SIGINT to its recorded owner pid, with
  stale- and pid-identity guards) or re-run a settled one (respawns its
  recorded argv, entrypoint-pinned; argv is withheld from disk entirely when
  it looks secret-bearing) from both the TUI (`x`/`r`) and the web dashboard.
  Deterministic SupplyChainGate and web3-dd lanes render as first-class gate
  cards in both surfaces.
- **Subagent nesting schema** — `council/started` events and `runCouncil`
  options accept an optional `parentRunId`/`parentLane`, letting a nested
  subagent council attribute itself to the parent lane that spawned it. The
  monitor folds child runs under their parent (one level; orphans stay
  visible). Fully backward compatible — absent fields mean top-level.

## [1.2.1] - 2026-07-16

### Fixed

- The Ink prompt now uses a steady caret, preventing its idle cursor timer from
  repainting the full terminal frame and making the footer flicker.
- The release helper now publishes only the self-contained public `quorate` CLI;
  the workspace-only `@quorate/core` package is still built and package-smoked
  but no longer blocks releases by targeting an unavailable npm scope.

## [1.2.0] - 2026-07-16

### Added

- Native `/supply-chain [scan]` and `/supplychain` commands in both interactive
  CLI interfaces, with the latest scan available through the existing `/last`
  report flow.

### Changed

- The first `Ctrl+C` now clears the active interactive CLI presentation and keeps
  the session open; a second consecutive `Ctrl+C` exits cleanly. Normal input
  disarms the pending exit, and `/clear` keeps its existing behavior.
- Interactive command documentation now includes supply-chain scans and the new
  interrupt behavior.

### Fixed

- Classic readline sessions now reset their visible input line correctly, handle
  mixed input chunks without leaving `Ctrl+C` armed, and remove interrupt
  listeners during cleanup.
- The Ink launcher now delegates `Ctrl+C` handling to the application and awaits
  the renderer exit before returning.

## [1.1.0] - 2026-07-16

### Added

- **SupplyChainGate.** A deterministic `quorate supply-chain scan` command and
  opt-in normal-review lane for npm dependency/lockfile evidence, GitHub Action
  pinning, Docker digest pinning, and npm publish provenance.
- Machine-readable JSON and Markdown output, persistent
  `.quorate/supply-chain/latest.json`, VerdictGate severity gating, base/head/PR
  diff sources, and the `supplychain` CLI alias.
- Base-branch GitHub Action configuration and complete-diff integration so
  lockfiles remain visible even when generated files are excluded from AI prompts.

### Security

- Incomplete or missing GitHub API patches now fail closed instead of silently
  producing a partial supply-chain scan.
- Lockfile evidence must use the repository's resolved package manager and prove the
  exact dependency block, compatible version, resolution URL, and integrity/checksum;
  adjacent-package metadata, new unrelated lockfiles, and ambiguous managers fail closed.
- Docker references require a full 64-hex SHA-256 digest, including Docker-based
  Actions. npm provenance and authentication are checked per publishing job across
  npm, pnpm, Yarn, Bun, npmrc token setup, and changed package publish scripts.
- PR-controlled inline ignore markers cannot suppress SupplyChainGate findings.
- GitHub Action gate files use canonical base-branch paths, PR inputs may only tighten
  the committed severity policy, stale baselines are not applied, and malformed
  baseline/suppression timestamps fail secure.

### Fixed

- Standalone gate runs no longer fail because deterministic scans cannot satisfy
  council-only role or real-provider coverage requirements.
- Working-tree scans include untracked files, `--head` requires `--base`, unsupported
  `mode: repo` config is rejected, and `lockfiles.requireFor` is enforced.
- Untracked-file collection uses a bounded Git process count, and package-manager
  resolution consumes a trusted repository inventory without synchronous core I/O.
- Degraded council summaries refer to all deterministic reviewers when real
  providers fail.

### Changed

- The active roadmap, horizon product plan, GTM checklist, Action contract, CLI
  docs, website docs, and release checklist now describe one release sequence.

## [0.9.0] - 2026-06-23

### Added

- **Expanded Solana / Anchor coverage.** The Solana pack now covers 21 deterministic
  classes, including `remaining_accounts`, unpinned CPI program accounts,
  confirmation and blockhash-expiry regressions, Token-2022 extension policy,
  authority invariant changes, weakened Anchor constraints, and removed invariant
  checks.
- **Solana release gate commands.** `quorate solana doctor` inspects Anchor,
  Cargo, IDL, deployed-program evidence, verifiable-build evidence, and Quorate
  config; `quorate solana test-plan` prints the next release-test commands.
- **Solana-focused website and Action guidance.** The docs, GitHub Action README,
  example workflow, and Packs page now lead with a concrete Solana app/release-gate
  flow while keeping Quorate provider/model selection generic.

### Fixed

- Solana release checks compare IDL metadata against the provider cluster's
  program ID instead of accepting any cluster in `Anchor.toml`.
- Token-2022 heuristics no longer flag validated extension handling solely because
  Token-2022 types are imported or used near explicit extension checks.

## [0.8.0] - 2026-06-11

### Added

- **Solana pack (slice 1).** `quorate init --pack solana` scaffolds a
  Solana/Anchor review council (councils: solana-security, anchor-accounts,
  transaction-safety, token-safety, maintainer) with per-role reviewer guidance;
  `quorate packs` lists available packs.
- **Shared reviewer prompt builder** (`buildReviewPrompt`) replaces the duplicated
  prompt logic in the api and cli provider runners — byte-identical output when no
  pack is active, and the single place pack `roleGuidance` is injected per role.
- **Three deterministic Solana heuristics**: UncheckedAccount/AccountInfo (high),
  raw CPI invoke/invoke_signed (medium), and skipPreflight: true (medium), with a
  vulnerable/clean Anchor + web3.js diff corpus proving detection and zero false
  positives.
- **Solana pack complete (10 sealevel classes).** Four more on-chain
  Rust heuristics (panic, non-canonical PDA bump, manual account closing,
  unvalidated token account, unchecked arithmetic) plus a diff-shaped Anchor
  constraint-removal check (via a new removedLines pass) and a hardcoded-keypair
  check — 10 distinct vulnerability classes proven by the demo corpus, clean
  Anchor/web3.js fixtures stay finding-free. New "Quorate for Solana / Anchor"
  docs page and a ready-to-copy GitHub Action example workflow.
- **EVM / Solidity pack.** `quorate init --pack evm` scaffolds a Solidity review
  council; 10 deterministic .sol heuristics (tx.origin auth, delegatecall,
  selfdestruct, inline assembly, block.timestamp dependence, unbounded loops,
  floating pragma, ether-via-call, unchecked low-level call, unchecked ERC20
  transfer) with a vulnerable/clean corpus — proves the pack registry
  generalizes (no CLI changes; adding a registry entry is enough). Docs page +
  Action example included.
- **IaC pack (Terraform + Kubernetes).** `quorate init --pack iac` scaffolds an
  infrastructure security council; 10 deterministic heuristics — public ACL,
  0.0.0.0/0 ingress, encryption disabled, public IP, hardcoded secret (.tf);
  privileged container, host namespace sharing, runs-as-root, privilege
  escalation, :latest image tag (k8s yaml) — with a vulnerable/clean corpus.
  Docs page + Action example.
- **AI / LLM-app pack.** `quorate init --pack llm` scaffolds an LLM-application
  security council; 10 deterministic heuristics — untrusted input interpolated
  into prompts, model output to eval/exec (critical), model output as raw HTML,
  unvalidated tool-call arguments, hardcoded LLM key, prompt/response logging,
  moderation disabled, secret/PII in prompt, authz decided by model output,
  external content fed into prompt — with a vulnerable/clean corpus. Docs page +
  Action example. (4 packs, 41 vulnerability classes total.)

- **GitHub App.** A hosted webhook service (`@quorate/github-app`) that reviews
  every PR with the council and renders results via GitHub's native Check Runs +
  inline annotations, with pack auto-detection, a native + custom re-run button, a
  one-click App manifest, Docker/Render/Fly deploy, and a setup landing page.
- **VS Code extension (0.6).** Domain-pack setup, a `// quorate-ignore` suppression
  quick-fix, a designed Webview verdict panel, a getting-started walkthrough, and
  native gutter decorations + rich finding hovers.
- **CLI.** Hermetic TUI test (suite fully green), polished `quorate packs` output
  with class counts + a `--json` flag.

## [0.7.2] - 2026-06-10

### Added

- `quorate provider set-roles <id> <roles>` — replace a provider's council
  roles in place (validated against the configured councils), without
  round-tripping the whole provider through `provider add`.

### Fixed

- VS Code: "Edit Roles" crashed with "object is not iterable" — the extension
  iterated `doctor --json`'s config object as an array; it now reads
  `config.providers` and uses `provider set-roles` (preserving exotic cli args
  like empty-string flags), surfacing real errors instead of failing silently.

## [0.7.1] - 2026-06-10

### Changed

- Documentation catch-up for 0.7.0 across the README, npm page, and docs site:
  `quorate fix` (snapshot/revert + the judge-fix-re-review loop), live model
  selection (`provider models`/`set-model`, `/models`), the runner-aware GitHub
  Action `auto` mode, and new FAQ entries. No code changes.

## [0.7.0] - 2026-06-10

### Added

- **`quorate fix`** — delegate a finding to a write-mode agent (claude/codex/agy)
  in your real terminal, snapshotted and revertible: the pre-fix state is pinned
  before the agent runs, `--revert` restores tracked files, deletes agent-created
  files, and re-applies your own pre-fix work — refusing when the tree changed
  since (`--force` to override). Offers a council re-review after each fix.
  `/fix` in the shell lists fixable findings.
- **Live model selection.** `quorate provider models <id|preset>` lists models
  from any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, OpenAI,
  OpenRouter, Groq, Together, HF router, DeepSeek, Mistral, Gemini, …);
  `provider set-model` and `provider add` pick interactively; `/models` switches
  a provider model in the shell.
- **VS Code:** full sidebar app (Council / Results / Status), diff-source picker,
  add-provider with live model picking, API keys in the OS keychain, per-reviewer
  live output channels (click a lane to watch the agent), find-path resolution,
  and clear failure reasons per reviewer.
- Opt-in NDJSON chunk passthrough (`QUORATE_JSON_CHUNKS=1`) for streaming UIs.

### Changed

- **GitHub Action: runner-aware `auto` mode** — on GitHub-hosted runners only
  `api` providers (+ heuristic) run, so local CLI agents never produce doomed
  lanes in CI. Marketplace branding added.
- One-shot `quorate review` persists `.quorate/last-report.json` (feeds `fix`).

### Fixed

- API providers are classified as runnable from config (model + key env), not
  PATH; `doctor`/`/inspect` label them correctly.

## [0.6.1] - 2026-06-09

### Changed

- npm README: replaced the misaligned ASCII verdict art with a rendered
  verdict-card image. (Docs only — no code changes since 0.6.0.)

## [0.6.0] - 2026-06-09

### Added

- **9 new API provider presets** for `quorate provider add --preset`: openai, tgi,
  litellm, together, groq, fireworks, deepseek, mistral, gemini (15 total) — any
  OpenAI-compatible endpoint, keys read from env vars.
- Website provider section now tells the full story: local agent CLIs (all 17),
  local model servers, hosted gateways, and the always-on heuristic.

### Fixed

- **API providers are now correctly classified as runnable.** They were treated
  like PATH-detected CLIs, so a configured `type: api` provider showed as "not on
  PATH" and never counted as runnable. Readiness now checks model + key env, and
  `doctor`/`/inspect`/preflight label api providers as configured or missing-env.

## [0.5.2] - 2026-06-09

### Fixed

- The verdict card now stays contained at ~72 columns on wide terminals (it
  previously stretched edge-to-edge into long, sprawling lines), and the
  agreement bar spans the card instead of a fixed 28-char stub — matching the
  designed result view.

## [0.5.1] - 2026-06-09

### Fixed

- Slash-commands docs table no longer shatters on commands whose args contain `|`
  (e.g. `/use <ids|default|available|heuristic>`).
- Docs-site code blocks now render with syntax highlighting.

### Changed

- Improved docs content (a "Common workflows" section, clearer intros) and a
  polished npm README.

## [0.5.0] - 2026-06-08

### Added

- **Live council streaming.** Each running lane shows a one-line activity preview
  of what the agent is doing; drill into a lane (↑/↓ pick, → watch, ←/Esc back) to
  follow its live output, with Esc-again to interrupt the run.
- **`/logs`** (alias `/agent`) — review each agent's full captured output after a
  run, including the real error for a failed provider.
- **`/route`** — view and reassign role→provider routing for the session
  (`/route <role> <providers…>`, `/route reset`).
- **`quorate provider add`** / `remove` / `presets` — manage providers in
  `.quorate.yml` from the CLI, with presets for Ollama, LM Studio, vLLM, llama.cpp,
  the Hugging Face router, and OpenRouter.
- Semantic mode colors in the TUI (review = blue, plan = green, `!` shell = red).
- A README for the GitHub Action documenting how `type: api` providers run real
  review on GitHub-hosted runners.

### Changed

- Redesigned the welcome, running panel, and verdict views to match the design.
- **No input size cap by default** — `maxInputBytes` is now opt-in, and `/git`
  excludes lockfiles/generated files, so large diffs aren't rejected.
- Removed the default `--max-budget-usd` from the built-in `claude` profile
  (subscription auth has no per-token billing).
- `runner-mode` now actually filters providers by type in the GitHub Action.

### Fixed

- **EPIPE crash** when a provider closed stdin before the prompt finished writing.
- **Hidden provider errors** — a failed run now surfaces the real reason instead of
  a generic "all providers failed" / silent degrade.
- The website CSS pipeline (Tailwind was never wired up, so the docs rendered
  unstyled) and finished the redesign.
- Gated untrusted `.quorate/commands` behind `QUORATE_TRUST_WORKSPACE`, constrained
  `/compare` to the repo, and gitignored `.quorate/` session artifacts.

## [0.4.0] - 2026-06-06

### Added

- Cross-model consensus/agreement scoring on findings, so a verdict reflects how
  many reviewers independently raised the same issue.
- Structured (JSON) provider output parsing, with a graceful fallback to text.
- Opt-in inline PR comments from the GitHub Action, anchored to file and line.
- Severity and agreement gates for deciding when a review should fail the check.
- Standard repository documentation (license, contributing guide, security policy,
  issue and pull-request templates).
- Grouped, colored, examples-led `--help` (Setup / Review / Interactive sections)
  with "did you mean?" suggestions for mistyped subcommands.
- `quorate doctor` rebuilt as a verdict-style readiness check: environment
  (Node/git/gh), per-provider state (runnable / needs-profile / not installed)
  with a copy-paste fix, and a closing verdict that names the next command.
- A first-run welcome banner (TUI and shell) showing version, detected reviewer
  count, the honest heuristic-only state, and the next three actions.
- "Did you mean?" suggestions for unknown slash commands, provider ids, and roles.
- A shared `@quorate/core` theme — one palette and glyph set — honoring `NO_COLOR`,
  `FORCE_COLOR`, and `QUORATE_ASCII` across the TUI, the classic shell, and doctor.
- A segmented status line (mode · providers available · diff · last verdict),
  modeled on Oh My Posh segments.
- The **indigo + amber "Council Chamber" visual identity** from the Quorate design
  system: a truecolor palette (indigo `#6E97FF` brand, amber `#FBBF24` council
  accent), an amber braille spinner, amber cross-model agreement dots, per-role
  hues (architect/security/qa/performance/maintainer), and a refined severity ramp.
  Colors render as 24-bit truecolor and downsample gracefully on limited terminals.

### Changed

- Honest degraded verdicts are now a visual law everywhere: a heuristic-only PASS
  renders as an amber `PASS · heuristic` chip in the TUI and a `(heuristic only)`
  marker on the Markdown / PR-comment verdict line — never a confident green block.
- `--version` is read from the package manifest at runtime, so it can never drift
  from the published version.
- Semantic (lexical-similarity) finding clustering replaces exact-text dedup, so
  near-duplicate findings from different models collapse into one.
- All packages aligned to version 0.3.0.

### Fixed

- GitHub Action comment upsert now matches by marker, so it correctly updates
  comments authored under a PAT rather than posting duplicates.
- Base-branch fallback uses the repository default branch when no base is given.
- Total-diff size guard for large pull requests.
- Friendlier CLI errors when a diff cannot be loaded.

## [0.2.2]

- Initial public release line.
