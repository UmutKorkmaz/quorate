I'll research Gemini CLI, Sourcegraph Amp, and OpenCode across product docs, repos, and user feedback, then write a concrete competitive teardown.Pulling official docs and deeper product pages next for concrete UX, permissions, and extension details.# Competitive Teardown: Gemini CLI · Sourcegraph Amp · OpenCode

**Audience:** builders of a competing agentic coding CLI  
**Research date:** July 2026  
**Scope:** product docs, official blogs, GitHub, hands-on reviews, and community feedback

---

## Executive scorecard

| Dimension | Gemini CLI | Sourcegraph Amp | OpenCode |
|---|---|---|---|
| **Core identity** | Google’s open terminal agent for Gemini | Enterprise-oriented “unconstrained” agent + multiplayer | MIT open harness; any model, client/server |
| **Primary surface** | Terminal TUI (Ink/React) | VS Code family + CLI | TUI + Desktop + Web + ACP/SDK |
| **Stars / scale** | ~106k GitHub stars; weekly ship cadence | Commercial Sourcegraph product | ~189k GitHub stars; multi-release/week |
| **Model lock-in** | Gemini only | Curated multi-model (Sonnet + Oracle + …); not BYOK-first | Full BYOM (75+ providers, Ollama, etc.) |
| **Team DNA** | Individual + Google ecosystem | Threads as team knowledge base | Sessions shareable; OSS community |
| **Trust posture** | High free tier historically; quota/auth drama | Cloud threads by default; credit burn | Local-first config; vendor-escape hatch |
| **Biggest wedge** | Free tier + 1M context + Google Search grounding | Finish-the-job agency + Oracle + multiplayer | Model freedom + permissions + TUI craft |
| **Biggest risk (for them)** | Product transition (Antigravity); reliability | Cost opacity, privacy, opinionated UX | Velocity/regressions; default-permissive perms |

---

## 1) TUI / UX patterns that feel world-class

### Gemini CLI — polished product chrome on a fragile TUI base

**What they do well**

- **Full settings surface inside the TUI** via `/settings` — themes, footer chrome, context summary, accessibility (screen reader plain-text mode), vim mode, notifications.
- **Status communication that respects the terminal:** dynamic window titles (`Ready ◇ / Action Required ✋ / Working ✦`), optional “thoughts in title,” auto light/dark theme switching based on terminal background.
- **Streaming + tool UX:** compact tool output, line numbers in chat, citations toggle, loading phrases, spinner control, incremental rendering when alternate screen buffer is on.
- **Context injection UX:** `@file` / `@dir` / image references, multi-directory workspaces (`--include-directories`), hierarchical `GEMINI.md`.
- **Diffs & safety net:** tool actions show diffs before write; checkpointing + `/restore` acts as lightweight undo of agent file mutations.
- **Rendering stack:** Ink-based React TUI with ongoing work on alternate screen buffer, terminal buffer architecture, render process isolation — signals of real investment in flicker/perf.

**Concrete patterns to steal**

| Pattern | Implementation detail |
|---|---|
| Approval modes as first-class modes | `default` / `auto_edit` / `plan` (+ YOLO only via CLI flag, not settings) |
| Footer as telemetry strip | Model, CWD, sandbox status, context % — each independently hideable |
| Permanent context HUD | GEMINI.md + MCP summary above input (can hide) |
| Headless streaming | `--output-format stream-json` for real-time event streams in CI |

**Where it fails “world-class”**

- Community reports of **scrolling bugs, clunky responsiveness, random HTTP/429 errors**, unclear token-limit feedback.
- HN thread: “Gemini CLI also suffers from silly scrolling bugs… TUIs from the 90s were better.”
- Google’s own blog admits terminal workflows “outgrew” Gemini CLI and is **sunsetting free/Google One users toward Antigravity CLI** (announced transition).

### Sourcegraph Amp — agent-first, not TUI-first

Amp’s “world-class” feel is less about a gorgeous terminal chrome and more about **agency visibility + multiplayer**.

**What users praise**

- **CLI transparency:** you can see what the agent is doing and watch **sub-agents spin up in parallel** instead of a black box.
- **Editor-native review surfaces:** agentic code review in VS Code; dedicated review sessions; Agents Panel to manage concurrent threads with keyboard nav.
- **Philosophy of removing knobs:** Frequently Ignored Feedback (FIF) explicitly rejects edit-by-edit approval and model-picker complexity as traps that reduce agency.
- **Amp Tab:** predictive tab completion trained on recent edits + LSP diagnostics (editor surface).

**Concrete patterns to steal**

| Pattern | Why it lands |
|---|---|
| Visible parallel subagents | Turns “waiting” into a dashboard of progress |
| Thread = unit of work | Shareable, resumable, cross-device |
| Compact / New-thread-with-summary | Context ops as product verbs, not power-user hacks |
| Oracle as a *tool*, not a mode switch | Specialist reasoning without forcing model selection UX |

**TUI gap**

- Review agent was **editor-only**; community asked for terminal parity; Amp still exploring whether review belongs in a standalone TUI or existing terminal diff tools.
- For a pure CLI competitor, Amp is **not** the bar for terminal craft — OpenCode is.

### OpenCode — the TUI craft leader among open agents

OpenCode treats the CLI as **one client of a server**, which unlocks UX other CLIs struggle with.

**World-class concrete details**

| Area | Specifics |
|---|---|
| **Layout** | Session timeline, sidebar toggle, todo dock, review panel (desktop), jump-to-latest, sticky headers |
| **Themes** | Dedicated `tui.json` (`theme: tokyonight`, etc.); theme keys no longer live in behavior config |
| **Keybinds** | Leader-key system (`ctrl+x` default), 60+ shortcuts, configurable keybinds, command palette `Ctrl+P` |
| **Diffs** | Configurable `diff_style`; dedicated diff viewer keybind; compare against main branch; desktop review panel with file tabs + full large-patch load |
| **Streaming / status** | Spinner registration across surfaces; session progress indicators; unread tabs with pending questions; `auto` indicator when auto-approve is on |
| **Undo** | `/undo` / `/redo` with **git-based snapshots** of file state + messages; session snapshots/revert controls |
| **Agent modes** | `Tab` cycles Build / Plan / Ask; Plan is read-only by permission defaults |
| **Multi-surface** | Same engine: TUI, `opencode web`, Desktop (Electron), `opencode attach` to remote server, ACP for IDEs |

Changelog shows obsessive UX polish: YOLO/auto mode indicator, MCP OAuth completion errors shown clearly, preserve timeline bottom anchoring, composer drafts per tab, middle-click open session, etc.

**Patterns that feel “pro terminal”**

1. **Leader key** (Emacs/tmux muscle memory) rather than dumping every shortcut as global.
2. **Behavior config ≠ presentation config** (`opencode.json` vs `tui.json`) — avoids silent “theme did nothing” bugs.
3. **Serve once, attach often** — MCP cold-start amortized; multiple clients on one agent runtime.
4. **Session as first-class object** with share URL, export JSON/MD, fork, continue (`-c` / `-s`).

**Caveats**

- High ship velocity → occasional regressions and **high RAM** complaints for a TUI (~1GB reported on HN).
- Desktop/Web sometimes lag TUI features (revert/fork parity issues filed).

---

## 2) Onboarding & auth

### Gemini CLI

**Install:** `npx @google/gemini-cli`, `npm i -g`, Homebrew, MacPorts, conda path for restricted envs. Preview/stable/nightly channels.

**Auth ladder (excellent product thinking):**

1. **Google OAuth** — free tier historically ~60 RPM / 1,000 RPD; no key management  
2. **Gemini API key** (`GEMINI_API_KEY`) — model control, higher paid ceilings  
3. **Vertex AI** — enterprise GCP path (`GOOGLE_GENAI_USE_VERTEXAI`)  
4. Workspace / Code Assist license via `GOOGLE_CLOUD_PROJECT`  

**Onboarding frictions**

- Free-tier **model restrictions** (Pro gated to paid plans as of March 2026 traffic prioritization).
- Enterprise pain: 403s with `GOOGLE_CLOUD_PROJECT`, proxy crashes.  
- **Product transition risk:** unpaid/Google One users pushed to Antigravity CLI — onboarding trust damaged.
- Abuse detection around “OAuth used by third-party software” created fear for ACP/headless automation.

**First-run UX strengths:** auth picker in TUI; `/init` scaffolds `GEMINI.md`; theme selection; home-directory warning.

### Amp

**Install:** VS Code marketplace extension (Cursor/Windsurf/VSCodium) **or** npm CLI `@sourcegraph/amp`; devcontainer one-liner. Reviewers hit “working chat + CLI in under 5 minutes.”

**Auth:** account on ampcode.com; API-key style CLI auth; cloud service required (no offline/self-host).

**Onboarding strengths**

- Extension into existing editor → near-zero workflow rupture  
- Free credits / Amp Free mode for trial  
- Built-in MCP servers (e.g. mermaid, web page) so “first magic moment” happens without config  

**Frictions**

- Credit burn surprises (“tens of dollars/day” on trial reported on HN)  
- Threads always on Sourcegraph servers — enterprise security review starts on day 1  
- Early FIF rejected model selection; teams used to BYOK feel locked in  

### OpenCode

**Install:** curl install script, npm `opencode-ai`, brew, choco/scoop, Docker, nix.  

**Auth:** `opencode auth login` → interactive **provider picker** (Anthropic, OpenAI, OpenRouter, Google, Copilot, local, …). Credentials stay under user control.

**First 5 minutes that win converts**

```bash
opencode auth login
opencode          # TUI
/init             # writes AGENTS.md
/connect          # more providers
```

**Strategic onboarding advantage:** when Anthropic blocked third-party use of subscription credentials, OpenCode users **changed a model string and kept working** — the canonical “why BYOM matters” story.

**Friction:** default permissions are very open (see §3) — security-conscious onboarding should *force* a permissions wizard before first write.

---

## 3) Permission / approval models

This is table-stakes differentiation. All three converged on “YOLO/auto” but differ sharply in *default risk* and *granularity*.

### Gemini CLI

| Mode | Behavior |
|---|---|
| `default` | Prompt for tool approval |
| `auto_edit` | Auto-approve file edits only |
| `plan` | Read-only planning |
| YOLO (`--yolo` / `-y` / Ctrl+Y) | Auto-approve everything; **cannot** be default in settings JSON (CLI-only); can be org-disabled via `security.disableYoloMode` |

Additional security product features:

- **Permanent tool approval** (“always allow this tool”) — gated by `security.enablePermanentToolApproval`  
- **Folder trust / trusted folders**  
- **Sandboxing** (process or tool-level sandbox; network toggle; allowed paths)  
- **Conseca** — LLM-based context-aware security scan of proposed tool calls (optional)  
- **excludeTools** / extension-level tool restrictions  
- Env var redaction  

**Design insight:** YOLO is deliberately hard to make permanent — Google treats full auto as a *session choice*, not a config default. Plan mode + plan-model routing (Pro plan → Flash implement) is a strong safe-by-default workflow.

### Amp

Amp’s model is **rule-list permissions** + **bash allowlists**, optimized for autonomous runs.

- Rules evaluated **in order** until match; actions: allow / reject / ask / **delegate**  
- Tool-level permissions with argument patterns (`amp permissions edit`)  
- Classic `amp.commands.allowlist` for bash prefixes; repo-stored allowlists praised for enterprise auditability  
- FIF: edit-by-edit approval is considered a **local maximum that kills agentic loops**  
- Security research notes allowlists can be poisoned if the agent can edit settings (prompt-injection class risk)  

**Design insight:** Amp optimizes for *completion of multi-step work*, not for “approve every `ls`.” Permission UX is for *dangerous classes of actions*, not every tool call.

### OpenCode

Most expressive permission DSL of the three:

```json
"permission": {
  "bash": { "*": "ask", "git *": "allow", "rm *": "deny" },
  "edit": { "*": "deny", "packages/web/**/*.mdx": "allow" },
  "external_directory": { "~/projects/personal/**": "allow" },
  "doom_loop": "ask"
}
```

| Feature | Detail |
|---|---|
| Values | `allow` / `ask` / `deny` |
| Granularity | Per tool + glob on args/paths |
| Last match wins | Put `*` first, specifics later |
| Ask UI | `once` / `always` (session patterns) / `reject` |
| Auto mode | `--auto` or palette; still honors explicit `deny` |
| Per-agent overrides | Plan vs Build different permission sets |
| Safety guards | `doom_loop` (same tool 3× identical input); `.env` read denied by default |
| YOLO | Changelog: TUI yolo mode for auto-approve |

**Critical default:** most tools **default to allow**; only `doom_loop` and `external_directory` default to ask; `.env*` denied. Power users love speed; untrusted repos are a footgun. Guides explicitly say: **lock bash/edit before first run**.

---

## 4) Session / thread management

### Gemini CLI

- `/chat save <tag>` / `resume` / `list` / share-to-file  
- Checkpointing for **workspace file snapshots** before mutating tools  
- Session retention auto-cleanup (`maxAge` e.g. `30d`)  
- Context compression threshold (default 0.5 of window)  
- Multi-directory workspace as one session  
- Headless continue less mature than OpenCode’s session IDs  
- Memory: `/memory add|show|refresh` + hierarchical `GEMINI.md`  

### Amp — “Threads” as the product

This is Amp’s killer collaboration primitive:

- **One thread per task** (official guidance)  
- Threads **sync to ampcode.com**; resume across laptop/server/phone  
- Visibility: public / workspace / private (shared-by-default is intentional for teams; FIF defends this)  
- **Mention other threads** via URL or `@T-uuid` / `@@` search — agent extracts relevant technique  
- Compact thread / new thread with summary  
- Agents Panel for concurrent threads  
- Power user report: **4 months, ~6000 threads** as a personal knowledge system  

**Tradeoff:** cloud-hosted conversation history is a gift for multiplayer and a liability for regulated codebases. Early reviews flagged “all threads on Sourcegraph servers” as a top concern.

### OpenCode

- First-class session IDs: list, continue (`-c`), specific (`-s`), **fork**, export/import, archive  
- `/share` → URL; `/export` markdown; import from share URL  
- Compaction with `small_model` for cheap summarization  
- Snapshots for undo (internal git snapshot repo — can be heavy on monorepos; `"snapshot": false` escape hatch)  
- Server-attached sessions: multiple TUIs / desktop tabs / remote attach  
- GitHub Action can auto-share sessions on public repos  

**UX win:** sessions feel like **git branches of conversation** — fork an approach, share a URL, import a colleague’s session.

---

## 5) Extension systems (MCP, plugins, custom commands)

### Gemini CLI — extension marketplace + MCP + TOML commands

| Layer | Mechanism |
|---|---|
| **MCP** | `~/.gemini/settings.json` or `gemini mcp add`; `/mcp` lists tools; OAuth MCP supported |
| **Custom commands** | TOML under `~/.gemini/commands/` or project `.gemini/commands/`; namespaced via folders → `/git:commit` |
| **Command power features** | `{{args}}`, shell inject `!{...}` with confirmation + escaping, file inject `@{...}` |
| **Extensions** | Bundle commands + MCP + context files + `excludeTools`; gallery at geminicli.com/extensions |
| **Skills / hooks** | Skills toggle; hooks system with notifications |
| **IDE / ACP / A2A** | VS Code companion; ACP for third-party IDEs; A2A server package |
| **GitHub Action** | PR review, issue triage, `@gemini-cli` mentions |

**Steal this:** TOML commands with safe shell interpolation and file injection are the best “team workflow packaging” design among the three.

### Amp — MCP + Plugin API + subagent tools

| Layer | Mechanism |
|---|---|
| **MCP** | GUI panel + settings; built-in servers; custom servers |
| **Permissions** | Tool-level rules as the extension of security |
| **Plugin API** | Create agents exposed as tools; `parentThreadID` for subagent lineage |
| **Built-in specialist tools** | Oracle (strong reasoning model), Librarian (remote/GitHub code search), Task subagents, TODO tool |
| **AGENTS.md / AGENT.md** | Hierarchical project guidance auto-loaded |
| **Weakness** | Early reviews: MCP global GUI state, hard to version in repo like `mcp.json` |

### OpenCode — deepest open extension surface

| Layer | Mechanism |
|---|---|
| **MCP** | Local stdio + remote HTTP; `opencode mcp add|auth|debug`; OAuth; resource templates; code-mode MCP adapter |
| **Plugins** | npm packages in config; event hooks (`session.*`, `tool.execute.before`, `tui.*`); V2 Effect/Promise plugin API |
| **Agents** | Markdown agents with frontmatter permissions/models; primary vs subagent modes |
| **Commands / skills** | Project `.opencode/` directories (`agents/`, `commands/`, `plugins/`, `skills/`, `themes/`) |
| **Claude Code interop** | Reads `CLAUDE.md` / skills as fallback (disable with env) |
| **ACP / serve / SDK** | IDE integration + headless HTTP + programmatic control |
| **GitHub** | First-party Action + app |

**Steal this:** client/server + plugin events means your CLI is a platform, not a monologue.

---

## 6) Killer features users love (with sources)

### Gemini CLI

| Feature | Why users care | Source |
|---|---|---|
| **Generous free tier (historical)** | Real agent loops without a credit card | Official README / Google launch |
| **1M-token class context + multimodal** | Whole-repo + images/PDFs | GitHub README |
| **Google Search grounding** | Fresh facts without DIY MCP | Official docs |
| **YOLO + headless + stream-json** | Scriptable automation | Addy Osmani tips guide |
| **Checkpoint `/restore`** | Fearless refactors | Osmani / docs |
| **Custom TOML commands + Extensions gallery** | Team-standardized workflows | Official custom commands docs |
| **`@` context + multi-dir workspace** | Explicit, accurate context | Osmani tips |

### Amp

| Feature | Why users care | Source |
|---|---|---|
| **“Finishes the job” agency** | Completes the last 20% Cursor leaves | Medium: 1 month Amp vs 1 year Cursor |
| **Unconstrained / at-cost tokens** | No artificial stop mid-task | Amp marketing + StackHawk |
| **Oracle** | o3/GPT-5 class review/debug without leaving the agent | ampcode.com/news/oracle |
| **Parallel subagents** | Visible fan-out on big tasks | LinkedIn comparison; system prompt docs |
| **Thread multiplayer** | Team learns from each other’s agent runs | Hamel notes; Amp manual |
| **Librarian** | Search public + private GitHub repos as a tool | ampcode.com/news/librarian |
| **Command allowlists in-repo** | Enterprise-auditable autonomy | Substack early review |
| **CLI strong enough for parallel light tasks** | Editor + terminal both first-class | StackHawk / LinkedIn |

### OpenCode

| Feature | Why users care | Source |
|---|---|---|
| **BYOM / provider freedom** | Survive vendor lockouts; route cost | Deep Feed config guide; DEV.to comparison |
| **Fast, clean TUI** | Daily-driver feel vs “clunky” peers | DEV.to hands-on review |
| **Plan ↔ Build with Tab** | Think then act | Official permissions + community guides |
| **`/undo` + snapshots** | Trust to let agent cook | Cheatsheet; changelog |
| **Session share URLs** | Easy collab without cloud lock-in product | Cheatsheet; reviews |
| **Client/server architecture** | Web/desktop/CI/IDE same brain | thdxr HN; Deep Feed |
| **Granular permissions + doom_loop** | Real security language | opencode.ai/docs/permissions |
| **Local models** | Privacy + cost for bulk work | Ollama config guides |
| **Two-model setup** (`model` + `small_model`) | Stop paying Sonnet prices for titles | Deep Feed |

---

## 7) Known complaints & weaknesses

### Gemini CLI

| Complaint | Detail |
|---|---|
| **Reliability** | Random HTTP errors, 429s, “model unavailable → fall back to mini” |
| **TUI quality** | Scroll bugs, sluggish UI, freezes |
| **Trust for daily use** | DEV.to reviewer ranked it worst of four CLIs for trust |
| **Quota politics** | Free tier degraded; Pro models paywalled; traffic prioritization |
| **Product whiplash** | Migration to Antigravity CLI; missing modes / VS Code integration in successor reported |
| **MCP flakiness** | GitHub MCP timeouts; restart dances |
| **Context hygiene** | Ignores expectations around ignore files; token blowups |
| **Global vs project addons** | Hard to disable global extensions per project |

### Amp

| Complaint | Detail |
|---|---|
| **Cost burn** | At-cost + unconstrained = shocking bills for heavy use |
| **Cloud threads** | Privacy/compliance objection; “why is my code chat on your servers?” |
| **Opinionated anti-knobs** | No model picker (by design); edits auto-applied culture |
| **Leaderboards / shared prompts** | Feel unprofessional to some enterprise buyers |
| **Early model lock** | Claude-centric at launch; BYOK delayed vs Cursor |
| **Context fill** | Long sessions need manual compact / new thread |
| **CLI secondary for some features** | Review agent editor-first |
| **Security of allowlists** | Config-file allowlist expansion as attack surface |

### OpenCode

| Complaint | Detail |
|---|---|
| **Release velocity risk** | Features ship faster than stability; pin versions for prod |
| **Memory footprint** | Heavy for a TUI |
| **Default-permissive security** | Dangerous on untrusted code if user never configures |
| **Quota visibility** | Missing polished per-provider quota plugins (user request) |
| **Desktop/TUI feature lag** | Revert/fork/share bugs across surfaces |
| **Snapshot cost on huge repos** | Internal git snapshot can thrash disk |
| **Community drama** | Naming dispute history; Anthropic legal friction (also a *feature* narrative) |
| **`/undo` footguns** | Reports of undo issues in git-controlled projects |

---

## 8) What an upstart CLI must do to beat them

You do **not** win by cloning one of these. You win by combining their non-overlapping strengths and fixing their shared failures.

### A. Must-have parity (table stakes in 2026)

Without these, users bounce in a day:

1. **Streaming agent loop** with visible tool calls (not a chat box that “thinks”)  
2. **Approval model:** `ask` / `allow` / `deny` + session YOLO + **Plan mode**  
3. **MCP client** (stdio + remote + OAuth)  
4. **Project memory file** (`AGENTS.md` / equivalent) with `/init`  
5. **`@file` context** + ignore-file respect (`.gitignore` + agent ignore)  
6. **Headless mode** with JSON / NDJSON stream for CI  
7. **Session resume, list, fork, export**  
8. **Diff preview before write** + undo/restore story  

### B. Steal the best from each (synthesis target)

| From | Steal |
|---|---|
| **Gemini** | Auth ladder (free→key→enterprise); TOML custom commands with safe `!{}` / `@{}`; settings dialog completeness; sandbox + folder trust; stream-json events |
| **Amp** | Parallel subagents with **visible progress**; specialist tools (Oracle-class second brain); thread mention/reuse; finish-the-job evals over chat demos; repo-versioned allowlists |
| **OpenCode** | Client/server core; BYOM; `tui.json` separation; leader-key TUI; Plan/Build agents; permission DSL; serve/attach; plugin events; two-model cost routing |

### C. Wedges where all three are weak (your attack surface)

These are the concrete opportunities:

#### 1) **Trustworthy autonomy (not YOLO cosplay)**
- Default to **ask on write/bash**, one-click “trusted project profile” after git remote / sandbox check  
- Policy packs: `personal-yolo`, `work-strict`, `ci-allowlist`  
- **Prove** what ran: signed session audit log (tool, args hash, outcome) exportable to SIEM  
- Amp-style allowlists **plus** OpenCode globs **plus** Gemini sandbox  

#### 2) **Terminal UX that doesn’t suck**
- Fix the shared Ink/React failure mode: scroll anchors, no vanishing widgets, bounded memory  
- Diff viewer that matches `delta`/`difftastic` quality in-terminal  
- Subagent dashboard in pure TUI (Amp’s visibility + OpenCode’s speed)  
- Optional alternate-screen *and* inline mode (SSH-safe)  

#### 3) **Sessions without forced cloud**
- Local-first sessions with **optional** share (OpenCode model)  
- Amp-like multiplayer **without** mandatory central retention: encrypted share links, team relay you host, or git-notes-backed threads  
- Cross-device resume via user-controlled sync (not vendor lock)  

#### 4) **Model strategy that is honest**
- Don’t be Gemini (one lab) or early Amp (hidden routing only)  
- Be OpenCode on flexibility, Amp on **quality routing**:  
  - Automatic router with **visible** “used X for plan, Y for edit, Z for review”  
  - `small_model` for titles/compaction (OpenCode lesson)  
  - Optional Oracle-class consult tool  

#### 5) **Cost UX as a product feature**
- Live token/cost meter per session, per tool, per subagent  
- Budgets with hard stop / degrade-to-local  
- Beat Amp’s bill shock and OpenCode’s “no quota plugin” complaint  

#### 6) **Extension packaging for teams**
- Gemini’s TOML commands + OpenCode’s plugin events + Amp’s agent-tools  
- One artifact: `skill` = prompts + MCP + permissions + hooks + tests  
- Project vs global with **explicit disable inheritance** (Gemini users begged for this)  

#### 7) **Reliability SLOs**
- Gemini and Claude-class CLIs lose users on freezes and 429 UX  
- Offline queue, clear quota remaining, retry with jitter, never silent loop  
- “Doom loop” detector (OpenCode) + max step budget + user-visible plan  

#### 8) **Evaluation moat**
- Amp wins hearts by **completing tasks**; Gemini by **access**; OpenCode by **freedom**  
- Ship a public harness: multi-file bugs, flaky tests, monorepo nav — publish scores  
- Optimize for *resolved PR* rate, not chat latency demos  

### D. Positioning matrix for an upstart

```
                    OPEN / BYOM
                         ▲
                         │
              OpenCode   │   ★ YOU (target)
                         │
   Individual ◄──────────┼──────────► Team / Enterprise
                         │
              Gemini CLI │   Amp
                         │
                         ▼
                  CLOSED / HOSTED
```

**Winning narrative options** (pick one primary):

1. **“Local-first Amp”** — multiplayer threads & agency, but sessions/keys stay yours  
2. **“Enterprise OpenCode”** — OSS harness + SSO, policy packs, audit, support  
3. **“Reliable Gemini”** — best free-path onboarding + TUI that never breaks + clear quotas  

### E. Concrete MVP feature checklist (order matters)

**Week 0–4 — Retain**
- [ ] TUI: stream tokens, tool cards, interrupt, `@` files, themes  
- [ ] Permissions: ask/allow/deny + YOLO + plan mode  
- [ ] Sessions: save/resume/list  
- [ ] AGENTS.md + /init  
- [ ] One solid model path (don’t block on 75 providers day one)

**Week 4–8 — Differentiate**
- [ ] Permission DSL + project policy file committed to repo  
- [ ] Cost meter + budgets  
- [ ] MCP + 5 custom slash commands  
- [ ] Undo via snapshots  
- [ ] Headless JSON/NDJSON  

**Week 8–16 — Beat**
- [ ] Parallel subagents with TUI dashboard  
- [ ] Optional share links (local-first)  
- [ ] Client/server + IDE ACP  
- [ ] Review specialist tool (Oracle pattern)  
- [ ] Eval harness + public leaderboard of *tasks completed*  

---

## Side-by-side feature matrix (implementation detail)

| Capability | Gemini CLI | Amp | OpenCode |
|---|---|---|---|
| Interactive TUI | Yes (Ink) | CLI yes; editor primary | Yes (strong) |
| Desktop / Web | Companion / transition | VS Code-centric | Desktop + Web |
| Plan mode | Yes | Implicit / review agent | Yes (Plan agent) |
| YOLO / auto | Flag + Ctrl+Y | Unconstrained culture + allowlists | `--auto` / yolo |
| Permission granularity | Modes + excludes + sandbox | Rule engine + allowlist + delegate | Per-tool globs + agents |
| MCP | Yes | Yes | Yes (+ resources, code mode) |
| Custom commands | TOML excellent | Prompts/plugins | Commands + markdown agents |
| Plugins | Extensions gallery | Plugin API | npm plugins + hooks |
| Subagents | Worktrees experimental; extensions | Task + Oracle + Librarian | General/Explore/Scout + custom |
| Session share | File share / chat save | Cloud threads native | URL share optional |
| Undo | Checkpoints | Thread/editor workflows | `/undo` + snapshots |
| BYOM | No | Limited / routed | Yes |
| Free tier | Historically strong | Credits / free mode | Free software; you pay models |
| Self-host agent | OSS CLI; model is Google | No | Yes (harness); models optional local |
| CI integration | GitHub Action + headless | Headless / machines | GitHub Action + serve |

---

## Strategic takeaways for a competitor

1. **OpenCode sets the open-source UX and architecture bar.** If your TUI is slower or less keyboard-driven, power users will leave.  
2. **Amp sets the agency and team bar.** If your agent stops at 80% and can’t show parallel work or shared threads, teams stay on Amp.  
3. **Gemini sets the distribution and packaging bar** (auth ladder, extensions, Google ecosystem) — but **reliability and product continuity** are now its Achilles’ heel; don’t copy the churn.  
4. **Everyone has MCP.** MCP is not a differentiator; **permissioned MCP + cost of tool schemas in context** is.  
5. **Everyone has YOLO.** Differentiator is **safe defaults + fast path to trusted autonomy + audit**.  
6. **The market rewards finish rate.** Marketing “agentic” without task-completion evals is table stakes theater.  
7. **Cloud threads are a double-edged sword.** Amp’s multiplayer is beloved *and* blocked by security teams — own a design that does both.  
8. **Model lock-in is a liability in 2026.** OpenCode’s Anthropic episode is the case study; design for credential/policy shocks.

---

## Source index (primary)

- Gemini CLI: [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli), [geminicli.com docs](https://geminicli.com/docs/), Addy Osmani tips, Google Antigravity transition blog  
- Amp: [ampcode.com](https://ampcode.com) (Oracle, Librarian, FIF, permissions), StackHawk, Hamel notes, Zoltan Bourne early review, LinkedIn/Medium user comparisons
