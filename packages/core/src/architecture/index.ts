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
const within = (path: string, prefix: string) => prefix === '.' || path === prefix || path.startsWith(prefix + '/');
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const cmp = (a: {
    id: string;
}, b: {
    id: string;
}) => a.id.localeCompare(b.id, 'en');
function inspect(graph: DependencyCruiserImport, policy: ArchitecturePolicy) {
    const adjacency = new Map<string, string[]>(), reverse = new Map<string, string[]>(), unknown: ArchitectureUnknown[] = [];
    const names = new Set(graph.modules.map(m => m.source));
    for (const name of names) {
        adjacency.set(name, []);
        reverse.set(name, []);
    }
    if (!graph.complete)
        unknown.push({ code: 'producer-incomplete', source: '.' });
    for (const reason of graph.unknown ?? [])
        unknown.push({ code: 'producer-gap', source: reason });
    for (const node of graph.modules) {
        if (!graph.scope.some(scope => within(node.source, scope)))
            unknown.push({ code: 'outside-declared-scope', source: node.source });
        if (node.generated || node.couldNotResolve || node.followable === false)
            unknown.push({ code: 'module-coverage-gap', source: node.source });
        for (const dep of node.dependencies) {
            const types = dep.dependencyTypes ?? [];
            if (types.some(type => type === 'unknown' || type === 'undetermined'))
                unknown.push({ code: 'unknown-dependency-type', source: node.source, target: dep.resolved });
            const unsupported = dep.dynamic ? 'dynamic-relationship' : dep.generated ? 'generated-relationship' : dep.couldNotResolve ? 'unresolved-relationship' : dep.coreModule || types.some(x => x === 'core' || x.startsWith('npm')) ? 'external-relationship' : dep.followable === false || dep.matchesDoNotFollow ? 'unfollowed-relationship' : null;
            if (unsupported)
                unknown.push({ code: unsupported, source: node.source, target: dep.resolved });
            if (!names.has(dep.resolved)) {
                if (!unsupported)
                    unknown.push({ code: 'missing-node', source: node.source, target: dep.resolved });
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
            const next = stack.pop()!;
            component.push(next);
            for (const predecessor of reverse.get(next)!)
                if (!assigned.has(predecessor)) {
                    assigned.add(predecessor);
                    stack.push(predecessor);
                }
        }
        component.sort();
        if (component.length > 1 || adjacency.get(name)!.includes(name))
            cycles.push(component);
    }
    cycles.sort((a, b) => a.join('|').localeCompare(b.join('|'), 'en'));
    const violations: ArchitectureViolation[] = [];
    const add = (kind: ArchitectureViolation['kind'], rule: string, from: string, to: string) => violations.push({ id: JSON.stringify([kind, rule, from, to]), kind, rule, from, to });
    for (const [from, targets] of adjacency)
        for (const to of targets) {
            for (const rule of policy.boundaries)
                if (within(from, rule.from) && within(to, rule.to))
                    add('boundary', rule.id, from, to);
            const a = policy.layers.findIndex(p => within(from, p)), b = policy.layers.findIndex(p => within(to, p));
            if (a >= 0 && b > a)
                add('layer', `${policy.layers[a]} -> ${policy.layers[b]}`, from, to);
        }
    for (const cycle of cycles)
        add('cycle', JSON.stringify(cycle), cycle[0], cycle[0]);
    const hotspots = sorted(names).map(path => ({ path, inbound: reverse.get(path)!.length, outbound: adjacency.get(path)!.length, degree: reverse.get(path)!.length + adjacency.get(path)!.length })).sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path, 'en'));
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
    const result = inspect(subject, policy), previous = baseline ? inspect(baseline, policy) : undefined, old = new Set(previous?.violations.map(v => v.id) ?? []), unknown = [...result.unknown, ...(previous?.unknown.map(x => ({ ...x, code: `baseline-${x.code}` })) ?? [])];
    const changed = sorted(z.array(pathSchema).max(10000).parse(input.changed ?? [])), affected = new Set<string>(), queue = [...changed];
    for (const path of changed)
        if (!result.names.has(path))
            unknown.push({ code: 'changed-node-missing', source: path });
    const checks = new Set<string>(), activatedMappings = new Set<number>();
    // Process graph dependents and explicit consumers in one fixed-point worklist.
    // A mapping activates once when its contract becomes affected, regardless of order.
    while (queue.length) {
        const path = queue.pop()!;
        if (affected.has(path))
            continue;
        affected.add(path);
        for (const source of result.reverse.get(path) ?? [])
            queue.push(source);
        for (const [index, mapping] of policy.contracts.entries()) {
            if (activatedMappings.has(index) || !within(path, mapping.path))
                continue;
            activatedMappings.add(index);
            for (const check of mapping.checks)
                checks.add(check);
            for (const consumer of mapping.consumers) {
                const matching = [...result.names].filter(name => within(name, consumer));
                if (!matching.length)
                    unknown.push({ code: 'mapped-consumer-missing', source: mapping.path, target: consumer });
                queue.push(...matching);
            }
            if (!mapping.checks.length)
                unknown.push({ code: 'contract-checks-missing', source: mapping.path });
        }
    }
    const diagnostics = [...new Map(unknown.map(x => [JSON.stringify(x), x])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')), complete = diagnostics.length === 0;
    if (!complete)
        for (const check of policy.fullSuite)
            checks.add(check);
    const newViolations = result.violations.filter(v => !old.has(v.id));
    return { version: 1, adapter: 'dependency-cruiser', subjectRevision: subject.revision, baseRevision: baseline?.revision ?? null, scope: sorted(subject.scope), complete, exitCode: !complete ? 2 : newViolations.length ? 1 : 0, historicalViolations: result.violations.filter(v => old.has(v.id)), newViolations, cycles: result.cycles, unknown: diagnostics, impact: { changed, affected: sorted(affected), recommendedChecks: sorted(checks), mode: 'recommend-only', fullSuiteFallback: !complete }, hotspots: result.hotspots };
}
