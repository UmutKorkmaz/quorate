import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerArchitectureCommands } from '../src/architecture/command.js';
import { registerRulesCommands } from '../src/rules-audit/command.js';
const roots: string[] = [];
const root = () => { const dir = mkdtempSync(join(tmpdir(), 'quorate-audit-')); roots.push(dir); return dir; };
afterEach(() => { roots.forEach(path => rmSync(path, { recursive: true, force: true })); roots.length = 0; vi.restoreAllMocks(); process.exitCode = undefined; });
const sha = '1'.repeat(40);
async function invoke(args: string[]) { const program = new Command().option('--cwd <path>'); registerArchitectureCommands(program); registerRulesCommands(program); const log = vi.spyOn(console, 'log').mockImplementation(() => { }); await program.parseAsync(args, { from: 'user' }); return { report: JSON.parse(String(log.mock.calls.at(-1)?.[0])), exitCode: process.exitCode }; }
describe('read-only audit command journeys', () => {
    it('honors global cwd and recommends checks without mutating imported bytes', async () => {
        const cwd = root(), graph = JSON.stringify({ version: 1, revision: sha, scope: ['src'], complete: true, modules: [{ source: 'src/a.ts', dependencies: [] }] });
        writeFileSync(join(cwd, 'graph.json'), graph);
        const result = await invoke(['--cwd', cwd, 'impact', '--input', 'graph.json', '--subject', sha, '--changed', 'src/a.ts', '--json']);
        expect(result.exitCode).toBe(0);
        expect(result.report.impact.affected).toEqual(['src/a.ts']);
        expect(readFileSync(join(cwd, 'graph.json'), 'utf8')).toBe(graph);
    });
    it('returns deterministic invalid JSON for stale revisions and escaping imports', async () => {
        const cwd = root();
        writeFileSync(join(cwd, 'graph.json'), JSON.stringify({ version: 1, revision: sha, scope: ['src'], complete: true, modules: [] }));
        expect((await invoke(['--cwd', cwd, 'arch', 'check', '--input', 'graph.json', '--subject', '2'.repeat(40), '--json'])).exitCode).toBe(2);
        expect((await invoke(['--cwd', cwd, 'arch', 'check', '--input', '../secret.json', '--subject', sha, '--json'])).report.error.code).toBe('invalid-input');
    });
    it('rejects external symlinks', async () => {
        const cwd = root(), external = root();
        writeFileSync(join(external, 'graph.json'), '{}');
        symlinkSync(join(external, 'graph.json'), join(cwd, 'graph.json'));
        expect((await invoke(['--cwd', cwd, 'arch', 'check', '--input', 'graph.json', '--subject', sha, '--json'])).exitCode).toBe(2);
    });
    it('returns incomplete exit 2 and full-suite recommendations when an imported policy amplifies diagnostics', async () => {
        const cwd = root();
        const modules = Array.from({ length: 101 }, (_, index) => ({ source: `src/${index}.ts`, dependencies: index ? [] : Array.from({ length: 100 }, (_, target) => ({ resolved: `src/${target + 1}.ts` })) }));
        const graph = JSON.stringify({ version: 1, revision: sha, scope: ['src'], complete: true, modules });
        writeFileSync(join(cwd, 'graph.json'), graph);
        writeFileSync(join(cwd, 'policy.json'), JSON.stringify({ version: 1, boundaries: Array.from({ length: 100 }, (_, index) => ({ id: `rule-${index}`, from: '.', to: '.' })), fullSuite: ['all-tests'] }));
        const result = await invoke(['--cwd', cwd, 'arch', 'check', '--input', 'graph.json', '--subject', sha, '--policy', 'policy.json', '--json']);
        expect(result.exitCode).toBe(2);
        expect(result.report.complete).toBe(false);
        expect(result.report.unknown).toContainEqual({ code: 'resource-budget-exceeded', source: '.' });
        expect(result.report.impact.fullSuiteFallback).toBe(true);
        expect(result.report.impact.recommendedChecks).toEqual(['all-tests']);
        expect(readFileSync(join(cwd, 'graph.json'), 'utf8')).toBe(graph);
    });
    it('audits literal permission conflicts and preserves every original byte', async () => {
        const cwd = root();
        mkdirSync(join(cwd, '.cursor'));
        const bytes = '{"permissions":{"allow":["Read(.env)"],"deny":["Read(.env)"]}}\n';
        writeFileSync(join(cwd, '.cursor/cli.json'), bytes);
        writeFileSync(join(cwd, 'rules.json'), JSON.stringify({ version: 1, tools: { cursor: '2026.10.01' }, files: [{ path: '.cursor/cli.json', tool: 'cursor', kind: 'settings', scope: 'project' }] }));
        const result = await invoke(['--cwd', cwd, 'rules', 'doctor', '--manifest', 'rules.json', '--json']);
        expect(result.exitCode).toBe(1);
        expect(result.report.findings[0].code).toBe('permission-conflict');
        expect(readFileSync(join(cwd, '.cursor/cli.json'), 'utf8')).toBe(bytes);
    });
    it('reports missing selected rule files and malformed manifests exit 2', async () => {
        const cwd = root();
        writeFileSync(join(cwd, 'rules.json'), JSON.stringify({ version: 1, tools: { cursor: '2026.10.01' }, files: [{ path: 'AGENTS.md', tool: 'cursor', kind: 'instructions', scope: 'project' }] }));
        const result = await invoke(['--cwd', cwd, 'rules', 'doctor', '--manifest', 'rules.json', '--json']);
        expect(result.exitCode).toBe(2);
        expect(result.report.findings[0].code).toBe('missing-file');
        writeFileSync(join(cwd, 'rules.json'), '{');
        expect((await invoke(['--cwd', cwd, 'rules', 'doctor', '--manifest', 'rules.json', '--json'])).exitCode).toBe(2);
    });
});
