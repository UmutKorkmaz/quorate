# QuorateIsland

A native macOS menu-bar / notch app that renders Quorate's live monitor feed —
every AI-agent run on this machine, including foreign CLIs (Claude Code, …)
and their subagents, with live approve/deny for permission prompts.

QuorateIsland is **a thin renderer**. All logic (spool, controls, hooks) lives
in the Node CLI; this app is read-only over the monitor server's SSE endpoint
and never writes the spool directly.

## Build

Requirements: Swift 5.10+ / Xcode 16+, macOS 14+.

```sh
swift build                      # debug build (smoke)
bash scripts/bundle.sh           # release .app at dist/QuorateIsland.app
```

`bundle.sh` ad-hoc codesigns the app. On first launch macOS Gatekeeper will
prompt: **right-click → Open** to allow it. Distribution beyond your own
machine needs Apple Developer ID + notarization (out of scope here).

## How it finds the server

On launch the app reads `~/.quorate/live/monitor.json` for the monitor's
loopback URL + per-session token. If that file is absent or stale (no live
heartbeat), the app spawns `quorate monitor --serve`, parses the one-line
JSON it prints on stdout, and keeps the child process referenced — terminating
it on quit. The binary is resolved in this order:

1. `~/.local/bin/quorate`
2. `/usr/local/bin/quorate`
3. `/opt/homebrew/bin/quorate`
4. `$PATH` lookup

If the server dies, the app shows "disconnected" and respawns it at most once
per minute.

## Approve/deny

Approve/deny cards appear only when a monitor is attached AND a foreign CLI's
`PermissionRequest` hook fires. Install the hooks with:

```sh
quorate monitor setup
```

(see `docs/MONITOR-HOOKS.md` in the repo root for the capability matrix and
honest limits — Claude Code is the only rich surface today).

## Honest limits

- **macOS only.** 14+ (Sonoma) for `NSStatusItem` + SwiftUI + SMAppService.
- **Ad-hoc signed** in the local build. Gatekeeper will prompt on first run.
- **Read-only.** No spool writes; all control actions POST to `/control` and
  the next SSE frame reflects the result.
- **No notch pill layout in the initial release.** The panel anchors under the
  status item; a compact notch pill is scaffolded for a follow-up.
