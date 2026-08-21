I'll research these agentic coding CLIs in depth—starting with their repos, docs, and recent user feedback—then synthesize a competitive teardown.# Competitive Teardown: Agentic Coding CLIs (2025–2026)

**Research date:** 2026-07-23  
**Scope:** Aider, Goose (Block/AAIF), Crush (Charm), Pi (Earendil / Mario Zechner), plus OpenCode, Cline CLI, Qwen Code, Kilo CLI, Factory Droid  
**Purpose:** Concrete competitive intelligence for building a competing agentic coding CLI

---

## Executive landscape map

| Tool | Stars (approx.) | Lang | License | Philosophy | Primary surface |
|------|-----------------|------|---------|------------|-----------------|
| **OpenCode** | ~165–180k | Go/TS ecosystem | MIT | Model-agnostic TUI empire | Terminal + desktop + IDE |
| **Pi** | ~75k | TypeScript | MIT (core) | Minimal harness, max extensibility | Terminal (RPC/SDK) |
| **Aider** | ~39k | Python | Apache-2.0 | Git-first pair programmer | Classic REPL CLI |
| **Goose** | ~50k+ | Rust | Apache-2.0 | Local agent runtime + MCP | Desktop + CLI + API |
| **Cline** | ~60–64k | TS | Apache-2.0 | Human-in-the-loop control plane | IDE + CLI + SDK |
| **Crush** | ~27k | Go | FSL-1.1-MIT | Glamorous Charm TUI | Full-screen TUI |
| **Kilo** | ~26k (CLI) | OpenCode-based | MIT | All-in-one + 500 models | IDE + CLI + cloud |
| **Qwen Code** | growing | TS (Gemini CLI fork) | Apache-2.0 | Model-optimized agent CLI | Terminal + desktop |
| **Factory Droid** | enterprise | proprietary | Source-available | Mission/delegation platform | TUI + IDE + Slack + web |

The category is no longer “chatbots that write code.” These are **agent loops**: read FS → edit → shell → observe → loop, with git, MCP, sessions, and permission layers on top.

---

## 1. Aider (Aider-AI/aider)

### 1.1 TUI / UX patterns
- **Classic line-oriented CLI**, not a full-screen TUI. Text-dense, power-user friendly, deliberately utilitarian.
- **Chat modes:** `/code` (default edits), `/ask` (discuss without editing), **architect** (planner model + editor model), `/help`.
- **Command surface:** `/add`, `/drop`, `/undo`, `/diff`, `/model`, `/tokens`, `/run <cmd>`, `/web`, `/voice`, `/paste`.
- **Diff-first workflow:** shows diffs, seeks confirmation, commits atomically with AI-written messages.
- **IDE watch mode:** comments like `AI!` / `AI?` in the editor drive the agent while you stay in Vim/VS Code.
- **Weak UX:** no Mission Control, no multi-pane chrome, no beautiful sidebar. Users who care about visual session management prefer OpenCode/Crush.

### 1.2 Architecture
- **Python** tool, **LiteLLM-compatible** model layer → nearly any cloud or local model.
- **Repo map via tree-sitter:** compact structural map of the whole repo sent to the LLM (not full files by default).
- **Edit formats:** Aider’s own structured edit formats (search/replace style) optimized for reliable multi-file patches.
- **Architect/editor dual-model:** strong model plans; cheap/fast model emits diffs — major cost lever.
- **Git as system of record:** every change can become an atomic commit.

### 1.3 Permission model
- **Permissive by default for speed**; configurable deny lists.
- Diff confirmation before applying edits is the main safety rail.
- Shell via `/run` is user-initiated more than fully autonomous agent-driven (lighter agent loop than Claude Code / Goose).

### 1.4 Session management
- **Git is the session store:** history = commits; `/undo` reverts last Aider commit.
- Single session per terminal; no built-in multi-session coordination or shareable session links.
- Branch-per-session is a common user pattern, not a first-class product feature.

### 1.5 Killer features users love
| Feature | Why it sticks |
|---------|----------------|
| **Atomic git commits + `/undo`** | Instant rollback; forces good history |
| **Repo map** | Cheap, effective whole-repo context |
| **Architect mode** | Quality × cost routing |
| **Model agnosticism + Ollama** | No vendor lock-in; air-gapped possible |
| **Polyglot leaderboard** | Trust via transparent model benchmarks |
| **Token efficiency** | Reports of ~4.2× fewer tokens than Claude Code on equivalent tasks |

Usage scale claims: ~39k stars, multi-million installs, billions of tokens/week.

### 1.6 Complaints / weaknesses
- Not a deep autonomous orchestrator — “disciplined pair programmer,” not multi-hour fleet agent.
- Manual file context management (`/add`/`/drop`) feels dated vs auto-context agents.
- Utilitarian UI; steep config for advanced routing.
- Weaker multi-step agentic scaffolding vs Claude Code / OpenCode.
- No first-class multi-session or session sharing.

### 1.7 Beat-Aider checklist
- Match or beat **git-native undo** (or invent something clearly better: worktree sandboxes + one-key rollback).
- Match **token efficiency** of repo-map + dual-model routing.
- Exceed on **autonomy depth** without blowing cost.
- Exceed on **UX** (Aider’s soft underbelly).

---

## 2. Goose (Block → AAIF)

### 2.1 TUI / UX patterns
- **Three surfaces:** native desktop app (macOS/Linux/Windows), full CLI/TUI, embeddable API.
- **Two CLI styles:** full REPL chat *and* ambient terminal integration `@goose "do this"` that returns you to the shell.
- Desktop can render **MCP Apps** (interactive UI widgets from extensions).
- Feels more “general personal agent” than “coding-only CLI.”

### 2.2 Architecture
- **Rust** for performance/portability.
- Core design: **Interface + Provider + Extensions** agent runtime.
- **MCP-native** (early/deep adopter); 70+ documented extensions (DBs, browsers, GitHub, Drive, etc.).
- **Recipes / subrecipes:** portable YAML workflows (instructions, extensions, params) for team share and CI.
- **Subagents** for parallel specialized work while keeping main chat clean.
- **ACP (Agent Client Protocol):** Goose as ACP server for Zed/JetBrains/VS Code; can also use Claude Code/Codex as ACP providers.
- Governance: donated to **Agentic AI Foundation** (Linux Foundation) with MCP + AGENTS.md.

### 2.3 Permission model (differentiator)
Industry-leading open-source security story:
- Tool permission controls  
- Sandbox mode  
- **Prompt injection detection**  
- **Adversary reviewer** that watches for unsafe actions.  

This is the reference design if you want enterprise trust without being Anthropic.

### 2.4 Session management
- Recipes as reusable session templates.
- Subagents isolate side work.
- Desktop + CLI continuity is stronger than pure CLIs.
- Ambient `@goose` mode is intentionally *session-light* (task handoff, not long chat).

### 2.5 Killer features users love
| Feature | Why |
|---------|-----|
| **Beyond coding** | Research, automation, data analysis — not just patches |
| **Recipes** | Reproducible team workflows / CI agents |
| **MCP depth** | Real tool ecosystem, not checkbox support |
| **Security suite** | Adversary mode + sandbox resonates with enterprises |
| **Local-first + any LLM** | Including subscription providers via ACP |

### 2.6 Complaints / weaknesses
- Heavier product surface (desktop + recipes + extensions) → steeper onboarding than Aider.
- Planning-first can feel slow for “just fix this function.”
- Coding-specific polish (diffs, cost sidebar, LSP) trails Crush/OpenCode/Claude Code.
- Community mindshare in pure coding-CLI searches still splits with OpenCode/Aider.

### 2.7 Beat-Goose checklist
- Clearer **coding-first** UX than Goose while matching **MCP + recipes**.
- Comparable **security story** (sandbox + injection detection) — hard, high-value moat.
- Lighter install path for “I just want a coding CLI.”

---

## 3. Crush (Charmbracelet/crush) — TUI deep dive

### 3.1 TUI / UX patterns (the main reason people try it)
Crush is the design-forward entry. Built on Charm’s stack (Bubble Tea / Lip Gloss lineage; Charm ecosystem powers 25k+ apps).

**Concrete UX patterns that stand out:**

| Pattern | Detail |
|---------|--------|
| **Split-pane layout** | Chat + dedicated **diff view** + sidebar |
| **Changed-files list** | Always-visible “what did the agent touch?” |
| **Live model + cost** | Sidebar shows active model and spend (users call this out constantly) | |
| **Ctrl+P command palette** | Quick model switch, summarize session, commands |
| **Ctrl+L model picker** | Mid-session model switch with preserved context |
| **Hotkey accept/reject** | Better change-accept UX than many CLIs (HN users) | |
| **Desktop notifications** | When permission needed or turn finishes (if terminal unfocused) |
| **Compact mode** | Configurable dense layout |
| **Scrollbars, animations, gradients** | “Glamorous” Charm aesthetic — feels like a mini desktop app in the terminal | |
| **Works in Neovim panes** | Real workflows run Crush beside code | |

**TUI architecture note:** full Charm TUI (viewport ownership style), not pure scrollback-append like Claude Code/Pi. Tradeoff: beauty vs terminal-native scrollback/search quirks.

### 3.2 Architecture
- **Go** single binary; wide platform packaging (brew, npm, winget, scoop, apt, yum, Nix, FreeBSD…).
- **LSP-enhanced context:** spawns `gopls`, `typescript-language-server`, etc. so the agent sees symbols like an IDE.
- **MCP:** stdio, http, sse; OAuth for MCP servers; shell expansion in config (`$(cat secret)`, `${VAR:?msg}`).
- **Skills:** Agent Skills standard (`SKILL.md`); discovers from `.agents/skills`, `.crush/skills`, `.claude/skills`, `.cursor/skills`.
- **Hooks:** preliminary lifecycle hooks.
- **Catwalk:** community model/provider database with auto-updates.
- **Charm Hyper:** first-party subscription provider (ZDR, GDPR-oriented).
- **Client/server workspace model:** `crush serve` + multiple TUIs can attach to same cwd workspace (shared sessions, permission queue, LSP/MCP).
- Local persistence under `~/.local/share/crush/`; project logs in `./.crush/logs/`.

### 3.3 Permission model
```json
"permissions": { "allowed_tools": ["view", "ls", "grep", "edit", ...] }
```
- Default: **ask before tool calls**.
- Allowlist for auto-approve.
- `--yolo` skips all prompts (first-wins if multiple clients join a workspace).
- `options.disabled_tools` / `disabled_skills` fully hide capabilities.
- Security note in docs: `crush.json` is trusted code; `$(...)` runs at load time.

### 3.4 Session management
- **Multiple sessions per project** with session picker.
- Fresh session per invocation by default; rejoin via session manager.
- Session metadata: `IsBusy`, `AttachedClients` for multi-client collaboration.
- Workspace teardown when last SSE stream disconnects.
- Context files: `AGENTS.md`, `CRUSH.md`, global paths, `.crushignore`.

### 3.5 Killer features users love
- “**Best looking CLI coding tool**” / mini-desktop feel.
- Sidebar cost tracking — trust and budget awareness.
- LSP awareness without leaving terminal.
- Mid-session model switch with preserved context.
- Cross-ecosystem skills discovery (Claude/Cursor dirs).

### 3.6 Complaints / weaknesses
| Complaint | Source theme |
|-----------|--------------|
| Agent capability lags Claude Code | Missing multi-model routing (Haiku for search + Sonnet for think) | |
| Cost without Cursor-style subsidies | $23 for a small feature in one write-up | |
| Junk binary/files in project dir | HN |
| Terminal crashes (Ctrl+C) early on | HN |
| Visual bugs inside Neovim | Blog review |
| **FSL-1.1-MIT** not pure OSS for some buyers | License friction |
| Optional telemetry (opt-out via `DO_NOT_TRACK`) | Privacy-sensitive users |

### 3.7 Beat-Crush checklist
- Equal or better **information density** (files touched, cost, model, permissions queue) without pure decoration.
- Match **LSP + MCP + skills** interoperability.
- Beat on **agent loop quality** and **cost routing**.
- Prefer **MIT/Apache** if OSS purity is a wedge.
- Don’t create mystery project-dir clutter.

---

## 4. Pi coding agent (Mario Zechner / badlogic → Earendil)

### 4.1 TUI / UX patterns
- Custom **pi-tui**: retained-mode components + **differential rendering** + synchronized output (low flicker).
- **Scrollback-native** design (like Claude Code): appends to terminal history; preserves terminal search/scroll — *not* full-screen viewport ownership like OpenCode/Amp.
- Editor: fuzzy file search, path completion, drag-drop, multi-line paste.
- **Steering while agent runs:** Enter = interrupt after current tool; Alt+Enter = queue follow-up.
- Themes with live reload; HTML export of sessions.

### 4.2 Architecture (the most interesting OSS harness design)
Monorepo packages:

| Package | Role |
|---------|------|
| **pi-ai** | Unified multi-provider LLM API (4 base APIs), streaming, tool schemas (TypeBox), cost tracking, cross-provider context handoff |
| **pi-agent-core** | Agent loop, state, events, queuing |
| **pi-tui** | Minimal TUI framework |
| **pi-coding-agent** | CLI product wiring |

**Deliberate minimalism:**
- System prompt **~1k tokens** total with tools (vs multi-k Claude Code prompts).
- **Four tools only by default:** `read`, `write`, `edit`, `bash` (+ optional read-only grep/find/ls).
- **No baked-in MCP, subagents, plan mode, todos, background bash** — all via extensions or “use bash/tmux.”
- **Self-extending:** TypeScript extensions hot-reload; `pi install` packages from npm/git; community ships Doom, annotate, messenger, etc.
- Four run modes: interactive, print/JSON, **RPC**, **SDK** (OpenClaw integration).

### 4.3 Permission model
- **YOLO by default** — no permission popups; runs as your user.
- Philosophy: file write + shell + network = unsolvable trifecta; permission theater is rejected.
- Escape hatches: containers; extension examples for permission gates, path protection, sandbox.
- Docs explicitly: no built-in FS/network/credential restriction system.

### 4.4 Session management
- **Tree-structured sessions** in a single file: `/tree` navigate any prior point, branch, bookmark.
- `/export` HTML, `/share` gist URL.
- Hierarchical `AGENTS.md` + replaceable `SYSTEM.md`.
- Compaction now available and customizable via extensions (was a gap at launch).
- Message queuing during agent work.

### 4.5 Killer features users love
| Feature | Why |
|---------|-----|
| **Context engineering control** | Nothing injected behind your back |
| **Session trees + share** | Best-in-class session archaeology |
| **Extensibility** | Harness becomes your product (OpenClaw) |
| **Cross-provider handoff** | Real mid-session provider switch |
| **Cost/token tracking** | Transparent |
| **Terminal-Bench competitiveness** with minimal tools | Validates “less is more” |
| **RPC/SDK** | Build other products on the core |

### 4.6 Complaints / weaknesses
- YOLO scares enterprises without containers.
- “Build it yourself” fatigues non-hackers.
- No first-class MCP (contrarian; ecosystem tax for some).
- Earendil stewardship: core MIT, adjacent components may use Fair Source / paid tiers — governance risk for pure-OSS purists.
- Single-maintainer origins still color perception even after Earendil.

### 4.7 Beat-Pi checklist
- Offer **Pi-level observability** (full message/tool transparency) *plus* optional safe defaults.
- Match **session tree branching**.
- Match **extension model** without becoming feature-bloated.
- Win users who want **secure defaults without fighting the tool**.

---

## 5. Other notable open-source / agentic CLIs (2025–2026)

### 5.1 OpenCode (anomalyco/sst lineage) — current star king
- **~165–180k stars**; MIT; Go-based rich TUI; desktop + IDE.
- **75+ providers** via Models.dev / AI SDK; local Ollama/LM Studio.
- **Multi-session parallel agents** on one project; **shareable session links**.
- **Plan vs Build dual-agent** workflow; Git-backed session review in TUI.
- LSP enabled; themes/keybinds; Copilot/ChatGPT login reuse.
- **Weaknesses:** complexity; provider ToS drama (historical OAuth blocks); learning curve.
- **Strategic note:** Kilo CLI is built *on* OpenCode foundation.

### 5.2 Cline CLI
- From VS Code pioneer → **IDE + CLI + SDK** one agent.
- **Plan/Act modes**; explicit approval for edits/commands (compliance-friendly).
- Browser automation; workspace checkpoints; parallel agents + Kanban boards (2026).
- Human-in-the-loop can feel slow for power users who live in YOLO.
- Best positioning: regulated teams, audit trails.

### 5.3 Qwen Code (QwenLM/qwen-code)
- Open-sourced with **Qwen3-Coder**; forked from **Gemini CLI**, retuned prompts/tool protocols.
- Apache-2.0; agentic out of the box: Auto-Memory, Skills, SubAgents, Teams, MCP.
- Optimized for Alibaba Cloud models; OpenAI-SDK-compatible endpoints.
- Desktop app + IDE integrations.
- **Risk:** model-tied perception; fork drift from Gemini CLI base; China/US infra politics for some enterprises.

### 5.4 Kilo CLI (Kilo-Org)
- `npm i -g @kilocode/cli`; **OpenCode foundation**.
- **500+ models**, zero markup BYOK; orchestrator / specialized agents.
- Same agent across VS Code, JetBrains, CLI, cloud; parallel worktrees.
- Acquired by Anaconda (2026 news on site) — distribution play.
- Differentiates as platform glue more than novel agent science.

### 5.5 Factory Droid CLI
- Enterprise / multi-surface agent: TUI + IDE + Slack + Jira + web.
- **Missions**, persistent sessions, fork/resume, slash command palette, skills/MCP/hooks.
- Strong Terminal-Bench positioning historically; **source-available proprietary**, not free OSS.
- Sessions/skills sync across surfaces — “delegation OS,” not just coding CLI.
- Weaknesses users note: stability vs Claude Code; pricing $20–200/mo tier stories.

### 5.6 Mentions worth knowing
- **Plandex:** cumulative diff sandbox + huge context indexing for long-horizon work.
- **Codex CLI (OpenAI):** Rust, AGENTS.md, three permission modes (suggest / auto-edit / full-auto).
- **Gemini CLI:** free tier generosity, 1M context.
- **Claude Code:** still the commercial quality bar (not OSS).

---

## 6. Cross-cutting comparison matrices

### 6.1 TUI strategy

| Approach | Examples | Pros | Cons |
|----------|----------|------|------|
| Scrollback-native | Claude Code, Pi, Droid | Terminal search, low reimplementation | Harder multi-pane “app” UX |
| Full-screen TUI | Crush, OpenCode | App-like chrome, sidebars | Custom scroll/search; flicker risk |
| Classic REPL | Aider | Simple, scriptable | Feels dated |
| Desktop + CLI | Goose, OpenCode, Kilo | Non-terminal users | Heavier product |

### 6.2 Permission spectrum

```
YOLO ←————————————————————————→ Approve everything
 Pi     Aider(default)   Crush     Claude(sandbox)   Cline
        Goose(configurable)  Codex modes
```

Enterprise buyers cluster right; power users live left. **Winning product:** tiered modes (Codex-style) with one-command sandbox, not a single philosophy.

### 6.3 Session models

| Model | Tool | Strength |
|-------|------|----------|
| Git commits | Aider | Rollback truth |
| Session files + share links | OpenCode, Pi | Collaboration |
| Session trees | Pi | Branching archaeology |
| Workspace multi-client | Crush | Pairing on same agent |
| Missions + multi-surface sync | Factory | Org workflows |
| Recipes | Goose | Repeatable automation |
| Checkpoints / cumulative sandbox | Cline / Plandex | Safe long tasks |

### 6.4 Extensibility

| Standard | Who leans in |
|----------|----------------|
| **MCP** | Goose, Crush, OpenCode, Cline, Qwen, Droid |
| **Anti-MCP (CLI+README skills)** | Pi |
| **Agent Skills (SKILL.md)** | Crush, others converging |
| **Hooks** | Claude Code, Crush, Droid |
| **TypeScript self-modify** | Pi |
| **YAML recipes** | Goose |
| **AGENTS.md** | Near-universal (AAIF) |

---

## 7. What users actually love (pattern synthesis)

1. **Trust surfaces:** cost sidebar, changed-file list, transparent tool calls, git undo.
2. **Model freedom:** BYOK + local; mid-session switch without losing context.
3. **Git as safety net:** Aider’s atomic commits still undefeated as “I can’t mess up forever.”
4. **Beautiful ≠ optional:** Crush proved delight converts trials; ugly CLIs lose casual users to Cursor.
5. **Depth of autonomy with an off-ramp:** Plan mode → Act; steer mid-run (Pi’s Enter/Alt+Enter).
6. **Headless/CI:** print/RPC/SDK modes for agents as infrastructure.
7. **Interoperability:** MCP + AGENTS.md + skills directories that respect Claude/Cursor layouts.

---

## 8. Common complaints (pattern synthesis)

1. **Prompt bloat / opaque injections** (why Pi exists).
2. **Permission fatigue** *or* **YOLO anxiety** — both lose users.
3. **Token cost without routing** (dual-model, caching, cheap model for search).
4. **Feature bloat breaking workflows** (Mario’s critique of Claude Code).
5. **Weak large-repo understanding** without LSP/repo-map/indexing.
6. **Session amnesia** after compaction or multi-day work.
7. **Mystery files, crashes, ToS/provider blocks.**
8. **OSS purity vs funded sustainability** (FSL, Fair Source, proprietary Droid).

---

## 9. What an upstart CLI must do to beat them all

Be specific. You cannot win by being “Claude Code but open.” You need a **wedge + parity stack**.

### 9.1 Non-negotiable parity (table stakes in 2026)
If any of these are missing, power users bounce:

1. **Multi-provider + local** with mid-session switch and cost display  
2. **Agent loop:** read / search / edit / bash / (optional browser)  
3. **AGENTS.md** hierarchical project instructions  
4. **Git-aware workflow** (commit messages, diff review, undo or worktree reset)  
5. **Headless mode** (`--print` / JSON events / CI)  
6. **Skills or MCP** (ideally both, with progressive disclosure so tools don’t burn 15k tokens)  
7. **Session resume** across days  
8. **Cross-platform single binary or one-line install**

### 9.2 Pick one primary wedge (own a dimension)

| Wedge | How you beat | Who you steal from |
|-------|--------------|--------------------|
| **Trust UX** | Crush-level chrome + Aider-level git undo + always-visible cost/files/permissions queue | Crush, Aider |
| **Context control** | Pi-level transparency + optional “explain every injection” inspector | Pi users, Claude refugees |
| **Secure autonomy** | Goose adversary + OS sandbox + Codex 3-mode permissions, default “sandbox auto” | Goose, enterprise Cline |
| **Long-horizon work** | Plandex cumulative sandbox + multi-session missions + worktrees | Plandex, Factory |
| **Speed/cost** | Architect/editor routing + prompt cache + repo-map + LSP hybrid | Aider |
| **Hackability** | Pi extensions + package registry + RPC, but with safer defaults | Pi, OpenCode plugins |

**Recommendation:** combine **Trust UX + Secure autonomy + Cost routing**. Nobody owns all three cleanly today.

### 9.3 Concrete product requirements to leapfrog

#### A. TUI (steal Crush’s wins, avoid its traps)
- Split view: **chat | streaming diff | inspector** (files, tools, cost, tokens, permissions).
- Command palette (`Ctrl+P`), model picker (`Ctrl+L`).
- Prefer **scrollback-native rendering with differential updates** (Pi) for terminal fidelity; layer optional full-screen “focus mode.”
- Zero mystery project files; put state in `~/.config` / `XDG` only; optional `.agent/` if user opts in.
- Steering: interruptible runs with queued follow-ups (Pi).

#### B. Architecture
- **Thin core, thick packages** (Pi monorepo idea): `llm`, `agent-loop`, `tui`, `cli` separable.
- **Repo intelligence hybrid:** tree-sitter repo-map (Aider) + optional LSP (Crush/OpenCode) + ignore files.
- **Dual-model / multi-model roles:** planner / editor / judge (security adversary).
- **Event-sourced sessions** (JSONL) with tree branch points + HTML export + share links.
- First-class **worktree isolation** for autonomous runs.

#### C. Permissions (the product)
Ship **four modes** (document them ruthlessly):

| Mode | Behavior |
|------|----------|
| `suggest` | Read-only proposals |
| `pair` | Approve writes & shell (Crush-like allowlists) |
| `sandbox` | Auto-approve inside bubblewrap/Seatbelt + network proxy |
| `yolo` | Full user privileges (Pi-like; require flag) |

Add **adversary co-pilot** (Goose-inspired) on `sandbox`/`yolo` that can block exfil patterns.

#### D. Session management
- Tree sessions (Pi) + multi-session parallel (OpenCode) + git commits optional (Aider).
- Mission/recipe YAML (Goose) for team CI.
- Multi-client attach to workspace (Crush) for pair programming with an agent.

#### E. Killer features still under-served (white space)
1. **Verified apply:** run tests/typecheck automatically; only commit if green (Aider `/run` productized).  
2. **Cost governor:** hard session budget, auto-downshift models.  
3. **Context debugger:** show exact token breakdown (system / tools / repo-map / messages / skills).  
4. **Cross-agent import:** open Claude Code / Aider / OpenCode session exports.  
5. **Team policy as code:** org allowlists for MCP, domains, paths — portable JSON.  
6. **True observability for subagents:** no black boxes (Pi’s complaint about Claude Code).  
7. **One-command offline:** Ollama path as polished as cloud path.

### 9.4 Go-to-market positioning one-liners

| If you say… | You’re fighting… | Risky because… |
|-------------|-------------------|----------------|
| “Prettier Claude Code” | Crush + OpenCode | Feature arms race |
| “Safer Goose for coding” | Goose + Cline | Enterprise sales cycle |
| “Aider with a real agent loop” | Aider + OpenCode | Must keep git magic |
| “Pi with defaults you’ll actually ship” | Pi | Extension purists revolt |
| “OpenCode without the complexity” | OpenCode | Hard — they’re already huge |

**Strongest upstart story:**

> *The coding CLI that shows its work: every token, every tool, every permission — beautiful enough to love, sandboxed enough to trust, cheap enough to leave on all day.*

### 9.5 Build order (pragmatic 90-day)

| Phase | Ship |
|-------|------|
| **Days 1–30** | Agent loop + multi-provider + session JSONL + diff apply + git commit/undo + basic TUI |
| **Days 31–60** | Permission modes + cost sidebar + repo-map + plan/act + headless JSON |
| **Days 61–90** | LSP optional, MCP, skills, sandbox, share links, dual-model routing |
| **Later** | Recipes, multi-agent with full visibility, team policy, desktop |

### 9.6 Metrics that matter (not stars alone)
- **Task success @ fixed $ budget** (Aider-style polyglot + Terminal-Bench)
- **Tokens per merged PR**
- **% actions auto-approved in sandbox without incidents**
- **Time-to-first-successful-edit** for new users
- **Session resume rate** (do people come back mid-task?)
- **Extension/package installs** (if platform play)

---

## 10. Bottom line for a competitor

| Competitor | Don’t try to out-X them at | Steal this |
|------------|----------------------------|------------|
| **Aider** | Git culture + simplicity | Repo-map, atomic commits, architect mode, polyglot bench |
| **Goose** | Enterprise agent platform breadth | Recipes, adversary security, MCP depth, multi-surface |
| **Crush** | Pure visual polish brand | Cost/files sidebar, palette, LSP, permission allowlists, packaging |
| **Pi** | Minimalist purity + extension cult | Session trees, context control, pi-ai quality, RPC/SDK |
| **OpenCode** | Star gravity + provider matrix | Multi-session, share links, plan/build split |
| **Cline** | Compliance narrative | Plan/Act approvals, checkpoints, SDK |
| **Qwen Code** | Model vertical integration | Free model+CLI bundles if you have a model |
| **Kilo** | Distribution/500 models | Gateway + multi-surface packaging |
| **Droid** | Enterprise multi-app sync | Missions, cross-surface session continuity |

**The market gap in mid-2026:**  
OpenCode won mindshare and stars; Claude Code won raw agent quality; Aider won git+cost; Crush won beauty; Pi won hackability; Goose won security/runtime standards.  

**Nobody has cleanly won:** *beautiful + transparent + sandboxed-by-default + cost-routed + git-safe + extension-friendly* as one coherent product.

That intersection is where a serious upstart should aim — and every row in this teardown is a concrete requirement, not a vibe.

---

### Primary sources used
Official product pages and repos: [Aider](https://aider.chat/), [Goose](https://goose-docs.ai/), [Crush README](
