import { createHash } from 'node:crypto';
import { z } from 'zod';
export const MAX_EVIDENCE_RECORDS = 256;
export const MAX_EVIDENCE_ARTIFACT_BYTES = 4 * 1024 * 1024;
export const MAX_EVIDENCE_MANIFEST_BYTES = 4 * 1024 * 1024;
export const MAX_EVIDENCE_BUNDLE_BYTES = 16 * 1024 * 1024;
export const evidenceDigest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
/** Canonical JSON for supported JSON inputs, bounded and cycle-safe. */
export function evidenceCanonical(value: unknown, ancestors = new Set<object>(), depth = 0): string {
    if (depth > 32)
        throw new Error('Evidence nesting limit exceeded');
    if (value !== null && typeof value === 'object') {
        if (ancestors.has(value))
            throw new Error('Circular evidence');
        ancestors.add(value);
        try {
            if (Array.isArray(value))
                return `[${value.map(v => evidenceCanonical(v, ancestors, depth + 1)).join(',')}]`;
            return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${evidenceCanonical(v, ancestors, depth + 1)}`).join(',')}}`;
        }
        finally {
            ancestors.delete(value);
        }
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))
        return JSON.stringify(value);
    throw new Error('Evidence requires finite JSON values');
}
const digest = z.string().regex(/^[a-f0-9]{64}$/), revision = z.string().regex(/^[a-f0-9]{40,64}$/);
const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/);
export const evidenceCheckSchema = z.object({ id, outcome: z.enum(['passed', 'failed', 'inconclusive', 'missing']), requirements: z.array(id).max(256) }).strict();
const recordSchema = z.object({ id, kind: z.string().min(1).max(80), schemaVersion: z.number().int().positive(), sourceRevision: revision.nullable(), subjectDigest: digest, producer: z.object({ id: z.string().min(1).max(160), trust: z.enum(['unattested', 'local-authenticated', 'trusted-signer']) }).strict(), checks: z.array(evidenceCheckSchema).max(256), artifact: z.object({ path: z.string().regex(/^artifacts\/[a-f0-9]{64}\.json$/), sha256: digest, bytes: z.number().int().min(1).max(MAX_EVIDENCE_ARTIFACT_BYTES) }).strict(), references: z.array(id).max(256) }).strict();
export type EvidenceRecord = z.infer<typeof recordSchema>;
export interface EvidenceObservation extends EvidenceRecord {
    integrity: 'valid' | 'invalid' | 'unsupported' | 'unavailable';
    accepted: boolean;
}
export const evidencePolicySchema = z.object({ schemaVersion: z.literal(1), sourceRevision: revision, requiredChecks: z.array(id).min(1).max(256), acceptedDigests: z.array(digest).max(256), requireAuthenticatedProducer: z.boolean().default(false), trustedProofKeys: z.array(z.object({ id: z.string().min(1).max(160), publicKeyPem: z.string().min(1).max(8192) }).strict()).max(32).default([]) }).strict();
export type EvidencePolicy = z.infer<typeof evidencePolicySchema>;
const bundleSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('quorate-evidence-bundle'), records: z.array(recordSchema).min(1).max(MAX_EVIDENCE_RECORDS) }).strict();
export type EvidenceBundle = z.infer<typeof bundleSchema>;
export function validateEvidenceBundle(value: unknown): EvidenceBundle {
    const bundle = bundleSchema.parse(value), records = new Map(bundle.records.map(r => [r.id, r]));
    if (records.size !== bundle.records.length)
        throw new Error('Duplicate evidence ID');
    if (bundle.records.reduce((n, r) => n + r.artifact.bytes, 0) > MAX_EVIDENCE_BUNDLE_BYTES)
        throw new Error('Evidence bundle byte limit exceeded');
    for (const r of bundle.records) {
        if (r.artifact.path !== `artifacts/${r.artifact.sha256}.json`)
            throw new Error('Invalid content-addressed artifact');
        if (new Set(r.checks.map(c => c.id)).size !== r.checks.length)
            throw new Error('Duplicate evidence check');
        if (new Set(r.references).size !== r.references.length)
            throw new Error('Duplicate evidence reference');
    }
    const done = new Set<string>(), active = new Set<string>();
    const visit = (name: string) => { if (active.has(name))
        throw new Error('Circular evidence references'); if (done.has(name))
        return; const r = records.get(name); if (!r)
        throw new Error('Unavailable evidence reference'); active.add(name); r.references.forEach(visit); active.delete(name); done.add(name); };
    records.forEach(r => visit(r.id));
    return bundle;
}
export interface EvidenceIssue {
    code: 'wrong-revision' | 'missing-check' | 'contradicted-check' | 'inconclusive-check' | 'untrusted-producer' | 'invalid-integrity' | 'unsupported-schema' | 'unavailable-evidence';
    evidenceId?: string;
    checkId?: string;
    nextCheck: string;
}
export interface EvidenceInspection {
    schemaVersion: 1;
    kind: 'evidence-inspection';
    state: 'verified' | 'contradicted' | 'missing' | 'inconclusive';
    sourceRevision: string;
    records: EvidenceObservation[];
    issues: EvidenceIssue[];
}
export function inspectEvidence(input: EvidenceObservation[], rawPolicy: EvidencePolicy): EvidenceInspection {
    const policy = evidencePolicySchema.parse(rawPolicy), issues: EvidenceIssue[] = [];
    const add = (code: EvidenceIssue['code'], r?: EvidenceObservation, checkId?: string) => issues.push({ code, evidenceId: r?.id, checkId, nextCheck: code === 'wrong-revision' ? 'Run the check on the expected revision.' : code === 'untrusted-producer' ? 'Supply operator-pinned statement bytes or an explicitly authenticated producer.' : `Resolve ${code} before using this check.` });
    const records = input.map(r => {
        const accepted = r.integrity === 'valid' && r.sourceRevision === policy.sourceRevision && (policy.acceptedDigests.includes(r.artifact.sha256) || r.producer.trust !== 'unattested') && (!policy.requireAuthenticatedProducer || r.producer.trust !== 'unattested');
        if (r.integrity !== 'valid')
            add(r.integrity === 'unsupported' ? 'unsupported-schema' : r.integrity === 'unavailable' ? 'unavailable-evidence' : 'invalid-integrity', r);
        if (r.sourceRevision !== policy.sourceRevision)
            add('wrong-revision', r);
        if (!accepted && r.integrity === 'valid' && r.sourceRevision === policy.sourceRevision)
            add('untrusted-producer', r);
        return { ...r, accepted };
    });
    let contradicted = false, missing = false, inconclusive = false;
    for (const checkId of policy.requiredChecks) {
        const candidates = records.filter(r => r.checks.some(c => c.id === checkId));
        const checks = candidates.filter(r => r.accepted).flatMap(r => r.checks.filter(c => c.id === checkId));
        if (checks.some(c => c.outcome === 'failed')) {
            contradicted = true;
            add('contradicted-check', undefined, checkId);
        }
        else if (checks.some(c => c.outcome === 'inconclusive')) {
            inconclusive = true;
            add('inconclusive-check', undefined, checkId);
        }
        else if (!checks.some(c => c.outcome === 'passed')) {
            if (candidates.length && candidates.some(r => r.integrity !== 'valid' || r.sourceRevision === policy.sourceRevision && !r.accepted)) {
                inconclusive = true;
            }
            else {
                missing = true;
                add('missing-check', undefined, checkId);
            }
        }
    }
    return { schemaVersion: 1, kind: 'evidence-inspection', state: contradicted ? 'contradicted' : missing ? 'missing' : inconclusive ? 'inconclusive' : 'verified', sourceRevision: policy.sourceRevision, records, issues };
}
export const evidenceExitCode = (state: EvidenceInspection['state']): 0 | 1 | 2 => state === 'verified' ? 0 : state === 'contradicted' ? 1 : 2;
