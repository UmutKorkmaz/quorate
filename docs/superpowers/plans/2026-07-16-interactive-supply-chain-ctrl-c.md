# Interactive SupplyChainGate and Safe Ctrl+C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native SupplyChainGate scans to both interactive shells and make Ctrl+C clear first, then exit only on a second consecutive press.

**Architecture:** Refactor the existing SupplyChainGate command into a reusable structured scan service with thin headless and interactive adapters. Add a terminal-only interrupt state helper; each shell clears its own presentation layer without dispatching the session-reset action.

**Tech Stack:** TypeScript, Commander, Node readline, React 19, Ink 7, Vitest 4, ink-testing-library.

## Global Constraints

- Preserve the existing `quorate supply-chain scan` flags, report files, output, and headless gate exit codes.
- `/supply-chain` and `/supply-chain scan` must work in both interactive shells.
- First Ctrl+C clears visible UI and preserves all session data; second consecutive Ctrl+C exits.
- Any non-Ctrl+C input disarms exit.
- `/clear` and `/reset` continue to discard the loaded diff and report.
- Interactive `--gate` reports PASS or FAIL but never terminates the shell.
- No new runtime dependencies.

---

### Task 1: Reusable SupplyChainGate service and slash-argument parser

**Files:**
- Modify: `packages/cli/src/supply-chain-command.ts`
- Test: `packages/cli/test/supply-chain-command.test.ts`

**Interfaces:**
- Consumes: existing `SupplyChainScanOptions`, `SupplyChainScanContext`, `readSupplyChainDiff`, core `buildSupplyChainReport`, and policy helpers.
- Produces: `SupplyChainScanResult`, `parseSupplyChainShellArgs(input: string): SupplyChainScanOptions`, and `scanSupplyChain(options, context): SupplyChainScanResult | undefined`.

- [ ] **Step 1: Write failing parser and service tests**

Add tests that require both optional `scan` syntax and quoted values:

```ts
expect(parseSupplyChainShellArgs('scan --base main --head HEAD --gate --fail-on high')).toEqual({
  base: "main",
  head: "HEAD",
  gate: true,
  failOn: "high"
});
expect(parseSupplyChainShellArgs('--diff "fixtures/dependency change.diff" --json')).toEqual({
  diff: "fixtures/dependency change.diff",
  json: true
});
expect(() => parseSupplyChainShellArgs("audit")).toThrow(/only supports scan/i);
expect(() => parseSupplyChainShellArgs("scan --wat")).toThrow(/unknown option/i);
```

Create a temporary git repository with a changed `package.json`, invoke `scanSupplyChain`, and assert that it returns a report, writes `.quorate/supply-chain/latest.json`, and reports gate state without mutating `process.exitCode`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run packages/cli/test/supply-chain-command.test.ts
```

Expected: FAIL because `parseSupplyChainShellArgs`, `scanSupplyChain`, and `SupplyChainScanResult` do not exist.

- [ ] **Step 3: Implement the minimal parser and service**

Add the structured result:

```ts
export interface SupplyChainScanResult {
  report: CouncilReport;
  latestReportPath: string;
  gateFailed: boolean;
}
```

Implement a quote-aware token splitter for single and double quotes, then parse only these flags: `--diff`, `--base`, `--head`, `--pr`, `--subject`, `--json`, `--write-json`, `--write-md`, `--gate`, and `--fail-on`. Permit no positional token except an optional leading `scan`.

Move diff reading, report construction, canonical and optional file writes, and policy evaluation into:

```ts
export function scanSupplyChain(
  options: SupplyChainScanOptions,
  context: SupplyChainScanContext
): SupplyChainScanResult | undefined
```

Return `undefined` for an empty diff without writing to stdout/stderr or changing `process.exitCode`. Make `runSupplyChainScan` call this service, retain its existing no-change diagnostic, print Markdown/JSON, and set `process.exitCode` only when the structured result says the gate failed.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run packages/cli/test/supply-chain-command.test.ts
```

Expected: PASS with the pre-existing headless behavior tests and the new parser/service tests green.

- [ ] **Step 5: Commit the reusable service**

```bash
git add packages/cli/src/supply-chain-command.ts packages/cli/test/supply-chain-command.test.ts
git commit -m "refactor: share supply chain scan service"
```

### Task 2: Native SupplyChainGate commands in both interactive shells

**Files:**
- Modify: `packages/cli/src/tui/commands.ts`
- Modify: `packages/cli/src/tui/views.tsx`
- Modify: `packages/cli/src/session.ts`
- Modify: `packages/cli/src/shell.ts`
- Test: `packages/cli/test/tui-commands.test.ts`
- Test: `packages/cli/test/tui-app.test.tsx`
- Test: `packages/cli/test/shell.test.ts`

**Interfaces:**
- Consumes: `parseSupplyChainShellArgs` and `scanSupplyChain` from Task 1.
- Produces: `/supply-chain [scan] ...` and `/supplychain [scan] ...` in the Ink command registry and classic parser.

- [ ] **Step 1: Write failing interactive-command tests**

Add `supply-chain` to the canonical TUI registry expectation and assert its alias resolves. In a temporary git repo with a dependency change, run:

```ts
await parseAndRun(ctx, "/supply-chain scan --gate --fail-on high");
expect(getState().lastReport).toBeDefined();
expect(cells.some((cell) => cell.kind === "findings")).toBe(true);
expect(textCells).toContain("SupplyChainGate policy:");
```

Add classic parser/handler assertions:

```ts
expect(parseShellCommand("/supply-chain scan --base main --json")).toEqual({
  kind: "supply-chain",
  args: "scan --base main --json"
});
await handleShellLine(state, "/supply-chain scan --diff dependency.diff", io);
expect(state.lastReport).toBeDefined();
expect(output.join("\n")).toContain("Quorate Report");
```

Add a no-change assertion proving both command handlers return a message and keep the shell active.

- [ ] **Step 2: Run focused command tests and verify RED**

Run:

```bash
npx vitest run packages/cli/test/tui-commands.test.ts packages/cli/test/tui-app.test.tsx packages/cli/test/shell.test.ts
```

Expected: FAIL because the native slash command is not registered or parsed.

- [ ] **Step 3: Implement the Ink command adapter**

Register:

```ts
{
  name: "supply-chain",
  aliases: ["supplychain"],
  summary: "Run deterministic dependency and release-pipeline checks",
  argHint: "[scan] [--base <ref> | --diff <path> | --pr <n>] [--gate]",
  run(ctx, args) {
    const options = parseSupplyChainShellArgs(args);
    const result = scanSupplyChain(options, {
      cwd: ctx.getState().cwd,
      config: ctx.getState().config
    });
    if (!result) {
      text(ctx, "No changes to scan. Pass --diff, --base/--head, or --pr.");
      return;
    }
    ctx.dispatch({ type: "setLastRequest", request: undefined });
    ctx.dispatch({ type: "setLastReport", report: result.report });
    if (options.json) text(ctx, JSON.stringify(result.report, null, 2));
    else ctx.emit({ id: cellId(), kind: "findings", report: result.report });
    if (options.gate) text(ctx, `SupplyChainGate policy: ${result.gateFailed ? "FAIL" : "PASS"}.`);
  }
}
```

Add the command to the TUI help's Review group.

- [ ] **Step 4: Implement the classic-shell adapter**

Add `{ kind: "supply-chain"; args: string }` to `ParsedShellCommand`, parse both names, and handle the command through the shared service. Set `state.lastReport`, clear `state.lastRequest`, render JSON or Markdown, append gate status when requested, and keep `exit: false` for all scan outcomes.

Add the new command to shared shell help:

```text
  /supply-chain [scan] Run deterministic dependency and release-pipeline checks
```

- [ ] **Step 5: Run focused command tests and verify GREEN**

Run:

```bash
npx vitest run packages/cli/test/tui-commands.test.ts packages/cli/test/tui-app.test.tsx packages/cli/test/shell.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit interactive SupplyChainGate support**

```bash
git add packages/cli/src/tui/commands.ts packages/cli/src/tui/views.tsx packages/cli/src/session.ts packages/cli/src/shell.ts packages/cli/test/tui-commands.test.ts packages/cli/test/tui-app.test.tsx packages/cli/test/shell.test.ts
git commit -m "feat: add interactive supply chain scans"
```

### Task 3: Two-stage Ctrl+C behavior

**Files:**
- Create: `packages/cli/src/interactive-interrupt.ts`
- Modify: `packages/cli/src/tui/app.tsx`
- Modify: `packages/cli/src/tui/context.ts`
- Modify: `packages/cli/src/tui/views.tsx`
- Modify: `packages/cli/src/shell.ts`
- Create: `packages/cli/test/interactive-interrupt.test.ts`
- Modify: `packages/cli/test/tui-app.test.tsx`

**Interfaces:**
- Produces: `nextInterruptAction(armed: boolean): "clear" | "exit"`.
- Consumes: Ink `useInput`/`useStdout`, readline `SIGINT`, and existing terminal-clear escape sequence.

- [ ] **Step 1: Write failing state and TUI interaction tests**

Create the pure state assertions:

```ts
expect(nextInterruptAction(false)).toBe("clear");
expect(nextInterruptAction(true)).toBe("exit");
```

In the Ink test, emit `/help`, verify help is visible, send `\u0003`, then type `/status` and Enter. Assert the app is still live, stale help is absent from the current frame, and status output appears. Send a normal key between two Ctrl+C bytes and verify the next Ctrl+C clears rather than exiting.

- [ ] **Step 2: Run interrupt tests and verify RED**

Run:

```bash
npx vitest run packages/cli/test/interactive-interrupt.test.ts packages/cli/test/tui-app.test.tsx
```

Expected: FAIL because first idle Ctrl+C exits and the shared state helper is missing.

- [ ] **Step 3: Implement the shared state helper and Ink behavior**

Implement:

```ts
export type InterruptAction = "clear" | "exit";

export function nextInterruptAction(armed: boolean): InterruptAction {
  return armed ? "exit" : "clear";
}
```

In `App`, keep an `exitArmedRef`. Disarm it on every non-Ctrl+C input. On the first Ctrl+C, clear `cells`, `buffer`, palette selection, and history cursor, write the terminal-clear sequence, and arm exit. Do not dispatch `{ type: "clear" }`. On the second consecutive Ctrl+C, call Ink's `exit()`.

- [ ] **Step 4: Implement classic readline SIGINT behavior**

Attach a `SIGINT` listener to the readline interface. On first signal, clear the current input line and terminal, redraw the shell banner, write `Press Ctrl+C again to exit.`, and arm exit. On second consecutive signal, close readline. Attach a temporary stdin `data` listener that disarms exit for any byte other than `\u0003`, and remove all listeners in `finally`.

- [ ] **Step 5: Update terminal hints**

Change the idle footer to `ctrl+c clear · twice exit` and the Help view key line to `clear screen / twice exit`. Keep Esc documented as the interrupt key.

- [ ] **Step 6: Run interrupt tests and verify GREEN**

Run:

```bash
npx vitest run packages/cli/test/interactive-interrupt.test.ts packages/cli/test/tui-app.test.tsx packages/cli/test/shell.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit safe Ctrl+C behavior**

```bash
git add packages/cli/src/interactive-interrupt.ts packages/cli/src/tui/app.tsx packages/cli/src/tui/context.ts packages/cli/src/tui/views.tsx packages/cli/src/shell.ts packages/cli/test/interactive-interrupt.test.ts packages/cli/test/tui-app.test.tsx
git commit -m "fix: clear interactive cli before ctrl-c exit"
```

### Task 4: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify: generated command documentation under the website package, if the generator changes it.
- Modify: `docs/PACK-VALIDATION.md` if the published-package smoke table requires the interactive command.

**Interfaces:**
- Consumes: completed command and Ctrl+C behavior.
- Produces: discoverable usage examples and release-grade verification evidence.

- [ ] **Step 1: Update usage documentation**

Document this interactive flow without putting Web3/Solana examples first:

```text
quorate
/supply-chain scan --base main --gate
# Ctrl+C clears the screen; press Ctrl+C again immediately to exit.
```

- [ ] **Step 2: Regenerate command docs and inspect drift**

Run:

```bash
npm run generate:command-docs
git diff --check
```

Expected: generated command references include the unchanged headless command surface and no formatting errors.

- [ ] **Step 3: Run focused and full automated verification**

Run:

```bash
npm run test --workspace quorate
npm run typecheck
npm run build
npm test
```

Expected: every command exits 0 with zero failed tests and zero TypeScript errors.

- [ ] **Step 4: Run built interactive PTY smoke tests**

From a temporary git repo containing a dependency change, launch the built TUI and classic shell in a pseudo-terminal. Verify `/supply-chain scan --gate` prints a deterministic report, one Ctrl+C returns to a usable prompt, `/last` still shows the report, and a second consecutive Ctrl+C exits.

- [ ] **Step 5: Inspect the final diff and commit docs**

```bash
git diff --check
git status --short
git diff --stat main...HEAD
git add README.md docs/PACK-VALIDATION.md packages/website
git commit -m "docs: explain interactive supply chain scans"
```

Only stage files that actually changed.
