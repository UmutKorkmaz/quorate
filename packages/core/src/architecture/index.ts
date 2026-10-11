import { z } from 'zod';
export const ARCHITECTURE_IMPORT_LIMIT = 8 * 1024 * 1024;
export function architecturePath(value: string): boolean {
    return value.length > 0 && value.length <= 1024 && !/[\\\x00-\x1f]/.test(value) && !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && !value.split('/').some(p => p === '..' || p === '.' || p === '');
}
const pathSchema = z.string().refine(architecturePath, 'Unsafe relative path');
const scopeSchema = z.union([z.literal('.'), pathSchema]);
const revisionSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, 'Expected full revision');
const dependencySchema = z.object({ resolved: pathSchema, dynamic: z.boolean().optional(), couldNotResolve: z.boolean().optional(), coreModule: z.boolean().optional(), followable: z.boolean().optional(), matchesDoNotFollow: z.boolean().optional(), dependencyTypes: z.array(z.string()).max(30).optional(), generated: z.boolean().optional() }).passthrough();
const moduleSchema = z.object({ source: pathSchema, dependencies: z.array(dependencySchema).max(20000), generated: z.boolean().optional(), couldNotResolve: z.boolean().optional(), followable: z.boolean().optional() }).passthrough();
const graphSchema = z.object({ version: z.literal(1), revision: revisionSchema, scope: z.array(scopeSchema).min(1).max(100), complete: z.boolean(), modules: z.array(moduleSchema).max(10000), unknown: z.array(z.string().max(500)).max(1000).optional() }).strict();
const policySchema = z.object({ version: z.literal(1), boundaries: z.array(z.object({ id: z.string().min(1).max(100), from: scopeSchema, to: scopeSchema }).strict()).max(1000).default([]), layers: z.array(scopeSchema).max(100).default([]), contracts: z.array(z.object({ path: pathSchema, consumers: z.array(scopeSchema).max(100), checks: z.array(z.string().min(1).max(200)).max(100) }).strict()).max(1000).default([]), fullSuite: z.array(z.string().min(1).max(200)).max(100).default([]) }).strict();
export type DependencyCruiserImport = z.infer<typeof graphSchema>;
export type ArchitecturePolicy = z.infer<typeof policySchema>;
export interface ArchitectureInput {
    subject: unknown;
    subjectRevision: string;
    baseline?: unknown;
    baseRevision?: string;
    policy?: unknown;
    changed?: string[];
}
export interface ArchitectureViolation {
    id: string;
    kind: 'boundary' | 'layer' | 'cycle';
    from: string;
    to: string;
    rule: string;
}
export interface ArchitectureUnknown {
    code: string;
    source: string;
    target?: string;
}
export interface ArchitectureReport {
    version: 1;
    adapter: 'dependency-cruiser';
    subjectRevision: string;
    baseRevision: string | null;
    scope: string[];
    complete: boolean;
    exitCode: 0 | 1 | 2;
    historicalViolations: ArchitectureViolation[];
    newViolations: ArchitectureViolation[];
    cycles: string[][];
    unknown: ArchitectureUnknown[];
    impact: {
        changed: string[];
        affected: string[];
        recommendedChecks: string[];
        mode: 'recommend-only';
        fullSuiteFallback: boolean;
    };
    hotspots: {
        path: string;
        inbound: number;
        outbound: number;
        degree: number;
    }[];
}
function boundedJson(text: string, limit: number): unknown { if (Buffer.byteLength(text, 'utf8') > limit)
    throw new Error('Import exceeds size limit'); return JSON.parse(text); }
export function parseDependencyCruiser(text: string): DependencyCruiserImport { return validateGraph(boundedJson(text, ARCHITECTURE_IMPORT_LIMIT)); }
export function parseArchitecturePolicy(text: string): ArchitecturePolicy { return validatePolicy(boundedJson(text, 1024 * 1024)); }
function validatePolicy(input: unknown): ArchitecturePolicy { const result = policySchema.parse(input); for (const values of [result.layers, result.boundaries.map(x => x.id)])
    if (new Set(values).size !== values.length)
        throw new Error('Duplicate policy identifiers'); for (const [index, layer] of result.layers.entries())
    if (result.layers.slice(index + 1).some(other => within(layer, other) || within(other, layer)))
        throw new Error('Ambiguous overlapping layer scopes'); return result; }
function validateGraph(input: unknown): DependencyCruiserImport {
    const graph = graphSchema.parse(input);
    const names = graph.modules.map(m => m.source);
    if (new Set(names).size !== names.length)
        throw new Error('Duplicate module identifiers');
    if (new Set(graph.scope).size !== graph.scope.length)
        throw new Error('Duplicate scope');
    let edgeCount = 0;
    for (const node of graph.modules) {
        edgeCount += node.dependencies.length;
        if (edgeCount > 100000)
            throw new Error('Dependency count exceeds limit');
    }
    return graph;
}
// Shared across subject, baseline and impact: imported policies cannot amplify
// a small input into unbounded work or retained report data.
export const ARCHITECTURE_OPERATION_LIMIT = 1_000_000;
export const ARCHITECTURE_DIAGNOSTIC_LIMIT = 2_000;
export const ARCHITECTURE_OUTPUT_LIMIT = 4 * 1024 * 1024;
class ArchitectureBudgetExceeded extends Error {}
class ArchitectureBudget {
    private operations = 0;
    private diagnostics = 0;
    private outputBytes = 1024; // Fixed report fields and the exhaustion diagnostic.
    tick(): void {
        if (++this.operations > ARCHITECTURE_OPERATION_LIMIT)
            throw new ArchitectureBudgetExceeded();
    }
    retain(value: unknown, diagnostic = false): void {
        this.tick();
        if (diagnostic && ++this.diagnostics > ARCHITECTURE_DIAGNOSTIC_LIMIT)
            throw new ArchitectureBudgetExceeded();
        this.outputBytes += Buffer.byteLength(JSON.stringify(value), 'utf8') + 1;
        if (this.outputBytes > ARCHITECTURE_OUTPUT_LIMIT)
            throw new ArchitectureBudgetExceeded();
    }
    within(path: string, prefix: string): boolean {
        this.tick();
        return within(path, prefix);
    }
    checkOutput(report: ArchitectureReport): void {
        // Includes final field names and baseline diagnostic prefixes, which can
        // add bytes after individual retained records were counted.
        if (Buffer.byteLength(JSON.stringify(report), 'utf8') > ARCHITECTURE_OUTPUT_LIMIT)
            throw new ArchitectureBudgetExceeded();
    }
}
const within = (path: string, prefix: string) => prefix === '.' || path === prefix || path.startsWith(prefix + '/');
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const cmp = (a: {
    id: string;
}, b: {
    id: string;
}) => a.id.localeCompare(b.id, 'en');
function inspect(graph: DependencyCruiserImport, policy: ArchitecturePolicy, budget: ArchitectureBudget) {
    const adjacency = new Map<string, string[]>(), reverse = new Map<string, string[]>(), unknown: ArchitectureUnknown[] = [];
    const names = new Set(graph.modules.map(m => m.source));
    const addUnknown = (value: ArchitectureUnknown) => { budget.retain(value, true); unknown.push(value); };
    for (const name of names) {
        budget.tick();
        adjacency.set(name, []);
        reverse.set(name, []);
    }
    if (!graph.complete)
        addUnknown({ code: 'producer-incomplete', source: '.' });
    for (const reason of graph.unknown ?? [])
        addUnknown({ code: 'producer-gap', source: reason });
    for (const node of graph.modules) {
        if (!graph.scope.some(scope => budget.within(node.source, scope)))
            addUnknown({ code: 'outside-declared-scope', source: node.source });
        if (node.generated || node.couldNotResolve || node.followable === false)
            addUnknown({ code: 'module-coverage-gap', source: node.source });
        for (const dep of node.dependencies) {
            budget.tick();
            const types = dep.dependencyTypes ?? [];
            if (types.some(type => { budget.tick(); return type === 'unknown' || type === 'undetermined'; }))
                addUnknown({ code: 'unknown-dependency-type', source: node.source, target: dep.resolved });
            const unsupported = dep.dynamic ? 'dynamic-relationship' : dep.generated ? 'generated-relationship' : dep.couldNotResolve ? 'unresolved-relationship' : dep.coreModule || types.some(x => { budget.tick(); return x === 'core' || x.startsWith('npm'); }) ? 'external-relationship' : dep.followable === false || dep.matchesDoNotFollow ? 'unfollowed-relationship' : null;
            if (unsupported)
                addUnknown({ code: unsupported, source: node.source, target: dep.resolved });
            if (!names.has(dep.resolved)) {
                if (!unsupported)
                    addUnknown({ code: 'missing-node', source: node.source, target: dep.resolved });
                continue;
            }
            adjacency.get(node.source)!.push(dep.resolved);
            reverse.get(dep.resolved)!.push(node.source);
        }
    }
    for (const [name, edges] of adjacency)
        adjacency.set(name, sorted(edges));
    for (const [name, edges] of reverse)
        reverse.set(name, sorted(edges));
    // Iterative Kosaraju avoids stack overflow for long imported dependency chains.
    const seen = new Set<string>(), order: string[] = [];
    for (const name of sorted(names)) {
        if (seen.has(name))
            continue;
        const stack: {
            name: string;
            offset: number;
        }[] = [{ name, offset: 0 }];
        seen.add(name);
        while (stack.length) {
            budget.tick();
            const top = stack[stack.length - 1], edges = adjacency.get(top.name)!;
            if (top.offset < edges.length) {
                const next = edges[top.offset++];
                if (!seen.has(next)) {
                    seen.add(next);
                    stack.push({ name: next, offset: 0 });
                }
            }
            else {
                order.push(top.name);
                stack.pop();
            }
        }
    }
    const assigned = new Set<string>(), cycles: string[][] = [];
    for (const name of order.reverse()) {
        if (assigned.has(name))
            continue;
        const component: string[] = [], stack = [name];
        assigned.add(name);
        while (stack.length) {
            budget.tick();
            const next = stack.pop()!;
            component.push(next);
            for (const predecessor of reverse.get(next)!) {
                budget.tick();
                if (!assigned.has(predecessor)) {
                    assigned.add(predecessor);
                    stack.push(predecessor);
                }
            }
        }
        component.sort();
        if (component.length > 1 || adjacency.get(name)!.includes(name)) {
            budget.retain(component);
            cycles.push(component);
        }
    }
    cycles.sort((a, b) => a.join('|').localeCompare(b.join('|'), 'en'));
    const violations: ArchitectureViolation[] = [];
    const add = (kind: ArchitectureViolation['kind'], rule: string, from: string, to: string) => {
        const violation = { id: JSON.stringify([kind, rule, from, to]), kind, rule, from, to };
        budget.retain(violation, true);
        violations.push(violation);
    };
    for (const [from, targets] of adjacency)
        for (const to of targets) {
            budget.tick();
            for (const rule of policy.boundaries)
                if (budget.within(from, rule.from) && budget.within(to, rule.to))
                    add('boundary', rule.id, from, to);
            const a = policy.layers.findIndex(p => budget.within(from, p)), b = policy.layers.findIndex(p => budget.within(to, p));
            if (a >= 0 && b > a)
                add('layer', `${policy.layers[a]} -> ${policy.layers[b]}`, from, to);
        }
    for (const cycle of cycles)
        add('cycle', JSON.stringify(cycle), cycle[0], cycle[0]);
    const hotspots = sorted(names).map(path => {
        const hotspot = { path, inbound: reverse.get(path)!.length, outbound: adjacency.get(path)!.length, degree: reverse.get(path)!.length + adjacency.get(path)!.length };
        budget.retain(hotspot);
        return hotspot;
    }).sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path, 'en'));
    return { reverse, names, unknown, cycles, violations: violations.sort(cmp), hotspots };
}
export function analyzeArchitecture(input: ArchitectureInput): ArchitectureReport {
    const subject = validateGraph(input.subject), expected = revisionSchema.parse(input.subjectRevision), policy = validatePolicy(input.policy ?? { version: 1 });
    if (subject.revision !== expected)
        throw new Error('Subject revision is stale');
    let baseline: DependencyCruiserImport | undefined;
    if (input.baseline !== undefined) {
        baseline = validateGraph(input.baseline);
        if (!input.baseRevision || baseline.revision !== revisionSchema.parse(input.baseRevision))
            throw new Error('Baseline revision is stale');
        if (JSON.stringify(sorted(baseline.scope)) !== JSON.stringify(sorted(subject.scope)))
            throw new Error('Baseline scope mismatch');
    }
    else if (input.baseRevision)
        throw new Error('Base revision requires baseline');
    const changed = sorted(z.array(pathSchema).max(10000).parse(input.changed ?? []));
    const budget = new ArchitectureBudget();
    try {
        budget.retain(subject.scope);
        const result = inspect(subject, policy, budget), previous = baseline ? inspect(baseline, policy, budget) : undefined, old = new Set(previous?.violations.map(v => v.id) ?? []), unknown = [...result.unknown, ...(previous?.unknown.map(x => ({ ...x, code: `baseline-${x.code}` })) ?? [])];
        const affected = new Set<string>(), queue = [...changed], scheduled = new Set(changed);
        budget.retain(changed);
        const addUnknown = (value: ArchitectureUnknown) => { budget.retain(value, true); unknown.push(value); };
        const enqueue = (path: string) => {
            budget.tick();
            if (!scheduled.has(path)) { scheduled.add(path); queue.push(path); }
        };
        const matches = new Map<string, string[]>();
        const matchingConsumers = (prefix: string) => {
            budget.tick();
            let matching = matches.get(prefix);
            if (!matching) {
                matching = [...result.names].filter(name => budget.within(name, prefix));
                matches.set(prefix, matching);
            }
            return matching;
        };
        for (const path of changed)
            if (!result.names.has(path))
                addUnknown({ code: 'changed-node-missing', source: path });
        const checks = new Set<string>(), remainingMappings = new Map(policy.contracts.map((mapping, index) => [index, mapping])), expandedConsumers = new Set<string>();
        // Process graph dependents and explicit consumers in one fixed-point worklist.
        // A mapping activates once when its contract becomes affected, regardless of order.
        while (queue.length) {
            budget.tick();
            const path = queue.pop()!;
            if (affected.has(path))
                continue;
            budget.retain(path);
            affected.add(path);
            for (const source of result.reverse.get(path) ?? [])
                enqueue(source);
            for (const [index, mapping] of remainingMappings) {
                budget.tick();
                if (!budget.within(path, mapping.path))
                    continue;
                remainingMappings.delete(index);
                for (const check of mapping.checks) {
                    budget.tick();
                    if (!checks.has(check)) budget.retain(check);
                    checks.add(check);
                }
                for (const consumer of sorted(mapping.consumers)) {
                    const matching = matchingConsumers(consumer);
                    if (!matching.length)
                        addUnknown({ code: 'mapped-consumer-missing', source: mapping.path, target: consumer });
                    if (!expandedConsumers.has(consumer)) {
                        expandedConsumers.add(consumer);
                        for (const name of matching) enqueue(name);
                    }
                }
                if (!mapping.checks.length)
                    addUnknown({ code: 'contract-checks-missing', source: mapping.path });
            }
        }
        const diagnostics = [...new Map(unknown.map(x => [JSON.stringify(x), x])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')), complete = diagnostics.length === 0;
        if (!complete)
            for (const check of policy.fullSuite) {
                if (!checks.has(check)) budget.retain(check);
                checks.add(check);
            }
        const newViolations = result.violations.filter(v => !old.has(v.id));
        const report: ArchitectureReport = { version: 1, adapter: 'dependency-cruiser', subjectRevision: subject.revision, baseRevision: baseline?.revision ?? null, scope: sorted(subject.scope), complete, exitCode: !complete ? 2 : newViolations.length ? 1 : 0, historicalViolations: result.violations.filter(v => old.has(v.id)), newViolations, cycles: result.cycles, unknown: diagnostics, impact: { changed, affected: sorted(affected), recommendedChecks: sorted(checks), mode: 'recommend-only', fullSuiteFallback: !complete }, hotspots: result.hotspots };
        budget.checkOutput(report);
        return report;
    } catch (error) {
        if (!(error instanceof ArchitectureBudgetExceeded)) throw error;
        // Partial observations are discarded: they cannot support an exhaustive
        // architecture or affected-test claim after a shared budget is exhausted.
        return { version: 1, adapter: 'dependency-cruiser', subjectRevision: subject.revision, baseRevision: baseline?.revision ?? null, scope: sorted(subject.scope), complete: false, exitCode: 2, historicalViolations: [], newViolations: [], cycles: [], unknown: [{ code: 'resource-budget-exceeded', source: '.' }], impact: { changed: [], affected: [], recommendedChecks: sorted(policy.fullSuite), mode: 'recommend-only', fullSuiteFallback: true }, hotspots: [] };
    }
}
