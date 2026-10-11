import { z } from 'zod';
import { fingerprintFinding } from '../identity.js';
import { evidenceDigest, evidenceCanonical, type EvidenceInspection } from '../evidence/index.js';
import type { CouncilReport, Finding } from '../types.js';
const attachmentSchema = z.object({ reviewId: z.string().min(1).max(160), reportGeneratedAt: z.string().datetime(), reportHash: z.string().regex(/^[a-f0-9]{64}$/), fingerprint: z.string().regex(/^[a-f0-9]{16}$/), evidenceId: z.string().min(1).max(160), checkId: z.string().min(1).max(160) }).strict();
export const adjudicationAttachmentSchema = z.object({ schemaVersion: z.literal(1), sourceRevision: z.string().regex(/^[a-f0-9]{40,64}$/), attachments: z.array(attachmentSchema).max(256) }).strict();
export type FindingEvidenceAttachment = z.infer<typeof attachmentSchema>;
export interface AdjudicatedFinding {
    fingerprint: string;
    finding: Finding;
    state: 'supported' | 'contradicted' | 'unverified';
    evidenceIds: string[];
    issues: string[];
}
export interface FindingAdjudicationReport {
    schemaVersion: 1;
    kind: 'finding-adjudication';
    reviewId: string;
    reportHash: string;
    sourceRevision: string;
    state: 'verified' | 'contradicted' | 'missing' | 'inconclusive';
    report: CouncilReport;
    findings: AdjudicatedFinding[];
    issues: string[];
}
/** Attachments share the exact report hash used by existing human feedback; labels are never modified. */
export function adjudicateFindings(options: {
    report: CouncilReport;
    attachments: unknown;
    evidence: EvidenceInspection;
}): FindingAdjudicationReport {
    const report = options.report;
    const reportHash = evidenceDigest(JSON.stringify(report));
    if (Buffer.byteLength(evidenceCanonical(report)) > 4 * 1024 * 1024)
        throw new Error('Adjudication report exceeds bound');
    const reportSchema = z.object({ findings: z.array(z.object({ severity: z.enum(['critical', 'high', 'medium', 'low', 'info']), title: z.string().min(1).max(8192), body: z.string().max(65536), file: z.string().max(8192).optional(), fingerprint: z.string().regex(/^[a-f0-9]{16}$/), providerId: z.string().optional(), agreedBy: z.array(z.string()).max(256).optional() }).passthrough()).max(256), providerResults: z.array(z.unknown()).max(256), metadata: z.object({ reviewId: z.string().min(1).max(160), generatedAt: z.string().datetime() }).passthrough() }).passthrough();
    reportSchema.parse(report);
    const fingerprints = report.findings.map(f => f.fingerprint!);
    if (new Set(fingerprints).size !== fingerprints.length || report.findings.some(f => fingerprintFinding(f) !== f.fingerprint))
        throw new Error('Ambiguous or altered finding identity');
    const manifest = adjudicationAttachmentSchema.parse(options.attachments), unique = new Set<string>();
    for (const a of manifest.attachments) {
        if (a.reviewId !== report.metadata.reviewId || a.reportGeneratedAt !== report.metadata.generatedAt || a.reportHash !== reportHash || !fingerprints.includes(a.fingerprint))
            throw new Error('Attachment report/finding identity mismatch');
        const key = JSON.stringify([a.fingerprint, a.evidenceId, a.checkId]);
        if (unique.has(key))
            throw new Error('Duplicate finding attachment');
        unique.add(key);
    }
    const issues: string[] = [];
    if (manifest.sourceRevision !== options.evidence.sourceRevision)
        issues.push('implementation-revision-mismatch');
    const findings = report.findings.map(finding => {
        const fingerprint = finding.fingerprint!, attachments = manifest.attachments.filter(a => a.fingerprint === fingerprint), observations = attachments.flatMap(a => {
            const r = options.evidence.records.find(r => r.id === a.evidenceId);
            return r && r.accepted && r.integrity === 'valid' && r.sourceRevision === manifest.sourceRevision && options.evidence.sourceRevision === manifest.sourceRevision ? r.checks.filter(c => c.id === a.checkId && c.requirements.includes(`finding:${fingerprint}`)).map(c => ({ ...c, evidenceId: r.id })) : [];
        });
        const state: AdjudicatedFinding['state'] = observations.some(c => c.outcome === 'failed') ? 'contradicted' : observations.some(c => c.outcome === 'passed') ? 'supported' : 'unverified';
        return { fingerprint, finding, state, evidenceIds: [...new Set(observations.map(c => c.evidenceId))], issues: state === 'unverified' ? ['No accepted, revision-bound evidence covering this finding.'] : [] };
    });
    return { schemaVersion: 1, kind: 'finding-adjudication', reviewId: report.metadata.reviewId!, reportHash, sourceRevision: manifest.sourceRevision, state: findings.some(f => f.state === 'contradicted') ? 'contradicted' : findings.some(f => f.state === 'unverified') ? 'missing' : issues.length ? 'inconclusive' : 'verified', report, findings, issues };
}
