# World-Class CLI Synthesis — Quorate + Convoke

**Date:** 2026-07-23
**Inputs:** three competitive teardowns in this directory covering Claude Code, Codex CLI,
Gemini CLI, Amp, OpenCode, Aider, Goose, Crush, Pi, Cline, Qwen Code, Kilo, and Factory Droid.

## The market gap (verbatim conclusion from the research)

> Nobody has cleanly won: *beautiful + transparent + sandboxed-by-default + cost-routed +
> git-safe + extension-friendly* as one coherent product.

Quorate and Convoke together sit in an unusual position: **convoke does the work, quorate
judges it**. No incumbent owns the "independent review before done" loop. That is the wedge —
everything below serves it.

## Table stakes (2026) — where we stand

| Capability | Quorate | Convoke | Incumbent bar |
|---|---|---|---|
| Streaming loop w/ visible tool calls | ✅ Ink TUI + monitor | ✅ REPL events + spinner states | All |
| Plan mode | ✅ `/mode plan`, PlanCourt | ✅ `/plan` (read-only enforced) | All |
| Permission model | ✅ approvals via monitor | ⚠️ confirm/deny lists; no sandbox | Codex kernel sandbox; Claude auto mode; OpenCode glob DSL |
| Session resume/fork | ✅ `/resume`, `/rename`, `/compare` | ✅ `--resume`, `--continue`; no fork | Pi session trees; OpenCode fork/share |
| Cost/token visibility | ⚠️ per-run only | ✅ per-turn + `/usage` | Crush live cost sidebar |
| Headless JSON for CI | ✅ `review --json`, Action | ✅ `chat --json` | All |
| Project memory file | ✅ `.quorate.yml` | ✅ `AGENTS.md` | AGENTS.md is the open standard |
| MCP | ❌ (providers are CLIs/APIs) | ✅ stdio MCP host | All incumbents |
| Repo intelligence | n/a (diff-based) | ✅ LSP + hash-anchored edits | Aider repo-map, Crush LSP |
| Undo / git safety | n/a | ⚠️ hash-anchored edits, no `/undo` | Aider atomic commits + `/undo`; OpenCode snapshots |

## Five moves that beat the field

Ranked by (impact × fit), each mapped to the product that owns it.

### 1. Trust UX — own "the agent you can trust" (both products)
The research is unanimous: approval fatigue vs YOLO is the biggest unsolved product problem
(Claude auto mode still has ~17% FNR; Pi rejects permissions entirely; OpenCode defaults open).
- **Convoke:** risk-scored approvals — show blast radius ("writes 3 files, runs `cargo test`,
  touches nothing outside repo") instead of raw argv. Permission DSL like OpenCode's
  (`bash: {"git *": allow, "rm *": deny}`) in `.convoke.yml`. OS sandbox (Seatbelt/bubblewrap)
  for `bash` is the P1 investment — the current denylist is documentation, not enforcement.
- **Quorate:** the monitor's approve/deny surface is already the differentiator — market it.
  Add a signed audit log of every approval decision (SIEM-exportable). "Prove what ran."

### 2. Cost governor — convert users angry about opaque burn (both)
Every teardown lists cost opacity as a churn driver (Claude Max burn, Amp bill shock).
- **Convoke:** already tracks per-turn tokens. Add: live $/session estimate in the REPL footer,
  `--budget 2.00` hard stop, and dual-model routing (cheap model for titles/compaction like
  OpenCode's `small_model`).
- **Quorate:** per-reviewer cost attribution in the verdict report ("this FAIL cost $0.31,
  agreement 2/3"). Councils are parallel — show the fan-out cost before running.

### 3. Session archaeology (convoke)
Pi's tree sessions and OpenCode's fork/share are the loved features here.
- `convoke sessions list` (exists as files only — no CLI verb yet), `/fork`, `/export` HTML,
  and per-cwd resume picker with title + token estimate.
- Compaction that preserves *decisions, file maps, and failed attempts* as first-class
  artifacts — the research calls this out as universally weak.

### 4. Review as a product surface (quorate)
Claude Code ships `/code-review ultra`, Amp ships review agents — but review is a side effect
for them. It IS quorate. Double down:
- "Show me only risky hunks" filter in the monitor web UI.
- PR draft with evidence links to reviewer traces (the Action already has SARIF/JUnit — link
  findings back to lane transcripts).
- Publish *our* metrics: median approvals per task, tokens per verdict, agreement rates.
  Incumbents brag SWE-bench; nobody publishes review-quality numbers.

### 5. Interop, not war (both)
Hybrid usage is normal — many users run Claude Code AND Codex. Fit in:
- Convoke already reads `AGENTS.md`; also read `CLAUDE.md` fallback (OpenCode does; costs a day).
- Crush discovers skills from `.claude/skills`, `.agents/skills` — convoke's skills.rs should too.
- Quorate already drives claude/codex/qwen headlessly — that "runs your existing tools"
  positioning is exactly the coexistence story the research recommends.

## Anti-goals (explicitly rejected by the research)

- **Don't chase model quality** — "model parity is a treadmill"; ride whatever the market supplies.
- **Don't clone one incumbent** — "Claude Code but cheaper" fails without a wedge.
- **Don't boil the ocean on providers** — one solid path first, 75 providers later.
- **Don't add knobs Amp-style FIF warns about** — every option is a support ticket.

## Concrete near-term checklist

Done — security:
- [x] Quorate: monitor hardening (CSPRNG approval ids, Content-Type gate, frame-ancestors,
      Host validation).
- [x] Convoke: SSRF guard on `read` URLs, session id validation, 0600/0700 session files,
      user-prompt redaction at rest, docs CSP.

Done — CLI UX:
- [x] Convoke: REPL busy states (thinking / running tool / elapsed) — the "feels alive" fix.
- [x] Convoke: **`/undo`** via file snapshots (write/edit pre-images, per-turn checkpoints,
      last 20 undoable). Unit + integration tested.
- [x] Convoke: **permission DSL** (`tools.permission`, allow/ask/deny globs, first-match-wins,
      falls back to confirm list). Unit + integration tested.
- [x] Convoke: **doom-loop guard** (identical tool call ×3 ends the turn cleanly).
- [x] Convoke: **session product** — `sessions list`/`show` (+`--json`), `/sessions`, `/fork`,
      `/export`; `/status`; richer footer (turn + session tokens + context + verdict + undo);
      mode-aware prompt.
- [x] Quorate: per-reviewer duration + review-budget token/cost estimate in the verdict report
      (cost attribution per lane).

Done — web:
- [x] Quorate website: mobile grid clipping fix (+ dedicated a11y/polish pass).
- [x] Convoke website: dedicated a11y/polish pass.

Next (ordered):
- [ ] Convoke: OS sandbox for bash (Seatbelt first — macOS is the dev base). The denylist is
      documentation, not enforcement.
- [ ] Convoke: risk-scored confirms (blast radius, not raw argv) + budget governor.
- [ ] Quorate: audit log export for approval decisions.
- [ ] Both: session cost in the persistent statusline (Codex `/statusline` pattern).
