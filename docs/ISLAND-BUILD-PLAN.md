# Quorate Island — Build Plan (v1.3.0 → v1.4.0)

**Goal:** a native macOS notch/menu-bar app that shows every AI-agent run live — including *other* AI CLIs you launched yourself (Claude Code, etc.), their subagents, and live approve/deny — built on Quorate's existing v1.3.0 monitor data plane.

**Execution:** GLM-5.2 (`opencode run -m zai-coding-plan/glm-5.2 --variant max --dangerously-skip-permissions --dir <repo>`) authors all code. Build one phase at a time; gate after each. A phase is too big for one opencode run — split its numbered items into chunks of 1–2 items, run each separately (opencode file edits persist on disk between calls), then gate.

---

## Ground rules (paste at the top of every GLM prompt)
- Repo `/Users/umut/Projects/quorate`, branch `feat/island-companion` (branch from `main`; NEVER touch `main`).
- Node ≥22, ESM, strict TS, immutability, files < 800 lines, explicit error handling (never silently swallow), no `console.log` in shipped paths (`console.error` for CLI UX is fine).
- Vitest AAA tests for all new logic; tests use TEMP dirs only — never the real `~/.quorate` or `~/.claude`.
- Conventional commits; NEVER add Co-Authored-By / attribution trailers. Don't change any package version until Phase D.
- GATE after every phase (each command ≤10 min, run separately): `npm run build` → `npm run typecheck` → `npx vitest run`, all green, no regression below the **1079** baseline. Phase C also gates on `swift build`.

## Existing foundation to REUSE (v1.3.0, already shipped)
- `packages/cli/src/live-spool.ts` — data plane. `createLiveSpoolSink, listLiveRuns, readRunEvents, liveRunFilePath, liveRunMetaPath, defaultLiveDir (~/.quorate/live), teeJsonStreamSink, sanitizeArgvForMeta`. `LiveRunEntry{runId,pid,cwd,repo,mode,subject,startedAt,planned,status,updatedAt,argv?,parentRunId?,parentLane?}`. Per-run `<id>.ndjson` + `<id>.meta.json`, atomic temp+rename, modes 0600/0700. runId `/^[A-Za-z0-9._-]+$/`.
- `packages/core/src/types.ts` — `CouncilEvent` union: `council/started|provider/started|provider/chunk{stream,text}|provider/done{result}|council/done|verdict`, optional `parentRunId/parentLane`.
- `packages/cli/src/tui/monitor-state.ts` — `pollMonitorState, applyEventToLanes` (adds unplanned lanes on `provider/started`), `buildRunTree` (single-hop nesting), `appendTail` (chunk stitching, 200-line/16KB caps).
- `packages/cli/src/tui/monitor.tsx` — Ink dashboard `launchMonitor`.
- `packages/cli/src/monitor-server.ts` — loopback http+SSE: `createMonitorServer, listenMonitorServer, createSseBroadcaster` (one shared poller), `handleMonitorRequest`, `MAX_SSE_CLIENTS=8`, `?token=` constant-time auth, strict CSP, `POST /control {action:abort|rerun,runId}` (4KB cap, 10s timeout). `runToPayload`: `{runId,repo,mode,subject,status,startedAt,verdict?,degraded?,parentLane?,lanes:[{laneKey,providerId,role,gate,state,note,status,preview,error,tail<=50}],children?}`.
- `packages/cli/src/monitor-controls.ts` — `abortLiveRun` (SIGINT, pid-identity via ps/tasklist), `rerunLiveRun` (entrypoint-pinned argv respawn), `runControl, isGateLane`.
- `packages/cli/src/monitor-page.ts` — embedded web dashboard (textContent-only DOM, NO innerHTML).
- `packages/cli/src/index.ts` — commander; `monitor` subcommand (~line 1720) with `--json/--web/--port/--no-open`.

## Verified machine facts (don't re-derive)
- Swift 6.3.3, Xcode 26.6, macOS 26.5 arm64, `codesign` present.
- Claude Code (`~/.claude/settings.json`) supports hook events: PreToolUse, PostToolUse, PermissionRequest, Notification, Stop, SubagentStart, SubagentStop, SessionStart, SessionEnd, UserPromptSubmit. Hooks are shell commands, JSON payload on STDIN; PreToolUse/PermissionRequest BLOCK until exit; plain `exit 0` with no output DEFERS (safe). Safe hook pattern (existence-guarded, always exit 0): `/bin/sh -c '[ -x "$HOME/.x/bin/y" ] && "$HOME/.x/bin/y" --source claude; exit 0'`.
- Codex `notify` slot is ALREADY OCCUPIED here → installer must detect & SKIP, never clobber.
- gemini/qwen/kimi/opencode/crush/goose = process-scan only.

---

## Phase A — Foreign-agent ingest + hook installer

**A1. `live-spool.ts` additive extensions**
- `LiveRunEntry` gains `source?: string`, `kind?: "external"` (absent = native).
- Approvals dir `~/.quorate/live/approvals/`: request `<id>.json {id,runId,source,toolName,summary<=300,cwd,createdAt,expiresAt}`; decision `<id>.decision.json {id,decision:"allow"|"deny",reason?,decidedAt}`. `id` charset-gated like runId. Export `listPendingApprovals, writeApprovalRequest, writeApprovalDecision, readApprovalDecision, reapExpiredApprovals`. All 0600, atomic.
- Discovery file `~/.quorate/live/monitor.json {url,token,pid,heartbeatAt}` (0600) + read/write helpers + `isMonitorAttached(dir?, maxAgeMs=6000)` = pid alive AND heartbeat fresh.

**A2. `quorate hook-report --source <s> --event <E>`** (new `packages/cli/src/hook-report.ts` + commander wiring). Reads hook JSON from STDIN; malformed → exit 0 silent; never crash; never emit stray stdout. `session_id` → runId `claude-<sid>`. Structure as pure parse/dispatch functions + thin CLI shell. Event mapping:
- `SessionStart`: create external run (source claude, kind external, mode agent, subject = last prompt or "Claude Code session", cwd, pid) + `council/started` (planned []) + synthetic lane `{claude, session}` `provider/started`.
- `UserPromptSubmit`: subject (<=200) + chunk `» <first line>`.
- `PreToolUse`: chunk `tool: <name>` — NON-BLOCKING, exit 0 fast.
- `PostToolUse`: chunk `done: <name>`.
- `SubagentStart`: `provider/started` lane `{claude, "task-<id|type|n>"}`; track id→role via a small per-run sidecar json (hooks are separate processes).
- `SubagentStop`: `provider/done` that lane (status ok, findings []).
- `Notification`: chunk with the notification text.
- `Stop`: chunk `turn ended`.
- `SessionEnd`: seal meta status done.
- `PermissionRequest` (THE BLOCKING ONE): if `!isMonitorAttached()` → exit 0 immediately (defer, zero overhead). Else `writeApprovalRequest` (toolName, summary from tool_input truncated, expiresAt now+55s) + ndjson `{type:"approval/pending",councilRunId,id,toolName,summary,at}`; poll decision every 250ms, re-check `isMonitorAttached` each second (monitor died → cleanup request, exit 0). On decision: delete both files, ndjson `{type:"approval/resolved",id,decision}`, and print the Claude hook decision JSON `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` (or `"deny"` + `"message":"Denied from Quorate monitor"`). Validate before printing; anything uncertain → exit 0 no output. Hard-cap wall clock at 55s then defer.
- External runs: `argv` undefined (no rerun for foreign runs).
- IMPORTANT: make the monitor-state reader IGNORE unknown ndjson event types (approval/pending etc.) without crashing — add that guard.

**A3. `quorate monitor setup [--remove] [--dry-run] [--yes]`** (new `packages/cli/src/monitor-setup.ts` + wiring under the monitor command). Detect installed CLIs via `findExecutable` (claude, codex, gemini, qwen, kimi, opencode, crush, goose); print a capability table. Claude: edit `~/.claude/settings.json` (parse → modify → atomic write, PRESERVE everything else, create file/dirs if missing); for events `[SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SubagentStart, SubagentStop, Notification, Stop, SessionEnd, PermissionRequest]` APPEND (never replace) `{matcher:"*",hooks:[{type:"command",command:CMD}]}` where `CMD = /bin/sh -c 'Q="<abs quorate>"; [ -x "$Q" ] || Q="$(command -v quorate||true)"; [ -n "$Q" ] && exec "$Q" hook-report --source claude --event <Event>; exit 0'`. Idempotent (marker `hook-report --source claude` per event). `--remove` strips only marked entries. `--dry-run` prints the plan. Non-TTY or `--yes` → no prompt. Back up any modified file as `<name>.quorate-backup-<iso>.json`. Codex: if notify empty set a guarded shim to `quorate hook-report --source codex --event notify`; if occupied SKIP naming the existing program.

**A4. Process scanner** (new `packages/cli/src/agent-scan.ts`): `scanExternalAgents()` parses `ps -axo pid=,ppid=,etime=,command=` (spawnSync, shell:false, 3s), matches known CLIs, excludes self/quorate/dupes, returns `[{pid,name,etime,command<=200}]`. Windows → `[]`. Pure + injectable exec for tests.

**A5. Tests + docs**: hook-report event mapping (pure fns, synthetic stdin), approval roundtrip + stdout JSON shape, defer path, installer merge/idempotent/`--remove` on FIXTURE settings.json in temp dirs, scanner parsing fixtures. Add `docs/MONITOR-HOOKS.md` capability matrix with honest limits.

**Gate:** npm build/typecheck/test green, no regression.

---

## Phase B — Serve mode, approvals + foreign + jump across surfaces

**B1. `quorate monitor --serve`**: headless `createMonitorServer`, no browser; print ONE line `{"url","token","pid"}` then serve until SIGINT/SIGTERM. Both `--web` and `--serve` WRITE `monitor.json` on listen + heartbeat every 2s (timer.unref) + remove on close. (This is what makes `isMonitorAttached()` true so PermissionRequest hooks block for an answer.)

**B2. SSE payload additions** (`monitor-server.ts`): top-level `approvals` (`listPendingApprovals` + `reapExpiredApprovals` each tick), `external` (`scanExternalAgents`, throttled to every 5 ticks), `stats {today:{runs,bySource}}` from the registry (today by startedAt, source ?? "quorate"). `runToPayload` gains `source, kind`. Confirm poll ignores unknown ndjson event types.

**B3. `/control` additions**: `{action:"approve"|"deny",id}` → validate id charset, `writeApprovalDecision`, 200/409; `{action:"jump",runId}` → terminal-jump. Same token + body rules as abort/rerun.

**B4. Jump-to-terminal** (new `packages/cli/src/terminal-jump.ts`, macOS only; else `{ok:false,message}`): resolve run pid's tty (`ps -o tty= -p`, walk ppid ≤5 hops to a real ttys###); tmux first (`tmux list-panes -a -F "#{pane_tty} ..."` match → `tmux switch-client -t`); iTerm2 via osascript (match session tty → select tab/window + activate); Terminal.app via osascript; fallback honest `{ok:false}`. All osascript via spawnSync argv (shell:false), 4s timeouts. Export pure script-string builders for tests; mock execution.

**B5. TUI** (`monitor.tsx`): pending approvals as highlighted cards at TOP; keys `y`=approve / `n`=deny (write decision file); foreign runs show dim `external · <source>` badge; bottom strip lists detected external procs (scan every ~10 polls); `j` = jump selected run.

**B6. Web page** (`monitor-page.ts`): approvals section with Approve/Deny buttons (POST /control), external badge on run cards, detected-procs strip, Jump button per run. Keep textContent-only.

**B7. Tests**: control approve/deny/jump validation paths; SSE payload has approvals/external/stats (scanner mocked); discovery-file lifecycle (written on listen, heartbeat advances, gone on close); TUI approval state pure parts; jump script-builders. **Gate green.**

---

## Phase C — QuorateIsland: native Swift menu-bar + notch app

A THIN native renderer over the Node server — all logic stays in the CLI; the app NEVER writes the spool (read-only via the server API). SwiftPM executable, macOS 14+, Swift 6 (`@MainActor` on UI classes).

Layout `native/QuorateIsland/`:
- `Package.swift` — swift-tools ≥5.10, executable `QuorateIsland`, platforms `[.macOS(.v14)]`.
- `Sources/QuorateIsland/`:
  - `Main.swift` — NSApplication main, AppDelegate, `setActivationPolicy(.accessory)`.
  - `Models.swift` — Codable mirrors of the SSE payload with EXACT field names: `Snapshot{runs, approvals?, external?, stats?}`, `Run{runId,repo,mode,subject,status,startedAt,verdict?,degraded?,source?,kind?,parentLane?,lanes:[Lane],children:[Run]?}`, `Lane{laneKey,providerId,role,gate:Bool?,state,note?,status?,preview?,error?,tail:[String]?}`, `Approval{id,runId,source?,toolName,summary,createdAt,expiresAt}`, `ExternalProc{pid,name,etime?,command?}`, `Stats{today:TodayStats?}`. Lenient decode — one bad run must not kill the frame.
  - `ServerConnection.swift` — read `~/.quorate/live/monitor.json` (url/token/pid/heartbeatAt); if stale/absent, spawn `Process` `quorate monitor --serve` (resolve binary in `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, then PATH), parse the single stdout JSON line for url+token, keep the child referenced, terminate on quit. SSE via `URLSession.bytes(for:)` reading lines starting `data: ` → `JSONDecoder` → Snapshot; auto-reconnect with backoff (1s→8s cap). `@MainActor ObservableObject` publishing snapshot + connection state.
  - `ControlClient.swift` — POST `/control?token=…` JSON `{action,…}` for approve/deny/jump/abort/rerun.
  - `StatusItemController.swift` — NSStatusItem, variable title e.g. `◆3 ▸1 ⏳2` (runs, running, pending); ⏳ orange when approvals pending; click toggles the panel.
  - `IslandPanel.swift` — non-activating borderless NSPanel (`.nonactivatingPanel|.borderless`, level `.statusBar`, collectionBehavior `[.canJoinAllSpaces, .fullScreenAuxiliary]`). COMPACT PILL hugging the notch when `NSScreen.main.safeAreaInsets.top > 0` (center at screen top, ~menubar height), else anchor under the status item; EXPANDED card ~380×520 hosting `RunListView`. Never steals focus (`becomesKeyOnlyIfNeeded`).
  - `RunListView.swift` — SwiftUI: approvals FIRST as amber cards (tool, summary, source repo, countdown to expiresAt, Approve/Deny), then runs grouped native-council vs external (badge `external · <source>`), lanes with state dots, subagent children indented, per-run Jump / Abort (running) / Rerun (settled), verdict chips colored pass/warn/fail, footer with today's stats + connection dot.
  - `SoundPlayer.swift` — NSSound system sounds: approval pending → Glass, run done pass → Purr, fail → Basso. Rate-limited (≥2s), mute toggle.
  - `Settings.swift` — UserDefaults: soundsEnabled, notchPillEnabled, launchAtLogin (`SMAppService.mainApp` register/unregister, `try?` — can fail unsigned).
- `scripts/bundle.sh` — `set -euo pipefail`; `swift build -c release --arch arm64`; assemble `dist/QuorateIsland.app` (Contents/MacOS/QuorateIsland, Info.plist `LSUIElement=true`, bundle id `app.quorate.island`, `CFBundleShortVersionString=1.4.0`, `NSHighResolutionCapable`), PkgInfo `APPL????`, `codesign --force --deep -s -` (ad-hoc). Print the .app path.
- `README.md` — build, run, how it finds/spawns the server, honest limits.

Rules: no force-unwraps on network/JSON paths; every UI mutation on MainActor; keep running + show "disconnected" if the server dies (respawn once/min). Add `native/QuorateIsland/.build` and `native/QuorateIsland/dist` to root `.gitignore`.

**Gate:** `cd native/QuorateIsland && swift build` compiles clean; `bash scripts/bundle.sh` produces `dist/QuorateIsland.app`; npm gate still green. Do NOT launch the GUI (headless context).

---

## Phase D — install-companion, docs, CHANGELOG, version 1.4.0

**D1. `quorate monitor install-companion [--from-local] [--release <tag>] [--dir <path>] [--force]`** (new `packages/cli/src/companion-install.ts` + wiring):
- Default (GitHub Release): GET `api.github.com/repos/UmutKorkmaz/quorate/releases/latest` (or `--release`), find asset `QuorateIsland-<arch>.zip` + `.sha256`, download to temp (fetch `AbortSignal.timeout(60000)`), verify sha256 (node:crypto), unzip via spawnSync `["unzip","-q"]` shell:false, move `QuorateIsland.app` to `~/Applications` (create dir; refuse overwrite unless `--force`), print launch instructions + first-run Gatekeeper note (right-click→Open for ad-hoc signed). Asset missing → honest message pointing at `--from-local`.
- `--from-local`: detect `native/QuorateIsland` exists (else honest error), run `bash native/QuorateIsland/scripts/bundle.sh`, install `dist/QuorateIsland.app` the same way. **This is the working path today** (no signed release assets yet).
- macOS only (clear message elsewhere). Tests: asset selection, checksum reject-mismatch, refuse-overwrite, non-mac message (fetch/exec injected, networkless).

**D2. Release plumbing:** add ONLY a commented placeholder in `scripts/release.sh` noting the future QuorateIsland asset step. Do NOT change verified behavior — the release gate must still pass untouched.

**D3. Docs:** README "Quorate Island" section (setup → hooks table, `--serve`, the app, `install-companion --from-local`, screenshot placeholder); finalize `docs/MONITOR-HOOKS.md`; `CHANGELOG.md` `[1.4.0] - <date>` Added: hook installer + foreign-agent ingest (approve/deny for Claude Code), process scanner, `--serve` + discovery, approvals/external/stats in all surfaces, jump-to-terminal, QuorateIsland native app, install-companion.

**D4. Version bump to 1.4.0** — all 7 workspace `package.json` versions AND internal pins: `@quorate/core` in cli **devDependencies**(!) / github-action / github-app, AND `@quorate/github-action` pin in github-app. Then `npm install --package-lock-only` (exit 0). `grep -rn '1\.3\.0'` over the manifests must be empty afterward. (Native Info.plist already 1.4.0 from Phase C.)

**D5. Full gate + seal:** `npm run build && npm run typecheck && npx vitest run && (cd native/QuorateIsland && swift build) && node packages/cli/dist/index.js --version` → `1.4.0`.

---

## Ship (after all phases green)
1. Push branch, open PR to `main`. Quorate's own review Action runs on the PR (`fail-on: high`) — fix any critical/high it flags before merge.
2. Regenerate command docs if the release-verify script complains (`npm run generate:command-docs`).
3. Repin all `UmutKorkmaz/quorate@<sha>` Action references (docs/website + `packages/cli/src/setup-command.ts`) to the merged v1.4.0 bundle commit; rebuild the action bundle.
4. `bash scripts/release.sh` (verify), then `CONFIRM_RELEASE=v1.4.0 ALLOW_NO_PROVENANCE=1 bash scripts/release.sh --execute 1.4.0` (tag → GitHub Release → npm; needs `npm login`, and an npm OTP at publish time).
5. Build + attach `QuorateIsland-arm64.zip` + `.sha256` to the GitHub Release so `install-companion` (non-local path) works.

## Real-machine smoke before trusting it
- `quorate monitor setup` (or `--dry-run` first) to install the Claude Code hooks; `quorate monitor --serve` or the app running; then run a `claude` session and confirm it appears as an external run with live lanes, subagents nest, and a tool-permission prompt shows an approve/deny card you can answer. `quorate monitor setup --remove` cleanly reverts.
