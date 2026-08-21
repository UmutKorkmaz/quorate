# Competitive Teardown: OpenAI Codex CLI vs Anthropic Claude Code CLI

**Audience:** builders of a competing agentic coding CLI  
**As of:** mid–late 2026 (models, plan names, and limits change quarterly)  
**Primary sources:** official docs/repos, vendor engineering posts, HN/Reddit, long-form practitioner writeups  

---

## Executive snapshot

| Axis | Codex CLI | Claude Code CLI | Who “wins” day-to-day |
|------|-----------|-----------------|------------------------|
| **Identity** | Open-source (Apache-2.0) Rust agent; multi-surface product (CLI + IDE + Cloud + ChatGPT app + mobile + Chrome) | Closed-source TypeScript/Ink agent; CLI-first with expanding web/desktop/IDE surfaces | Product platform: **Codex**; terminal harness depth: **Claude Code** |
| **Feel** | Precise, token-efficient, good at shell/systems work; “does what you asked” | Fast interactive loop, deeper plan/subagent/skill ecosystem; “thinks with you” | Subjective; many run **both** |
| **Sandbox philosophy** | Kernel-first (Seatbelt / Landlock+bwrap / Windows sandbox); coarse modes | Hybrid: app-layer permissions + hooks + OS sandbox for Bash; programmable | Security hard boundary: **Codex**; governance expressiveness: **Claude** |
| **Cost at $20** | Plus often usable for daily agent work | Pro often too tight; Max ($100+) is the “real” tier | **Codex** for entry value |
| **Extensibility** | MCP, AGENTS.md, profiles, plugins growing | Skills, hooks (26 events), subagents, plugins, Dynamic Workflows | **Claude Code** by a wide margin |
| **Community verdict** | “Better model obedience / cheaper / cloud delegate” | “Best full-featured TUI / harness / community tooling” | Hybrid is common |

**Strategic takeaway for an upstart:** You do not beat them by shipping “another chat loop + tools.” You beat them by (1) a world-class terminal product, (2) a permission model that is both safe *and* low-friction, (3) session continuity that survives multi-hour work, and (4) at least one wedge neither incumbents own (cost transparency, multi-model routing, open harness, superior diffs/review UX, or org governance).

---

## 1. TUI / UX patterns that feel world-class

### 1.1 Architecture of the terminal

| | Codex CLI | Claude Code |
|--|-----------|-------------|
| **Stack** | **Rust** (~96% of repo); TUI built on **Ratatui** (OpenAI hired Ratatui’s maintainer full-time). Core agent is a library (`codex-rs/core`) with an event protocol; TUI is one consumer of many (IDE, app-server, Python SDK). | **TypeScript + React + Ink**. Component model: prompt, streaming markdown, permission dialogs, spinners, scrollable message lists, vim-mode editor. |
| **Why it matters** | Low latency, small binary, native OS sandbox bindings, no Node runtime for the agent itself. | Fast iteration on UI; React mental model for complex dialogs/menus; same stack as many AI CLIs (Gemini CLI, etc.). |
| **Tradeoffs** | Native polish + reliability under load; harder community UI forks. | Faster UI feature velocity; Ink can glitch (copy/selection, redraw corruption, memory/FPS under heavy streams). |

### 1.2 Concrete UX patterns both get right (copy these)

**Streaming output as first-class product**
- Token/chunk streaming into a **scrollable transcript**, not a blocking spinner-then-dump.
- Tool calls rendered as **structured cards/blocks** (tool name, args preview, status: running / done / failed), not raw JSON.
- Partial markdown reflow while streaming (headers, lists, fenced code appear progressively).

**Markdown + code in the terminal**
- Claude Code: lazy syntax highlighting via Suspense — **show plain code immediately, color a frame later** so stream never stalls on highlighter load.
- Codex: theme-aware syntax highlighting + theme picker (`/theme`); **diff colors adapted for light/dark terminals**.

**Diffs**
- In-session `/diff` (both): show working-tree changes including untracked.
- Visual patch presentation for agent-proposed edits (hunks, file path headers, +/- coloring).
- Claude Code adds `/code-review`, multi-agent `/code-review ultra`, `/security-review` — review is a **product surface**, not a side effect.

**Spinners / progress**
- Distinct states: *thinking / tool running / waiting for approval / compacting / network*.
- Long tools show **elapsed time** and last line of output (users hate silent multi-minute commands).
- Subagents: list of background tasks with status (`/tasks` in Claude Code; multi-agent threads in Codex).

**Statusline (critical retention UX)**
- **Codex:** `/statusline` configures footer items; opt-in **5-hour and weekly usage %** so limits are visible *before* wall-hit. Config also in `~/.codex/config.toml` under `tui.status_line`.
- **Claude Code:** customizable statusline (model, context %, cost, session/weekly quota widgets). Community powerline packs exist. Users treat context % as a signal to `/compact` or `/clear` early (e.g. compact at ~60% rather than force-compact).

**Themes & chrome**
- Codex: `/theme`, `/title`, `/personality` (friendly / pragmatic / none).
- Claude Code: custom themes/keybindings; `--safe-mode` disables customizations for debugging.

**Input model**
- Slash-command palette (`/`) as the discovery surface for power features.
- Keyboard-first: model switch, effort/reasoning level hotkeys (Codex: `Alt+,` / `Alt+.` for effort).
- Side questions that **don’t pollute main context**: Claude `/btw`, Codex `/side` (and community notes that Claude’s `/btw` can cut token cost ~50% for digressions).

**Session chrome commands (minimum set users expect)**

| Capability | Claude Code | Codex CLI |
|------------|-------------|-----------|
| Status | `/status` | `/status` |
| Compact context | `/compact [focus]` | `/compact` |
| Resume | `/resume`, `claude -c`, `claude -r` | `/resume`, `codex resume`, `codex continue` |
| Fork/branch | `/fork`, `/branch`, `--fork-session` | `/fork`, `codex fork` |
| Diff | `/diff` | `/diff` |
| Plan mode | `/plan` | `/plan` |
| Permissions | `/permissions`, `/sandbox` | `/permissions` |
| MCP | `/mcp` | `/mcp`, `/apps` |
| Copy last answer | (clipboard flows) | `/copy` |
| Review | `/review`, `/code-review` | `/review` |

### 1.3 What still feels *not* world-class (opportunities)

- **Transcript vs prompt focus** (Codex issues): tmux-friendly scrolling, selecting/copying without fighting the TUI, stream disconnect leaving corrupted frames.
- **Ink copy/selection bugs** (Claude): selecting text in some terminals is notoriously painful — users work around with external logging.
- **Visual density**: power users want denser tool timelines; casual users want quieter chrome. Neither has solved progressive disclosure perfectly.
- **Subagent visualization**: multi-agent work is powerful but often feels like a black box; winners will invent a clear “timeline of agents” view.

### 1.4 Product feel (community language)

- HN: *“Claude CLI is a much better user experience… Codex gets complex things right more consistently.”*
- HN: *“Codex CLI is missing tons of features I use in Claude Code daily.”*
- HN: *“Codex follows instructions and executes the exact change without going on an adventure.”*
- Composio (100+ hrs): Claude CLI wins **simplicity + extensibility**; Codex **macOS app** is more polished than Claude’s desktop.

---

## 2. Onboarding & auth flow

### 2.1 Install (first 60 seconds)

**Codex**
```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh   # Mac/Linux
# or
npm i -g @openai/codex
brew install --cask codex
# Windows: irm install.ps1 | iex
```
- Single binary releases (musl Linux, darwin arm/x64). **~101k GitHub stars** (open source = discoverability flywheel).
- Alternate surfaces marketed immediately: IDE install, `codex app`, Codex Web.

**Claude Code**
- Native installer preferred; npm global package still used but documented as secondary/deprecated path in places.
- First run drops into interactive TUI immediately.

### 2.2 Auth paths

| | Codex | Claude Code |
|--|-------|-------------|
| **Primary** | **Sign in with ChatGPT** (OAuth browser) — Plus/Pro/Business/Edu/Enterprise | **Claude.ai OAuth** browser login; paste code if redirect fails |
| **Secondary** | `OPENAI_API_KEY` (CI-friendly; delayed model access vs ChatGPT auth) | `ANTHROPIC_API_KEY` (API billing; can accidentally bypass subscription if env var set) |
| **Headless / containers** | API key or token patterns | `claude setup-token` → long-lived `CLAUDE_CODE_OAUTH_TOKEN`; mark onboarding complete in config |
| **Enterprise** | SSO via ChatGPT Business/Enterprise; admin `requirements.toml` for policy | Team/Enterprise SSO; managed settings; server-managed settings |

**Onboarding UX that works**
1. Run binary → browser opens → account picks plan → back to terminal “Login successful.”
2. Manual code paste path when localhost callback blocked (SSH, containers, strict firewalls).
3. First-repo ritual: `/init` → generates `AGENTS.md` (Codex) or `CLAUDE.md` (Claude).

**Pain points (real user friction)**
- Claude OAuth redirecting to **pricing/onboarding** instead of login for existing Max users (recurring GitHub issues).
- Remote/SSH: browser callback fails; users must know the paste-code dance.
- Accidental **API double-billing** when `ANTHROPIC_API_KEY` is set while on a subscription.
- Codex: ChatGPT vs API key confusion (“three things named Codex” is a meme on HN).

### 2.3 What an upstart should ship day one

1. **One-command install** + signed binaries + Homebrew/Scoop/winget.
2. **OAuth + API key + device-code** (no silent failures over SSH).
3. **First-run wizard:** trust project? sandbox defaults? theme? sample task.
4. **`/doctor`** that diagnoses auth, sandbox deps, MCP, and path issues (Claude has this; copy it).
5. Never strand users on a marketing page mid-auth.

---

## 3. Permission / approval models & sandboxing

This is the deepest architectural fork.

### 3.1 Codex: kernel-first, coarse knobs

**Approval policy** (when to ask humans)

| Mode | Behavior |
|------|----------|
| `untrusted` | Prompt for essentially everything (safe default) |
| `on-request` | Prompt for risky ops |
| `never` | Fully autonomous (YOLO; pair with isolation) |
| `reject` | Auto-reject categories |

**Sandbox mode** (what OS allows)

| Mode | Access |
|------|--------|
| `read-only` | Read files; no writes / limited exec |
| `workspace-write` | Read/write working tree (common default for real work) |
| `danger-full-access` | Unrestricted — isolated envs only |

**Enforcement**
- **macOS:** Seatbelt / `sandbox-exec`
- **Linux/WSL2:** bubblewrap + Landlock (+ seccomp patterns)
- **Windows:** native sandbox in PowerShell path
- Network often **off by default** locally and in cloud
- Named **profiles** in TOML (`careful`, `ci`, `paranoid`) switched with `--profile`
- Org: `requirements.toml` can force min policy

**UX glue:** `--full-auto` = on-request approvals + workspace-write (practical “get work done” preset).

### 3.2 Claude Code: layered permissions + programmable governance + Bash sandbox

**Permission modes (simplified)**
- Default: ask before risky tools/edits.
- Plan mode: analyze first, restrict execution.
- Accept edits / auto modes for reduced friction.
- `--dangerously-skip-permissions`: full YOLO (widely used, widely warned).
- **Auto mode** (Mar 2026 engineering post): model-based **transcript classifier** replaces most human clicks.

**Why auto mode exists (Anthropic data)**
- Users approve **~93%** of permission prompts → classic approval fatigue.
- Incident classes they care about: overeager deletes, credential grepping, wrong-target job cancellation, gist exfil, deploy flag bypasses.

**Auto mode architecture (concrete)**
1. **Tier 1:** safe tool allowlist + user always-allow rules (reads, search, todos…). Blanket shell escapes stripped on entering auto mode.
2. **Tier 2:** in-project file edits auto-allowed (reviewable via git).
3. **Tier 3:** transcript classifier on shell, external tools, out-of-tree FS, subagent spawns.
   - Stage 1: fast single-token yes/no (err toward block).
   - Stage 2: CoT only on flags (cuts FPR from ~8.5% → **0.4%** on internal traffic).
   - **Reasoning-blind:** classifier sees user messages + tool *calls*, not assistant prose or tool *outputs* (anti prompt-injection + anti-persuasion).
4. **Input PI probe** on tool results before they re-enter context.
5. Deny-and-continue: agent retries safer path; escalate after 3 consecutive or 20 total denials.

**Honest residual risk (Anthropic):** ~**17% FNR** on real overeager actions — better than YOLO, not a substitute for careful human review on prod infra.

**Bash sandbox (`/sandbox`)**
- OS isolation: Seatbelt (macOS), bubblewrap+socat (Linux/WSL2); **no native Windows** (use WSL2).
- Modes: auto-allow sandboxed commands vs keep prompts.
- FS defaults: write CWD + session `$TMPDIR`; read broader unless denied.
- Network: domain allowlist; first new host prompts; optional managed lockdown.
- Credentials: deny/mask env vars and files; mask injects real secret only on allowlisted hosts via proxy.
- Escape hatch: `dangerouslyDisableSandbox` with permission flow; orgs can set `allowUnsandboxedCommands: false` + `failIfUnavailable: true`.
- **Hooks (26 lifecycle events):** PreToolUse, PostToolUse, Pre/PostCompact, PermissionRequest, subagent events, etc. — arbitrary shell/Python for org policy.

### 3.3 Comparison (security product view)

| Dimension | Codex | Claude Code |
|-----------|-------|-------------|
| Boundary strength | **Stronger** (kernel denies syscalls) | Strong when Bash sandbox on; hooks share process boundary |
| Expressiveness | Coarse modes + profiles | **Finer** (regex tool rules, hooks, classifier slots) |
| Approval fatigue solution | Broader sandbox + fewer prompts when workspace-write | Sandbox auto-allow + **auto mode classifier** |
| Untrusted code review | Excellent (`read-only`) | Good with sandbox + deny rules |
| Team standards enforcement | Admin requirements.toml | **Hooks + managed settings** win |
| Known footguns | Users flip `danger-full-access` | Users pass `--dangerously-skip-permissions`; malicious project hooks (mitigated by trust prompts) |

**Blake Crosley framing:** Codex = stronger boundaries, coarser control; Claude = weaker boundary (app-layer), finer control. Match threat model.

---

## 4. Session management: resume, fork, compaction

### 4.1 Resume

**Claude Code**
- `claude -c` / `--continue`: most recent session in directory.
- `claude -r "<id|name>"`: resume by id/name.
- In-session `/resume` picker.
- `/rename` human-readable session names.
- Cross-device: `/teleport` (web → terminal), `/remote-control` (continue elsewhere).
- `--fork-session` when resuming creates new id instead of reusing.

**Codex**
- `codex resume` (picker), `codex resume --last`, `codex continue`.
- In-session `/resume`.
- Sessions persist under local store; `exec --ephemeral` skips disk.
- Cross-surface: ChatGPT account ties CLI ↔ Cloud ↔ app history (major product advantage).

### 4.2 Fork / branch

| | Claude | Codex |
|--|--------|-------|
| Fork conversation | `/fork` → background session copy; `/branch` alternate direction | `/fork` clone thread |
| Parallel work | Subagents, `/batch` + worktrees, `/background` detach | Multi-agent threads, cloud tasks, worktrees |
| Rewind | `/rewind` checkpoint rollback (code + conversation) | Weaker narrative; git remains ground truth |

### 4.3 Compaction & long context

**Claude Code**
- `/compact [instructions]` summarizes with optional focus.
- Auto-compaction when context fills; **PreCompact / PostCompact hooks**.
- Large tool outputs: **spill to file** rather than middle-truncate (Composio: ~25K tokens / up to 500K chars threshold behavior).
- Reloads `CLAUDE.md` after compaction — instructions re-anchored.
- Practitioner story: 570K → ~10K compact overnight; model retained architectural counterfactual about its own prior fix (rare “memory after compression” moment users rave about).
- Community advice: prefer short task sessions; monolithic 10k-turn sessions degrade quality and burn quota (cache re-reads of huge contexts).

**Codex**
- `/compact` in session.
- Models trained explicitly for long autonomous runs / compaction (e.g. Codex-Max lineage marketed for 24h+ cloud runs).
- Large tool outputs: often **head/tail truncate, middle dropped** — weaker for huge MCP dumps.
- Default context vs long-context modes with pricing multipliers on large windows (varies by model generation).

### 4.4 Session product surface checklist for a competitor

Must-have:
- Resume picker with **project, time, title, token estimate**
- Fork without destroying original
- Named sessions
- Export transcript (markdown/jsonl)
- Compact with user-provided “keep these decisions”
- Ephemeral mode for CI
- Worktree-aware parallel sessions

Differentiator candidates:
- Searchable session history across machines
- Diff-of-conversation (“what changed since last compact”)
- Guaranteed tool-output archive paths with citation back into chat
- Branching UI like git graph for conversation

---

## 5. Killer features users love (with sources)

### 5.1 Claude Code — loved features

| Feature | Why users care | Sources |
|---------|----------------|---------|
| **Plan mode** | Forces design before edits; “use for almost any GitHub issue” | Reddit r/ChatGPTCoding hybrid workflows; docs |
| **Skills + plugins marketplace** | Progressive disclosure of domain knowledge; shared standard Anthropic open-sourced | Firecrawl, Composio, Anthropic skills posts |
| **Subagents + Dynamic Workflows / Ultracode** | Parallel specialized agents; huge for large refactors | Docs, Reddit (also a token-burn footgun) |
| **Hooks (26 events)** | Deterministic team policy (fmt, secret scan, block `rm -rf`) | Blake Crosley, Anthropic docs |
| **`/btw` side questions** | Context hygiene + cost control | Community OpenAI forum comparing to Codex `/side` |
| **CLAUDE.md hierarchy + `@imports` + auto-memory** | Deep project memory | Firecrawl comparison |
| **`/rewind`** | Undo agent disasters without full git archaeology | Commands docs |
| **Harness spills large tool output to disk** | Survives MCP dumps | Composio 100-hr review |
| **Community frameworks** (superpowers, Ralph, BMAD, GSD…) | Ecosystem compounds quality | HN / Reddit |
| **Headless `claude -p`** | CI/scripts first-class | Composio, docs |

### 5.2 Codex CLI — loved features

| Feature | Why users care | Sources |
|---------|----------------|---------|
| **Kernel sandbox defaults** | Real isolation for untrusted/automated runs | OpenAI docs, PE interview, Blake Crosley |
| **ChatGPT-plan auth + multi-surface** | Start on phone, finish in CLI/IDE; one account | Firecrawl, OpenAI product posts |
| **`codex cloud exec` + Best-of-N** | Fire-and-forget PRs; multiple attempts | Composio, OpenAI cloud guides |
| **`@codex` on PRs / `/review`** | GitHub-native review loop | Composio, cheatsheets |
| **Token efficiency / limits at $20** | “Plus rarely makes me think about limits” | Composio, Reddit, Firecrawl |
| **AGENTS.md open standard** | Portable across Cursor/Windsurf/etc. | agents.md, OpenAI launch materials |
| **Profiles (TOML)** | Auditable config switching (`--profile ci`) | Cheatsheets, Crosley |
| **Open source Rust core** | Forkable, auditable, embeddable (app-server, SDKs) | github.com/openai/codex |
| **Instruction following** | “Does the exact change, no adventure” | HN threads |
| **Terminal-Bench strength** | Shell/systems tasks | Vendor benches + third-party comparisons |

### 5.3 Shared “table stakes” users now assume

- MCP (stdio + HTTP + OAuth)
- Image attach for UI bugs (`-i screenshot.png`)
- Git worktrees for parallel agents
- Web search (often gated; sandbox may block net)
- Model / effort switching mid-session
- Non-interactive exec for CI

---

## 6. Known complaints & weaknesses

### 6.1 Claude Code

| Complaint | Detail | Sources |
|-----------|--------|---------|
| **Token burn / limits** | Pro too small; Max still hits walls; “Hi” costs % of session; UltraCode/1M/Opus combos nuke quotas | r/ClaudeAI megathreads, r/ClaudeCode |
| **Silent limit changes** | Peak-hour throttling; 4×-style complaints; poor communication | Reddit, Anthropic X statements |
| **Overeager edits** | Answers questions by editing; rare catastrophic deletes (e.g. wipe install) | Composio, Reddit |
| **Cost opacity** | Hard to predict spend; users build third-party dashboards | Reddit, Composio |
| **Closed source** | Can’t audit harness; slow community patches to core | HN |
| **Ink TUI papercuts** | Copy/selection, redraw issues | LinkedIn/HN commentary |
| **Native Windows sandbox gap** | Bash sandbox needs WSL2 | Official sandboxing docs |
| **Complexity tax** | Skills/hooks/plugins/subagents overwhelm newcomers | Firecrawl “honest tradeoff” |

### 6.2 Codex CLI

| Complaint | Detail | Sources |
|-----------|--------|---------|
| **Feature lag vs Claude** | “Missing tons of daily Claude features”; TODO tool took months to catch up | HN |
| **TUI less pleasant** | Claude often preferred for interactive UX | HN, Composio |
| **Quota shocks** | 5-hour windows; reports of sudden 4× tighter limits | r/codex |
| **Truncated tool output** | Middle drop loses MCP/detail | Composio |
| **Weaker long interactive memory after compact** | Vs Claude’s spill+reload story | Composio |
| **Harness extensibility** | No full hooks/skills depth (improving but behind) | Firecrawl table |
| **TUI bugs** | Stream disconnect corruption; scroll/focus issues | GitHub issues |
| **Model/product naming confusion** | Codex CLI vs ChatGPT Codex vs cloud | HN |

### 6.3 Shared industry weaknesses (wedge space)

1. **Approval fatigue vs YOLO** — binary extremes; auto mode is new and imperfect.
2. **Prompt injection via tools** — still an arms race.
3. **Session bloat** — users don’t know when to compact/clear.
4. **Multi-agent cost explosions** — parallel agents re-read huge contexts.
5. **Web/live data** — both weak without MCP (Firecrawl et al. fill gap).
6. **Determinism** — same prompt ≠ same patch; bad for regulated config generation.
7. **Trust of project-local config** — malicious repos can ship hooks/MCP.

---

## 7. What an upstart CLI must do to beat them

### 7.1 Non-negotiable parity (year-0 MVP)

Ship these or users bounce in a day:

1. **Streaming TUI** with structured tool cards, markdown, syntax highlight, theme, statusline (context + cost + limits).
2. **OAuth + API key + device code** auth; `/doctor`.
3. **Permission modes** + **OS sandbox** (at least macOS+Linux) + clear YOLO flag naming.
4. **Resume / fork / compact / export**.
5. **Repo instructions file** — ideally speak **both** `AGENTS.md` and `CLAUDE.md` subsets.
6. **MCP** + image inputs + `exec` JSON for CI.
7. **Plan mode** and **diff/review** commands.
8. **Side-question** channel that doesn’t pollute context.

### 7.2 Where to actually win (strategic wedges)

Pick **2–3**; do not boil the ocean.

#### A. **Trust UX (biggest open product problem)**
- Risk-scored approvals: show blast radius (“deletes 42 remote branches”) not raw argv.
- One-tap “always allow this pattern in this repo” with audit log.
- **Default path between YOLO and nanny** that is better than either auto mode (17% FNR) or kernel-only coarseness.
- Explain *why* blocked in one line the model can use to recover.

#### B. **Cost & limit product**
- Live $/session, projected weekly burn, per-tool cost attribution.
- Model router: plan with strong model, implement with cheap, review with third.
- Hard budgets: “stop at $2” that actually works mid-tool-loop.
- This alone converts Claude users angry about opaque Max burn.

#### C. **Session graph**
- Git-like conversation branches with merge of conclusions.
- Search across all local agent histories (multi-vendor even better — see ecosystem tools already doing this).
- Compaction that preserves *decisions*, *file maps*, and *failed attempts* as first-class artifacts.

#### D. **Diff & review supremacy**
- Side-by-side terminal diffs, blame-aware review, test impact prediction.
- “Show me only risky hunks” filter.
- PR draft with evidence links to tool traces.

#### E. **Open, embeddable harness**
- Codex already open-sources the agent; Claude does not.
- Win on **protocol stability** (JSON event stream), language SDKs, and headless parity with TUI features.
- Let companies self-host models (vLLM, Azure, Bedrock) without forking your soul.

#### F. **Multi-model & local**
- First-class local models + cloud fallback with identical tools.
- Neither incumbent will prioritize true vendor neutrality.

#### G. **Speed of interactive loop**
- Claude is often called “faster in the loop”; Codex “deeper autonomous.”
- Win sub-second tool orchestration, speculative reads, and cached repo maps so first useful edit is faster than both.

#### H. **Windows-native excellence**
- Claude’s Bash sandbox story still pushes WSL2; Codex improved Windows sandboxing but Linux/mac still lead.
- Native Windows kernel isolation + great PowerShell tool surface is underserved.

### 7.3 Packaging & GTM lessons from both

| Lesson | Implication |
|--------|-------------|
| **$20 must feel generous** | Codex’s Plus value is a growth hack; Claude’s Pro frustration is churn fuel. |
| **Surface sprawl retains** | Codex’s phone→desktop continuity is sticky. CLI-only is fine if you integrate with GitHub/Slack brilliantly. |
| **Ecosystem > model week-to-week** | Claude’s skills/hooks community locks power users. |
| **Open source marketing** | Codex’s GitHub presence drives mindshare among infrastructure-minded devs. |
| **Hybrid is normal** | Many HN/Reddit users run **both**. Design for coexistence (don’t fight AGENTS.md/CLAUDE.md; read them). |
| **Dogfood in public** | OpenAI publishes harness-engineering posts; Anthropic publishes auto-mode & sandbox posts. Engineering blogs are sales. |

### 7.4 Suggested north-star positioning statements

Pick one sharp identity:

1. **“The agent you can trust on prod laptops”** — best risk UI + sandbox + audit.
2. **“The cheapest excellent agentic CLI”** — ruthless token efficiency + budgets + local models.
3. **“The open harness”** — Apache agent core, stable protocol, multi-model, enterprise self-host.
4. **“The best terminal craft”** — obsessive TUI (copy/scroll/tmux/diff) that makes Ink/Ratatui incumbents feel dated.

Avoid: “Claude Code but cheaper” without a product wedge — model quality parity is a treadmill.

### 7.5 90-day build order (concrete)

| Phase | Deliverable |
|-------|-------------|
| **Days 1–30** | Rust or Go TUI shell; streaming transcript; tool cards; slash commands; statusline with tokens; OAuth+API key; workspace sandbox MVP |
| **Days 31–60** | Resume/fork/compact; AGENTS.md+CLAUDE.md reader; MCP; plan mode; `/diff`+apply patch; CI `exec --json` |
| **Days 61–90** | Risk-scored approvals; cost budgets; session search; PR review command; Windows-native path; public dogfood blog + benchmarks on *your* harness metrics (time-to-first-edit, approval rate, escape rate) |

### 7.6 Metrics to publish (and optimize)

Incumbents brag SWE-bench. You should also publish:

- **Median human approvals per task** (lower is better if safety holds)
- **Catastrophic action rate** in red-team suite
- **Tokens per successful PR**
- **Time-to-first-valid-edit**
- **Resume success rate** after 24h
- **TUI input latency** under 10k-line transcripts

---

## Appendix A — Quick reference: config artifacts

| Artifact | Codex | Claude Code |
|----------|-------|-------------|
| User config | `~/.codex/config.toml` | `~/.claude/settings.json` |
| Project instructions | `AGENTS.md` (open) | `CLAUDE.md` (proprietary hierarchy) |
| Project local | project trust in config | `.claude/settings.local.json` |
| Skills | `.agents/skills/` (adopted) | `.claude/skills/` (origin) |
| MCP | `[mcp_servers]` TOML | `.mcp.json` / `claude mcp add` |
| Profiles | TOML `[profiles.*]` | layered settings + CLI flags |

## Appendix B — Source map (starting points)

**Official / primary**
- https://github.com/openai/codex  
- https://developers.openai.com/codex (docs; may redirect)  
- https://code.claude.com/docs (CLI, sandboxing, commands, auth)  
- https://www.anthropic.com/engineering/claude-code-auto-mode  
- https://www.anthropic.com/engineering/claude-code-sandboxing  

**Deep comparisons**
- https://www.firecrawl.dev/blog/claude-code-vs-codex  
- https://blakecrosley.com/blog/codex-vs-claude-code-2026  
- https://composio.dev/content/claude-code-vs-openai-codex  
- https://newsletter.pragmaticengineer.com/p/how-codex-is-built  

**Cheatsheets**
- https://shipyard.build/blog/codex-cli-cheat-sheet/  
- Claude Code commands: https://code.claude.com/docs/en/commands  

**Community signal**
- HN: “Claude CLI better UX / Codex better complex correctness” threads  
- r/ClaudeCode, r/ClaudeAI (limits, token burn)  
- r/codex (quota changes)  

---

## Closing judgment

**Claude Code** is the product of **harness maximalism**: skills, hooks, subagents, plan/review, session gymnastics, and a React/Ink UI that feels like a full IDE in a terminal. Users love the craft and hate the bill.

**Codex CLI** is the product of **systems maximalism**: Rust, kernel sandboxes, open source, multi-surface continuity, cloud delegation, and token-efficient models that follow orders. Users love the leverage-per-dollar and isolation; they miss Claude’s extensibility and some interactive polish.

An upstart does not need to out-Opus Opus or out-GPT GPT on day one. It needs to make the **agent control plane**—permissions, sessions, costs, diffs, and terminal feel—obviously better, then ride whatever models the market supplies.

---

*Report generated for competitive product planning. Re-verify plan limits, model names, and sandbox APIs before locking a roadmap — this space moves monthly.*
