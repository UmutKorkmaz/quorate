import { describe, expect, it } from 'vitest';
import { auditRules, parseRulesAuditManifest } from '../src/rules-audit/index.js';
const tools = { 'claude-code': '2.1.0', cursor: '2026.10.01' };
const file = (path: string, content: string | undefined, tool: 'claude-code' | 'cursor' = 'claude-code', kind: 'settings' | 'instructions' | 'rules' = 'settings', scope: 'project' | 'local' | 'user' = 'project') => ({ path, content, tool, kind, scope });
describe('rules compatibility doctor', () => {
    it('classifies instructions as advisory and permissions as documented runtime controls', () => {
        const result = auditRules({ version: 1, tools, files: [file('CLAUDE.md', 'Run tests', 'claude-code', 'instructions'), file('.claude/settings.json', '{"permissions":{"deny":["Read(.env)"]}}')] });
        expect(result.exitCode).toBe(0);
        expect(result.rules.map(x => x.support)).toEqual(['runtime-control', 'advisory']);
        expect(result.rules.every(x => x.nativeObservation === 'unverified')).toBe(true);
    });
    it('detects merged permissions conflict across project and local sources', () => {
        const result = auditRules({ version: 1, tools, files: [file('.claude/settings.json', '{"permissions":{"deny":["Read(.env)"]}}'), file('.claude/settings.local.json', '{"permissions":{"allow":["Read(.env)"]}}', 'claude-code', 'settings', 'local')] });
        expect(result.exitCode).toBe(1);
        expect(result.findings.some(x => x.code === 'permission-conflict')).toBe(true);
        expect(result.rules[1].precedence).toContain('lists merge');
    });
    it('preserves nested Cursor scope and frontmatter inclusion modes', () => {
        const result = auditRules({ version: 1, tools, files: [file('src/AGENTS.md', 'Use TS', 'cursor', 'instructions'), file('.cursor/rules/ui.mdc', '---\nglobs: src/**/*.tsx\nalwaysApply: false\n---\nUse hooks', 'cursor', 'rules')] });
        expect(result.exitCode).toBe(0);
        expect(result.rules[0].application).toBe('matching-files');
        expect(result.rules[0].pathScope).toBe('.');
        expect(result.rules[1].pathScope).toBe('src');
        expect(result.rules[1].support).toBe('advisory');
    });
    it.each([file('.claude/settings.json', '{'), file('CLAUDE.md', undefined, 'claude-code', 'instructions'), file('.cursor/rules/a.mdc', '---\nalwaysApply: yep\n---\nHi', 'cursor', 'rules'), file('.cursor/cli.json', '{"permissions":{"allow":42}}', 'cursor')])('reports invalid/missing configuration: %j', source => {
        expect(auditRules({ version: 1, tools, files: [source] }).exitCode).toBe(2);
    });
    it('does not silently support unknown settings or missing installed versions', () => {
        expect(auditRules({ version: 1, tools: {}, files: [file('CLAUDE.md', 'Hi', 'claude-code', 'instructions')] }).exitCode).toBe(2);
        const result = auditRules({ version: 1, tools, files: [file('.claude/settings.json', '{"hooks":{"PreToolUse":[]}}')] });
        expect(result.rules[0].support).toBe('unknown');
        expect(result.exitCode).toBe(2);
    });
    it('reports stale generated digests and unsupported runtime translations', () => {
        const files = [file('CLAUDE.md', 'Hi', 'claude-code', 'instructions')];
        expect(auditRules({ version: 1, tools, files, generated: [{ path: 'CLAUDE.md', expectedDigest: '0'.repeat(64) }] }).exitCode).toBe(1);
        const result = auditRules({ version: 1, tools, files, translations: [{ source: 'CLAUDE.md', targetTool: 'cursor', capability: 'runtime-control' }] });
        expect(result.exitCode).toBe(2);
        expect(result.findings.some(x => x.code === 'unsupported-translation')).toBe(true);
    });
    it('reports unexpanded imports and scope collisions without exposing raw content', () => {
        const report = auditRules({ version: 1, tools, files: [file('CLAUDE.md', '@private.md', 'claude-code', 'instructions')] });
        expect(report.exitCode).toBe(2);
        expect(JSON.stringify(report)).not.toContain('@private.md');
    });
    it('reports unresolved permission pattern overlap as unknown instead of complete', () => {
        const report = auditRules({ version: 1, tools, files: [file('.claude/settings.json', JSON.stringify({ permissions: { allow: ['Read(src/a.ts)'], deny: ['Read(src/**)'] } }))] });
        expect(report.exitCode).toBe(2);
        expect(report.findings.some(x => x.code === 'permission-overlap-unknown')).toBe(true);
    });
    it('records settings workspace scope and rejects mismatched local scope', () => {
        const report = auditRules({ version: 1, tools, files: [file('.claude/settings.json', '{"permissions":{"deny":["Read(.env)"]}}')] });
        expect(report.rules[0].pathScope).toBe('.');
        expect(auditRules({ version: 1, tools, files: [file('.claude/settings.local.json', '{"permissions":{"deny":["Read(.env)"]}}')] }).exitCode).toBe(2);
    });
    it('bounds permission lists to avoid unbounded conflict analysis', () => {
        const report = auditRules({ version: 1, tools, files: [file('.claude/settings.json', JSON.stringify({ permissions: { allow: Array(1001).fill('Read(.env)') } }))] });
        expect(report.exitCode).toBe(2);
    });
    it('rejects unsafe manifest paths, size and malformed JSON', () => {
        for (const value of ['{', JSON.stringify({ version: 1, tools, files: [file('../a', '')] })])
            expect(() => parseRulesAuditManifest(value)).toThrow();
        expect(() => parseRulesAuditManifest(' '.repeat(1024 * 1024 + 1))).toThrow(/size/);
    });
    it('finds inline Claude imports as incomplete without exposing their contents', () => {
        const report = auditRules({ version: 1, tools, files: [file('CLAUDE.md', 'See @private.md for mandatory instructions.', 'claude-code', 'instructions')] });
        expect(report.exitCode).toBe(2);
        expect(report.complete).toBe(false);
        expect(report.findings.some(finding => finding.code === 'unexpanded-import')).toBe(true);
        expect(JSON.stringify(report)).not.toContain('@private.md');
    });
    it.each([
        'Example: `@private.md` is a literal.',
        '```md\n@private.md\n```',
        '~~~md\n@private.md\n~~~',
        'Example: ``a ` @private.md`` is a literal.',
        'Example: `line one\n@private.md\nline two` is a literal.'
    ])('does not interpret fenced or inline code import examples: %s', content => {
        const report = auditRules({ version: 1, tools, files: [file('CLAUDE.md', content, 'claude-code', 'instructions')] });
        expect(report.exitCode).toBe(0);
        expect(report.findings).toEqual([]);
    });
    it('normalizes documented comma-separated Claude paths frontmatter', () => {
        const report = auditRules({ version: 1, tools, files: [file('.claude/rules/ui.md', '---\npaths: "src/**/*.ts, tests/**/*.ts"\n---\nRun tests', 'claude-code', 'rules')] });
        expect(report.exitCode).toBe(0);
        expect(report.rules[0].application).toBe('matching-files');
        expect(report.rules[0].patterns).toEqual(['src/**/*.ts', 'tests/**/*.ts']);
    });

});
