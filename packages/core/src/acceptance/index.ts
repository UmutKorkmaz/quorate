import { z } from 'zod';
import { evidenceDigest, type EvidenceInspection } from '../evidence/index.js';
export type AcceptanceFormat = 'markdown' | 'openspec' | 'speckit';
export interface AcceptanceCriterion {
    id: string;
    text: string;
    subjective: boolean;
}
export interface AcceptanceCriterionResult extends AcceptanceCriterion {
    state: 'demonstrated' | 'contradicted' | 'missing' | 'human-review';
    checks: string[];
    evidenceIds: string[];
}
const id = z.string().regex(/^[A-Z][A-Z0-9_-]{0,79}$/);
export const acceptanceMappingSchema = z.object({ schemaVersion: z.literal(1), specDigest: z.string().regex(/^[a-f0-9]{64}$/), sourceRevision: z.string().regex(/^[a-f0-9]{40,64}$/).optional(), origin: z.enum(['human', 'ai-advisory']), criteria: z.array(z.object({ id, checks: z.array(z.string().min(1).max(160)).max(256) }).strict()).max(256) }).strict();
export type AcceptanceMapping = z.infer<typeof acceptanceMappingSchema>;
export interface AcceptanceReport {
    schemaVersion: 1;
    kind: 'acceptance-evidence';
    sourceRevision: string;
    specDigest: string;
    trustedBaseDigest?: string;
    state: 'verified' | 'contradicted' | 'missing' | 'inconclusive';
    criteria: AcceptanceCriterionResult[];
    issues: string[];
}
export function parseAcceptanceCriteria(text: string, options: {
    format?: AcceptanceFormat;
} = {}): AcceptanceCriterion[] {
    if (Buffer.byteLength(text) > 1024 * 1024)
        throw new Error('Acceptance spec exceeds 1 MiB');
    const format = options.format ?? 'markdown', pattern = format === 'markdown' ? /^\s*(?:-\s+|#{1,6}\s+)\[([A-Z][A-Z0-9_-]{0,79})\]\s+(.+)$/gm : format === 'openspec' ? /^### Requirement:\s*\[([A-Z][A-Z0-9_-]{0,79})\]\s+(.+)$/gm : format === 'speckit' ? /^\s*-\s+\*\*([A-Z][A-Z0-9_-]{0,79})\*\*:\s*(.+)$/gm : undefined;
    if (!pattern)
        throw new Error('Unsupported acceptance format');
    const visible: string[] = [];
    let fence: {
        character: string;
        length: number;
    } | undefined;
    for (const line of text.split(/\r?\n/)) {
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
            if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim())
                fence = undefined;
            continue;
        }
        if (marker) {
            fence = { character: marker[1][0], length: marker[1].length };
            continue;
        }
        visible.push(line);
    }
    const stripped = visible.join('\n');
    const criteria = [...stripped.matchAll(pattern)].map(m => ({ id: m[1], text: m[2].trim(), subjective: /\[human\]\s*$/.test(m[2]) }));
    if (!criteria.length || criteria.length > 256)
        throw new Error('Unsupported or empty explicit acceptance layout');
    if (new Set(criteria.map(c => c.id)).size !== criteria.length)
        throw new Error('Duplicate criterion ID');
    return criteria;
}
function checkedMapping(value: unknown, text: string): AcceptanceMapping { const mapping = acceptanceMappingSchema.parse(value); if (mapping.specDigest !== evidenceDigest(text))
    throw new Error('Acceptance spec digest mismatch'); if (new Set(mapping.criteria.map(c => c.id)).size !== mapping.criteria.length || mapping.criteria.some(c => new Set(c.checks).size !== c.checks.length))
    throw new Error('Duplicate acceptance mapping'); return mapping; }
export function checkAcceptance(options: {
    spec: string;
    mapping: unknown;
    evidence: EvidenceInspection;
    format?: AcceptanceFormat;
    trustedBase?: {
        spec: string;
        mapping: unknown;
    };
}): AcceptanceReport {
    const mapping = checkedMapping(options.mapping, options.spec), head = parseAcceptanceCriteria(options.spec, { format: options.format }), issues: string[] = [], effective = new Map(head.map(c => [c.id, c])), changed = new Set<string>(), headChecks = new Map(mapping.criteria.map(c => [c.id, c.checks]));
    if (mapping.criteria.some(c => !effective.has(c.id)))
        throw new Error('Mapping names an unavailable criterion');
    let trustedBaseDigest: string | undefined;
    if (options.trustedBase) {
        const base = options.trustedBase, baseMap = checkedMapping(base.mapping, base.spec), baseCriteria = parseAcceptanceCriteria(base.spec, { format: options.format });
        trustedBaseDigest = evidenceDigest(base.spec);
        if (baseMap.specDigest !== mapping.specDigest) {
            issues.push('spec-changed');
            baseCriteria.forEach(c => changed.add(c.id));
        }
        for (const criterion of baseCriteria) {
            const proposed = effective.get(criterion.id);
            if (!proposed) {
                issues.push(`criterion-deleted:${criterion.id}`);
                effective.set(criterion.id, criterion);
                changed.add(criterion.id);
            }
            else if (proposed.text !== criterion.text) {
                issues.push(`criterion-changed:${criterion.id}`);
                changed.add(criterion.id);
            }
            const required = baseMap.criteria.find(c => c.id === criterion.id)?.checks ?? [], actual = headChecks.get(criterion.id) ?? [];
            if (required.some(c => !actual.includes(c)) || baseMap.origin === 'human' && mapping.origin !== 'human') {
                issues.push(`mapping-weakened:${criterion.id}`);
                changed.add(criterion.id);
            }
            headChecks.set(criterion.id, [...new Set([...required, ...actual])]);
        }
    }
    const sourceRevision = mapping.sourceRevision ?? options.evidence.sourceRevision;
    const revisionMatches = options.evidence.sourceRevision === sourceRevision;
    if (!revisionMatches)
        issues.push('implementation-revision-mismatch');
    const criteria = [...effective.values()].map(criterion => {
        const checks = headChecks.get(criterion.id) ?? [], observations = revisionMatches ? options.evidence.records.filter(r => r.accepted && r.integrity === 'valid' && r.sourceRevision === sourceRevision).flatMap(r => r.checks.filter(c => checks.includes(c.id)).map(c => ({ ...c, evidenceId: r.id }))) : [];
        let state: AcceptanceCriterionResult['state'];
        if (observations.some(c => c.outcome === 'failed'))
            state = 'contradicted';
        else if (observations.some(c => c.outcome === 'inconclusive') || changed.has(criterion.id) || criterion.subjective || mapping.origin !== 'human')
            state = 'human-review';
        else if (!checks.length || checks.some(id => !observations.some(c => c.id === id && c.outcome === 'passed')))
            state = observations.some(c => c.outcome === 'inconclusive') ? 'human-review' : 'missing';
        else
            state = 'demonstrated';
        return { ...criterion, state, checks, evidenceIds: [...new Set(observations.map(c => c.evidenceId))] };
    });
    const state = criteria.some(c => c.state === 'contradicted') ? 'contradicted' : criteria.some(c => c.state === 'missing') ? 'missing' : criteria.some(c => c.state === 'human-review') ? 'inconclusive' : 'verified';
    return { schemaVersion: 1, kind: 'acceptance-evidence', sourceRevision, specDigest: evidenceDigest(options.spec), trustedBaseDigest, state, criteria, issues };
}
