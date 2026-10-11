import { describe, expect, it } from 'vitest';
import { analyzeArchitecture, parseDependencyCruiser, parseArchitecturePolicy } from '../src/architecture/index.js';
const base = '1'.repeat(40), head = '2'.repeat(40);
const graph = (revision = head, dependencies: object[] = [{ resolved: 'src/db/a.ts' }]) => ({ version: 1, revision, scope: ['src'], complete: true, modules: [{ source: 'src/ui/a.ts', dependencies }, { source: 'src/db/a.ts', dependencies: [] }] });
const policy = { version: 1 as const, boundaries: [{ id: 'ui-db', from: 'src/ui', to: 'src/db' }], layers: [], contracts: [{ path: 'src/db/a.ts', consumers: ['src/ui'], checks: ['consumer-api'] }], fullSuite: ['all-tests'] };
describe('architecture import and impact', () => {
    it('separates historical boundary violations and selects explicit consumer checks', () => {
        const report = analyzeArchitecture({ subject: graph(), subjectRevision: head, baseline: graph(base), baseRevision: base, policy, changed: ['src/db/a.ts'] });
        expect(report.exitCode).toBe(0);
        expect(report.historicalViolations).toHaveLength(1);
        expect(report.newViolations).toHaveLength(0);
        expect(report.impact.affected).toEqual(['src/db/a.ts', 'src/ui/a.ts']);
        expect(report.impact.recommendedChecks).toEqual(['consumer-api']);
    });
    it('catches a new boundary and a new cycle independent from baseline', () => {
        const subject = graph();
        subject.modules[1].dependencies = [{ resolved: 'src/ui/a.ts' }];
        const report = analyzeArchitecture({ subject, subjectRevision: head, baseline: graph(base, []), baseRevision: base, policy });
        expect(report.exitCode).toBe(1);
        expect(report.cycles).toEqual([['src/db/a.ts', 'src/ui/a.ts']]);
        expect(report.newViolations.map(v => v.kind)).toContain('cycle');
    });
    it('reports layers and prefix boundaries without accidental string prefix matches', () => {
        const report = analyzeArchitecture({ subject: graph(), subjectRevision: head, policy: { ...policy, boundaries: [{ id: 'wrong-prefix', from: 'src/u', to: 'src/db' }], layers: ['src/ui', 'src/db'] } });
        expect(report.newViolations.map(v => v.kind)).toEqual(['layer']);
    });
    it.each([{ resolved: 'src/db/a.ts', dynamic: true }, { resolved: 'external', dependencyTypes: ['npm'] }, { resolved: 'src/missing.ts' }, { resolved: 'src/db/a.ts', followable: false }])('keeps incomplete relationships unknown with full suite fallback: %j', dependency => {
        const report = analyzeArchitecture({ subject: graph(head, [dependency]), subjectRevision: head, policy, changed: ['src/db/a.ts'] });
        expect(report.exitCode).toBe(2);
        expect(report.complete).toBe(false);
        expect(report.unknown.length).toBeGreaterThan(0);
        expect(report.impact.recommendedChecks).toContain('all-tests');
    });
    it('rejects stale subject/base and mismatched baseline coverage', () => {
        expect(() => analyzeArchitecture({ subject: graph(), subjectRevision: base })).toThrow(/revision/);
        expect(() => analyzeArchitecture({ subject: graph(), subjectRevision: head, baseline: graph(base), baseRevision: head })).toThrow(/revision/);
        expect(() => analyzeArchitecture({ subject: graph(), subjectRevision: head, baseline: { ...graph(base), scope: ['other'] }, baseRevision: base })).toThrow(/scope/);
    });
    it.each(['{', JSON.stringify({ ...graph(), modules: [{ source: '../secret', dependencies: [] }] }), JSON.stringify({ ...graph(), complete: 'yes' }), JSON.stringify({ ...graph(), modules: [...graph().modules, ...graph().modules] })])('rejects malformed and unsafe imports', text => expect(() => parseDependencyCruiser(text)).toThrow());
    it('bounds import size, reports scope gaps and rejects executable policy content', () => {
        expect(() => parseDependencyCruiser(' '.repeat(8 * 1024 * 1024 + 1))).toThrow(/size/);
        expect(analyzeArchitecture({ subject: { ...graph(), complete: false }, subjectRevision: head }).complete).toBe(false);
        expect(() => parseArchitecturePolicy(JSON.stringify({ ...policy, command: 'npm test' }))).toThrow();
    });
    it('propagates explicitly mapped consumers through their own reverse dependencies', () => {
        const subject = { ...graph(), modules: [...graph(head, []).modules, { source: 'src/app.ts', dependencies: [{ resolved: 'src/ui/a.ts' }] }] };
        const report = analyzeArchitecture({ subject, subjectRevision: head, changed: ['src/db/a.ts'], policy });
        expect(report.impact.affected).toContain('src/app.ts');
    });
    it('reports a mapped consumer missing from the import as unknown', () => {
        const report = analyzeArchitecture({ subject: graph(), subjectRevision: head, changed: ['src/db/a.ts'], policy: { ...policy, contracts: [{ path: 'src/db/a.ts', consumers: ['missing-consumer'], checks: ['consumer-api'] }] } });
        expect(report.exitCode).toBe(2);
        expect(report.impact.recommendedChecks).toContain('all-tests');
    });
    it('rejects ambiguous overlapping layer scopes', () => expect(() => parseArchitecturePolicy(JSON.stringify({ ...policy, layers: ['src', 'src/ui'] }))).toThrow(/layer/));
    it('is deterministic under module/dependency order and reports unknown changed nodes', () => {
        const input = { subject: graph(), subjectRevision: head, policy, changed: ['missing.ts'] };
        expect(analyzeArchitecture(input)).toEqual(analyzeArchitecture({ ...input, subject: { ...graph(), modules: graph().modules.reverse() } }));
        expect(analyzeArchitecture(input).unknown.some(x => x.code === 'changed-node-missing')).toBe(true);
    });
    it.each(['unknown', 'undetermined'])('preserves %s dependency type gaps even when endpoints are known', type => {
        const report = analyzeArchitecture({ subject: graph(head, [{ resolved: 'src/db/a.ts', dependencyTypes: [type] }]), subjectRevision: head, policy, changed: ['src/db/a.ts'] });
        expect(report.complete).toBe(false);
        expect(report.exitCode).toBe(2);
        expect(report.unknown.some(gap => gap.code === 'unknown-dependency-type')).toBe(true);
        expect(report.impact.recommendedChecks).toContain('all-tests');
    });
    it('selects consumer checks for indirectly affected contracts and reaches mapping fixed point independently of order', () => {
        const subject = { version: 1, revision: head, scope: ['src'], complete: true, modules: [
            { source: 'src/shared.ts', dependencies: [] },
            { source: 'src/api.ts', dependencies: [{ resolved: 'src/shared.ts' }] },
            { source: 'src/app.ts', dependencies: [{ resolved: 'src/api.ts' }] },
            { source: 'src/consumer.ts', dependencies: [] },
            { source: 'src/downstream.ts', dependencies: [] }
        ] };
        const contracts = [
            { path: 'src/consumer.ts', consumers: ['src/downstream.ts'], checks: ['downstream-test'] },
            { path: 'src/api.ts', consumers: ['src/consumer.ts'], checks: ['consumer-api'] }
        ];
        const input = { subject, subjectRevision: head, changed: ['src/shared.ts'], policy: { ...policy, boundaries: [], contracts } };
        const report = analyzeArchitecture(input);
        expect(report.exitCode).toBe(0);
        expect(report.impact.recommendedChecks).toEqual(['consumer-api', 'downstream-test']);
        expect(report.impact.affected).toEqual(['src/api.ts', 'src/app.ts', 'src/consumer.ts', 'src/downstream.ts', 'src/shared.ts']);
        expect(analyzeArchitecture({ ...input, policy: { ...input.policy, contracts: [...contracts].reverse() } })).toEqual(report);
    });

    it('bounds amplified policy diagnostics and returns incomplete with the full suite', () => {
        const modules = Array.from({ length: 101 }, (_, index) => ({ source: `src/${index}.ts`, dependencies: index ? [] : Array.from({ length: 100 }, (_, target) => ({ resolved: `src/${target + 1}.ts` })) }));
        const report = analyzeArchitecture({ subject: { ...graph(), modules }, subjectRevision: head, policy: { ...policy, boundaries: Array.from({ length: 100 }, (_, index) => ({ id: `rule-${index}`, from: '.', to: '.' })) } });
        expect(report.exitCode).toBe(2);
        expect(report.complete).toBe(false);
        expect(report.unknown).toContainEqual({ code: 'resource-budget-exceeded', source: '.' });
        expect(report.impact.fullSuiteFallback).toBe(true);
        expect(report.impact.recommendedChecks).toContain('all-tests');
        expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(4 * 1024 * 1024);
    });

    it('bounds contract work even when no mapping matches an affected node', () => {
        const modules = Array.from({ length: 1100 }, (_, index) => ({ source: `src/${index}.ts`, dependencies: [] }));
        const report = analyzeArchitecture({ subject: { ...graph(), modules }, subjectRevision: head, changed: modules.map(module => module.source), policy: { ...policy, boundaries: [], contracts: Array.from({ length: 1000 }, (_, index) => ({ path: `absent/${index}`, consumers: [], checks: [] })) } });
        expect(report.exitCode).toBe(2);
        expect(report.unknown).toContainEqual({ code: 'resource-budget-exceeded', source: '.' });
        expect(report.impact.recommendedChecks).toEqual(['all-tests']);
    });

    it('deduplicates scheduled consumers and caches repeated prefix matching', () => {
        const modules = Array.from({ length: 100 }, (_, index) => ({ source: `src/${index}.ts`, dependencies: [] }));
        const mapping = { path: 'src', consumers: Array<string>(100).fill('.'), checks: ['consumer-api'] };
        const report = analyzeArchitecture({ subject: { ...graph(), modules }, subjectRevision: head, changed: ['src/0.ts'], policy: { ...policy, boundaries: [], contracts: Array.from({ length: 100 }, () => mapping) } });
        expect(report.exitCode).toBe(0);
        expect(report.impact.affected).toEqual(modules.map(module => module.source).sort());
        expect(report.impact.recommendedChecks).toEqual(['consumer-api']);
    });

    it('shares the diagnostic budget across baseline and subject instead of declaring all violations historical', () => {
        const modules = Array.from({ length: 51 }, (_, index) => ({ source: `src/${index}.ts`, dependencies: index ? [] : Array.from({ length: 50 }, (_, target) => ({ resolved: `src/${target + 1}.ts` })) }));
        const report = analyzeArchitecture({ subject: { ...graph(), modules }, subjectRevision: head, baseline: { ...graph(base), modules }, baseRevision: base, policy: { ...policy, boundaries: Array.from({ length: 21 }, (_, index) => ({ id: `rule-${index}`, from: '.', to: '.' })) } });
        expect(report.exitCode).toBe(2);
        expect(report.historicalViolations).toEqual([]);
        expect(report.unknown).toContainEqual({ code: 'resource-budget-exceeded', source: '.' });
    });

    it('bounds retained report bytes independently of operation and diagnostic counts', () => {
        const modules = Array.from({ length: 2500 }, (_, index) => ({ source: `src/${'a'.repeat(900)}${index}.ts`, dependencies: [] }));
        const subject = { ...graph(), modules };
        expect(Buffer.byteLength(JSON.stringify(subject))).toBeLessThan(8 * 1024 * 1024);
        const report = analyzeArchitecture({ subject, subjectRevision: head, changed: modules.map(module => module.source), policy: { version: 1, fullSuite: ['all-tests'] } });
        expect(report.exitCode).toBe(2);
        expect(report.unknown).toContainEqual({ code: 'resource-budget-exceeded', source: '.' });
        expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(4 * 1024 * 1024);
        expect(report.impact.fullSuiteFallback).toBe(true);
    });

});
