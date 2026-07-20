# Monitor hooks — foreign AI CLIs

`quorate monitor` shows every AI-agent run on this machine, including **foreign
CLIs you launched yourself** (Claude Code today; others observed by process
scan). Foreign observation is opt-in via a one-shot hook installer:

```
quorate monitor setup            # install hooks for detected CLIs
quorate monitor setup --dry-run  # preview the plan, write nothing
quorate monitor setup --remove   # strip only Quorate-tagged entries
quorate monitor setup --yes      # skip the confirmation prompt
```

## Capability matrix (honest limits)

| CLI        | hook support  | lanes | subagents | approve/deny | notes |
|------------|---------------|:-----:|:---------:|:------------:|-------|
| claude     | **full**      | ✅    | ✅        | ✅           | The only CLI with a rich hook surface today. |
| codex      | shim only     | —     | —         | —            | A guarded notify shim is installed **only** when Codex's `notify` slot is empty. If it's occupied (as on this machine), Quorate skips it and never clobbers the existing program. |
| gemini     | scan-only     | —     | —         | —            | No hook surface; appears in the monitor's detected-processes strip when running. |
| qwen       | scan-only     | —     | —         | —            | Process scan only. |
| kimi       | scan-only     | —     | —         | —            | Process scan only. |
| opencode   | scan-only     | —     | —         | —            | Process scan only. |
| crush      | scan-only     | —     | —         | —            | Process scan only. |
| goose      | scan-only     | —     | —         | —            | Process scan only. |

## What gets installed

For Claude Code, `quorate monitor setup` appends one Quorate-tagged hook to
each of these events in `~/.claude/settings.json`:

- `SessionStart` — creates an external run; opens a `session` lane.
- `UserPromptSubmit` — updates the subject; emits the first prompt line.
- `PreToolUse` — emits a `tool: <name>` chunk (**non-blocking**; exits fast).
- `PostToolUse` — emits a `done: <name>` chunk.
- `SubagentStart` — opens a `task-<id>` lane.
- `SubagentStop` — closes that lane.
- `Notification` — emits the notification text.
- `Stop` — emits `turn ended`.
- `SessionEnd` — seals the run as done.
- `PermissionRequest` — **the blocking one.** Writes an approval card that
  `quorate monitor` surfaces; the agent waits until you approve or deny.

Every hook command is existence-guarded and always exits 0, so Quorate being
uninstalled or moved never breaks the foreign CLI:

```
/bin/sh -c 'Q="/abs/quorate"; [ -x "$Q" ] || Q="$(command -v quorate||true)";
  [ -n "$Q" ] && exec "$Q" hook-report --source claude --event <Event>; exit 0'
```

## Approve/deny contract

A `PermissionRequest` hook only blocks when a monitor is actually attached. If
nobody is watching (`~/.quorate/live/monitor.json` stale or absent), the hook
exits 0 immediately and the agent proceeds with its own default — zero
overhead. Run `quorate monitor --web`, `--serve`, or the monitor app to
make approve/deny cards live. If you don't answer within 55 seconds, the hook
defers (exit 0) so the agent is never wedged.

## Safety

- `setup` parses → modifies → atomically writes `~/.claude/settings.json`,
  preserving every other key. A backup is written to
  `settings.json.quorate-backup-<iso>.json` before any change.
- Entries are **append-only** and tagged with the marker
  `hook-report --source claude`. `setup --remove` strips only tagged entries;
  everything else (Vibe Island, Orca, your own) is left untouched.
- Codex's `notify` slot is detected and respected — never overwritten.
