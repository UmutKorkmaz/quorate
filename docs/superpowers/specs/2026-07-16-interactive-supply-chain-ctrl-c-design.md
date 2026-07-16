# Interactive SupplyChainGate and Safe Ctrl+C Design

## Goal

Make SupplyChainGate a native command in both Quorate interactive shells, and make Ctrl+C safe by requiring two consecutive presses to exit.

## Approved behavior

- `/supply-chain scan` runs the same deterministic scan as `quorate supply-chain scan`.
- The slash command accepts the headless scan's source, rendering, export, and gate options: `--diff`, `--base`, `--head`, `--pr`, `--subject`, `--json`, `--write-json`, `--write-md`, `--gate`, and `--fail-on`.
- `/supply-chain` is shorthand for `/supply-chain scan` against the working tree.
- The Ink TUI renders the report without writing through `console`, records it as the session's last report, and keeps `/last`, `/json`, `/markdown`, and Ctrl+O useful afterward.
- The classic shell prints the same Markdown or JSON representation and also records the report as its last report.
- A scan with no changes reports the condition without closing the interactive shell.
- The first Ctrl+C clears the composer and visible terminal transcript while preserving the active session, loaded diff, last report, provider selection, routing, and command history.
- A second consecutive Ctrl+C exits.
- Any ordinary key input between Ctrl+C presses disarms exit, so the next Ctrl+C clears again.
- `/clear` and `/reset` retain their existing meaning: deliberately discard the loaded diff and last report.

## Architecture

Extract the non-printing SupplyChainGate work from the headless command into a reusable `scanSupplyChain` service. It reads the selected diff, builds the deterministic report, writes the canonical/latest and optional export files, resolves gate status, and returns structured data. The current headless runner becomes a thin output/exit-code adapter; the two interactive command handlers become rendering adapters.

Add a small shared interrupt state helper that maps an unarmed Ctrl+C to `clear` and an armed Ctrl+C to `exit`. The Ink TUI owns visible-cell cleanup and terminal redraw. The classic readline shell listens for `SIGINT`, clears and redraws on the first signal, then closes on the second. This keeps terminal mechanics out of the shared session reducer, so clearing the screen cannot accidentally perform `/clear`.

## Command contract

```text
/supply-chain [scan] [--diff <path> | --base <ref> [--head <ref>] | --pr <number>]
                     [--subject <text>] [--json]
                     [--write-json <path>] [--write-md <path>]
                     [--gate] [--fail-on <severity|never>]
```

The interactive parser accepts only the `scan` operation and rejects unknown options, missing values, conflicting diff sources, invalid PR numbers, invalid thresholds, and `--head` without `--base` with actionable errors.

## Ctrl+C state machine

```text
unarmed + Ctrl+C -> clear visible UI, preserve session, armed
armed   + Ctrl+C -> exit
armed   + any other input -> unarmed, process input normally
```

The first press also clears palette selection and history cursor. It does not dispatch the session reducer's `clear` action. Esc remains the run-interrupt key documented by the TUI.

## Testing

- Unit-test slash argument parsing and the reusable scan result independently of terminal rendering.
- Verify the existing headless tests still cover report persistence and gate exit codes through the adapter.
- Test the TUI command registry, report rendering/state update, no-change handling, and help discoverability.
- Test the classic parser/handler with `/supply-chain scan` and report reuse.
- Test the interrupt state helper's clear/exit/disarm transitions.
- Use Ink interaction tests to prove the first Ctrl+C keeps the app alive, clears prior visible output, and allows subsequent input.
- Run CLI tests, full workspace tests, typecheck, build, generated-doc drift checks, and a PTY smoke test of the built CLI.

## Non-goals

- Ctrl+C does not replace Esc as the active-review interrupt key.
- `/clear` does not change meaning.
- Interactive gate failure does not terminate the shell; it reports FAIL while preserving the session. Only the headless `--gate` path sets a non-zero process exit code.
- This change does not add new SupplyChainGate rules or policy semantics.
