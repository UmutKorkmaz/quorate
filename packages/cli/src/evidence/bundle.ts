import { createPublicKey, verify } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute, win32 } from 'node:path';
import { z } from 'zod';
import { evidenceCanonical, evidenceDigest, evidenceCheckSchema, evidencePolicySchema, validateEvidenceBundle, inspectEvidence, MAX_EVIDENCE_ARTIFACT_BYTES, MAX_EVIDENCE_MANIFEST_BYTES, MAX_EVIDENCE_BUNDLE_BYTES, MAX_EVIDENCE_RECORDS, validateDecisionRecord, type EvidenceBundle, type EvidenceRecord, type EvidenceObservation, type EvidenceInspection, type EvidencePolicy } from '@quorate/core';
import { writeSecureWorkspaceState } from '../secure-state.js';
import { validateContractArtifact } from '../contract-command.js';
import { validateRegressionReportContent } from '../regression/report.js';
import { validateProofArtifactContent } from '../proof-runner.js';
import { validateReleaseReport } from '../release/report.js';
import { validateDocsReport } from '../docs-check/report.js';
const sha = z.string().regex(/^[a-f0-9]{64}$/), rev = z.string().regex(/^[a-f0-9]{40,64}$/);
const checkObservation = z.object({ schemaVersion: z.literal(1), kind: z.literal('check-observation'), sourceRevision: rev, subjectDigest: sha, producer: z.object({ id: z.string().min(1).max(160) }).passthrough(), checks: z.array(evidenceCheckSchema).min(1).max(256) }).passthrough();
const proofOutput = z.object({ text: z.string().max(MAX_EVIDENCE_ARTIFACT_BYTES), truncated: z.boolean() }).strict();
const proofSchema = z.object({ schemaVersion: z.literal(1), name: z.string().min(1).max(160), command: z.array(z.string().max(8192)).min(1).max(256), cwd: z.string().max(8192), startedAt: z.string().datetime(), finishedAt: z.string().datetime(), durationMs: z.number().nonnegative(), exitCode: z.number().int(), timedOut: z.boolean(), fingerprint: z.object({ gitHead: rev.nullable(), worktreeHash: sha }).strict(), stdout: proofOutput, stderr: proofOutput, markdownHash: sha, artifactHash: sha, signature: sha, steps: z.array(z.unknown()).max(256).optional() }).strict();
export interface EvidenceInput {
    id: string;
    path: string;
    references?: string[];
}
export function evidenceSafePath(root: string, path: string): string {
    if (!path || isAbsolute(path) || win32.isAbsolute(path) || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..'))
        throw new Error('Unsafe evidence path');
    const base = resolve(root);
    const st = lstatSync(base);
    if (!st.isDirectory() || st.isSymbolicLink())
        throw new Error('Evidence root must be a real directory');
    let current = realpathSync(base);
    for (const part of path.split('/')) {
        current = join(current, part);
        const info = lstatSync(current);
        if (info.isSymbolicLink())
            throw new Error('Evidence symlink rejected');
    }
    return current;
}
interface EvidenceReadBudget { remainingBytes: number; }
export function readEvidenceBytes(root: string, path: string, maxBytes = MAX_EVIDENCE_ARTIFACT_BYTES, budget?: EvidenceReadBudget): Buffer {
    maxBytes = Math.min(maxBytes, budget?.remainingBytes ?? maxBytes);
    const filename = evidenceSafePath(root, path), before = lstatSync(filename);
    if (!before.isFile() || before.size > maxBytes)
        throw new Error('Evidence must be a bounded regular file');
    const directories: Array<{
        path: string;
        dev: number;
        ino: number;
    }> = [];
    let directory = dirname(filename);
    const base = realpathSync(root);
    while (true) {
        const stat = lstatSync(directory);
        directories.push({ path: directory, dev: stat.dev, ino: stat.ino });
        if (directory === base)
            break;
        const parent = dirname(directory);
        if (parent === directory)
            throw new Error('Evidence escaped root');
        directory = parent;
    }
    const revalidate = () => { for (const d of directories) {
        const stat = lstatSync(d.path);
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== d.dev || stat.ino !== d.ino)
            throw new Error('Evidence directory changed');
    } evidenceSafePath(root, path); };
    revalidate();
    const fd = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const info = fstatSync(fd);
        if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || info.size > maxBytes)
            throw new Error('Evidence changed during read');
        const bytes = Buffer.alloc(info.size + 1);
        let n = 0;
        while (n < bytes.length && n < maxBytes) {
            // The safety byte for growth detection must also fit the allowance.
            // fstat below still rejects growth when the initial file fills it.
            const count = readSync(fd, bytes, n, Math.min(bytes.length - n, maxBytes - n), null);
            if (budget)
                budget.remainingBytes -= count;
            if (!count)
                break;
            n += count;
        }
        const after = fstatSync(fd);
        if (n !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs)
            throw new Error('Evidence size changed');
        revalidate();
        const current = lstatSync(filename);
        if (current.dev !== info.dev || current.ino !== info.ino)
            throw new Error('Evidence file replaced');
        return bytes.subarray(0, n);
    }
    finally {
        closeSync(fd);
    }
}
export function readEvidenceJson(root: string, path: string, maxBytes = MAX_EVIDENCE_ARTIFACT_BYTES): unknown { const result = JSON.parse(readEvidenceBytes(root, path, maxBytes).toString('utf8')); evidenceCanonical(result); return result; }
type Derived = Pick<EvidenceRecord, 'kind' | 'schemaVersion' | 'sourceRevision' | 'subjectDigest' | 'producer' | 'checks'> & {
    integrity: EvidenceObservation['integrity'];
};
function derive(value: unknown): Derived {
    evidenceCanonical(value);
    const raw = value as Record<string, unknown>, unsupported = (): Derived => ({ kind: typeof raw?.kind === 'string' ? raw.kind : 'unsupported', schemaVersion: typeof raw?.schemaVersion === 'number' && raw.schemaVersion > 0 ? raw.schemaVersion : 1, sourceRevision: null, subjectDigest: evidenceDigest(evidenceCanonical(value)), producer: { id: 'unknown', trust: 'unattested' }, checks: [], integrity: 'unsupported' });
    if (!raw || typeof raw !== 'object')
        return unsupported();
    if (raw.kind === 'quorate-proof-attestation-v1') {
        const envelope = z.object({ kind: z.literal('quorate-proof-attestation-v1'), payload: z.string().max(MAX_EVIDENCE_ARTIFACT_BYTES), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict().parse(value);
        const nested = derive(JSON.parse(envelope.payload));
        if (nested.kind !== 'proof' || nested.integrity !== 'valid')
            throw new Error('Invalid portable proof payload');
        return { ...nested, kind: 'portable-proof' };
    }
    if (raw.kind === 'check-observation') {
        const v = checkObservation.parse(value);
        return { ...v, producer: { id: v.producer.id, trust: 'unattested' }, integrity: 'valid' };
    }
    if (raw.kind === 'release-verification' && raw.schemaVersion === 1) {
        const v = validateReleaseReport(value);
        return { kind: v.kind, schemaVersion: 1, sourceRevision: v.sourceRevision, subjectDigest: v.subjectDigest, producer: { id: v.producer.id, trust: 'unattested' }, checks: v.destinations.flatMap(d => d.checks.map(c => ({ ...c, id: `${d.id}:${c.id}`, requirements: [] }))), integrity: 'valid' };
    }
    if (raw.kind === 'docs-check' && raw.schemaVersion === 1) {
        const v = validateDocsReport(value);
        return { kind: v.kind, schemaVersion: 1, sourceRevision: v.sourceRevision, subjectDigest: v.subjectDigest, producer: { id: v.producer.id, trust: 'unattested' }, checks: v.checks.map(c => ({ id: c.id, outcome: v.freshness.state === 'current' ? c.outcome : 'inconclusive', requirements: [] })), integrity: 'valid' };
    }
    if (raw.kind === 'regression' && raw.schemaVersion === 1) {
        const v = validateRegressionReportContent(value);
        return { kind: 'regression', schemaVersion: 1, sourceRevision: v.headSha, subjectDigest: v.bundleDigest, producer: { id: v.producer, trust: 'unattested' }, checks: [{ id: v.id, outcome: v.decision.state === 'verified' ? 'passed' : v.decision.state === 'contradicted' ? 'failed' : 'inconclusive', requirements: [] }], integrity: 'valid' };
    }
    if (raw.schema === 1 && raw.verdict !== undefined) {
        const v = validateContractArtifact(value);
        if (!v)
            throw new Error('Invalid contract artifact');
        return { kind: 'contract', schemaVersion: 1, sourceRevision: /^[a-f0-9]{40,64}$/.test(v.after.label) ? v.after.label : null, subjectDigest: v.after.hash, producer: { id: 'quorate-local', trust: 'unattested' }, checks: [{ id: 'contract', outcome: v.verdict === 'pass' ? 'passed' : v.verdict === 'block' ? 'failed' : 'inconclusive', requirements: [] }], integrity: 'valid' };
    }
    if (raw.integrity !== undefined && raw.inputs !== undefined) {
        if (!validateDecisionRecord(value))
            throw new Error('Invalid decision receipt');
        return { kind: 'receipt', schemaVersion: 1, sourceRevision: value.source.headSha ?? null, subjectDigest: value.inputs.diffHash, producer: { id: 'quorate-local', trust: 'unattested' }, checks: [{ id: 'receipt', outcome: value.gate.blocked ? 'failed' : value.coverage.limitations.length ? 'inconclusive' : 'passed', requirements: [] }], integrity: 'valid' };
    }
    if (raw.schemaVersion === 1 && raw.command !== undefined) {
        const v = proofSchema.parse(value), { signature: _signature, artifactHash, ...body } = v;
        if (evidenceDigest(evidenceCanonical(body)) !== artifactHash || !validateProofArtifactContent(v))
            throw new Error('Invalid proof integrity');
        if (v.steps) {
            if (!v.steps.length)
                throw new Error('Empty proof suite');
            const children = v.steps.map(step => derive(step));
            if (children.some(c => c.kind !== 'proof' || c.integrity !== 'valid'))
                throw new Error('Invalid proof suite step');
            const status = children.flatMap(c => c.checks);
            if (v.exitCode === 0 && status.some(c => c.outcome === 'failed') || !v.timedOut && v.steps.some(step => (step as {
                timedOut?: unknown;
            }).timedOut === true))
                throw new Error('Inconsistent proof suite');
        }
        // Preserve original HMAC and Markdown digest bytes; a content check does not authenticate them.
        const incomplete = v.timedOut || v.stdout.truncated || v.stderr.truncated;
        return { kind: 'proof', schemaVersion: 1, sourceRevision: v.fingerprint.gitHead, subjectDigest: v.fingerprint.worktreeHash, producer: { id: 'quorate-local', trust: 'unattested' }, checks: [{ id: v.name, outcome: incomplete ? 'inconclusive' : v.exitCode === 0 ? 'passed' : 'failed', requirements: [] }], integrity: 'valid' };
    }
    if (Array.isArray(value)) {
        const audit = z.array(z.object({ schemaVersion: z.literal(1), sequence: z.number().int().positive(), requestId: z.string().min(1).max(160), runId: z.string().max(160), source: z.string().max(160), tool: z.string().max(8192), decision: z.enum(['allow', 'deny', 'timeout']), reasonCode: z.string().max(160).optional(), decisionSurface: z.string().max(160), timestamp: z.string().datetime({ offset: true }) }).strict()).max(256).parse(value);
        return { kind: 'audit-export', schemaVersion: 1, sourceRevision: null, subjectDigest: evidenceDigest(evidenceCanonical(audit)), producer: { id: 'quorate-local', trust: 'unattested' }, checks: [{ id: 'audit', outcome: 'inconclusive', requirements: [] }], integrity: 'valid' };
    }
    return unsupported();
}
interface EvidenceDirectoryIdentity { path: string; dev: number; ino: number; }
function evidenceDirectoryIdentity(path: string): EvidenceDirectoryIdentity {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Evidence export directory is not a real directory');
    return { path, dev: stat.dev, ino: stat.ino };
}
function assertEvidenceDirectories(directories: EvidenceDirectoryIdentity[]): void {
    for (const expected of directories) {
        const current = evidenceDirectoryIdentity(expected.path);
        if (current.dev !== expected.dev || current.ino !== expected.ino)
            throw new Error('Evidence export directory changed');
    }
}
export function exportEvidenceBundle(options: {
    root: string;
    output: string;
    inputs: EvidenceInput[];
}): EvidenceBundle {
    const selectedRoot = evidenceDirectoryIdentity(resolve(options.root));
    const canonicalRoot = realpathSync(selectedRoot.path);
    const rootIdentity = evidenceDirectoryIdentity(canonicalRoot);
    if (rootIdentity.dev !== selectedRoot.dev || rootIdentity.ino !== selectedRoot.ino)
        throw new Error('Evidence export root changed');
    const inputs = z.array(z.object({ id: z.string().min(1).max(160), path: z.string().min(1).max(8192), references: z.array(z.string()).max(256).optional() }).strict()).min(1).max(MAX_EVIDENCE_RECORDS).parse(options.inputs);
    const budget = { remainingBytes: MAX_EVIDENCE_BUNDLE_BYTES };
    const artifacts = new Map<string, Buffer>(), records = inputs.map(input => { const bytes = readEvidenceBytes(options.root, input.path, MAX_EVIDENCE_ARTIFACT_BYTES, budget); if (!Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes))
        throw new Error('Evidence must be UTF-8 JSON'); const hash = evidenceDigest(bytes), v = derive(JSON.parse(bytes.toString('utf8'))); artifacts.set(hash, bytes); return { id: input.id, kind: v.kind, schemaVersion: v.schemaVersion, sourceRevision: v.sourceRevision, subjectDigest: v.subjectDigest, producer: v.producer, checks: v.checks.length ? v.checks : [{ id: input.id, outcome: 'inconclusive' as const, requirements: [] }], artifact: { path: `artifacts/${hash}.json`, sha256: hash, bytes: bytes.length }, references: input.references ?? [] }; });
    const bundle = validateEvidenceBundle({ schemaVersion: 1, kind: 'quorate-evidence-bundle', records });
    const manifestContent = JSON.stringify(bundle, null, 2) + '\n';
    if (Buffer.byteLength(manifestContent, 'utf8') > MAX_EVIDENCE_MANIFEST_BYTES)
        throw new Error('Evidence manifest byte limit exceeded');
    const output = options.output;
    if (!output || output.includes('\\') || isAbsolute(output) || win32.isAbsolute(output) || output.split('/').some(p => !p || p === '.' || p === '..'))
        throw new Error('Unsafe evidence output');
    const directories = [rootIdentity];
    let parent = canonicalRoot;
    for (const part of output.split('/').slice(0, -1)) {
        parent = join(parent, part);
        directories.push(evidenceDirectoryIdentity(parent));
    }
    const destination = join(canonicalRoot, output);
    assertEvidenceDirectories(directories);
    mkdirSync(destination, { mode: 0o700 });
    assertEvidenceDirectories(directories);
    directories.push(evidenceDirectoryIdentity(destination));
    assertEvidenceDirectories(directories);
    const artifactDirectory = join(destination, 'artifacts');
    mkdirSync(artifactDirectory, { mode: 0o700 });
    assertEvidenceDirectories(directories);
    directories.push(evidenceDirectoryIdentity(artifactDirectory));
    const publish = (target: string, content: string): void => {
        assertEvidenceDirectories(directories);
        // Keep the original root as the trust boundary. The newly created output
        // directory must never become a fresh root after an ancestor swap.
        writeSecureWorkspaceState(canonicalRoot, `${output}/${target}`, content, {
            expectedWorkspaceIdentity: { dev: rootIdentity.dev, ino: rootIdentity.ino },
            preserveExistingDirectoryModes: true,
            refuseExistingDestination: true
        });
        assertEvidenceDirectories(directories);
    };
    for (const [hash, bytes] of artifacts)
        publish(`artifacts/${hash}.json`, bytes.toString('utf8'));
    publish('manifest.json', manifestContent);
    return bundle;
}
export function inspectEvidenceBundle(options: {
    root: string;
    bundle: string;
    policy: EvidencePolicy | unknown;
}): EvidenceInspection {
    const bundleRoot = evidenceSafePath(options.root, options.bundle), bundle = validateEvidenceBundle(readEvidenceJson(bundleRoot, 'manifest.json', MAX_EVIDENCE_MANIFEST_BYTES)), policy = evidencePolicySchema.parse(options.policy);
    const budget = { remainingBytes: MAX_EVIDENCE_BUNDLE_BYTES };
    const observations: EvidenceObservation[] = bundle.records.map(record => {
        try {
            // A declared length is only an upper bound for the read, never a claim
            // of bytes already consumed. Every actual read charges the shared budget,
            // including reads that later fail integrity or race checks.
            const bytes = readEvidenceBytes(bundleRoot, record.artifact.path, record.artifact.bytes, budget);
            if (bytes.length !== record.artifact.bytes || evidenceDigest(bytes) !== record.artifact.sha256)
                throw new Error('Artifact digest mismatch');
            const derived = derive(JSON.parse(bytes.toString('utf8')));
            const checks = derived.checks.length ? derived.checks : [{ id: record.id, outcome: 'inconclusive' as const, requirements: [] }];
            const expected = { ...record, kind: derived.kind, schemaVersion: derived.schemaVersion, sourceRevision: derived.sourceRevision, subjectDigest: derived.subjectDigest, producer: derived.producer, checks };
            if (evidenceCanonical(record) !== evidenceCanonical(expected))
                throw new Error('Manifest claims differ from artifact');
            let producer = derived.producer;
            if (derived.kind === 'portable-proof') {
                const envelope = JSON.parse(bytes.toString('utf8')) as {
                    payload: string;
                    signature: string;
                };
                for (const trusted of policy.trustedProofKeys) {
                    try {
                        const key = createPublicKey(trusted.publicKeyPem);
                        if (key.asymmetricKeyType === 'ed25519' && verify(null, Buffer.from('quorate-proof-attestation-v1\n' + envelope.payload), key, Buffer.from(envelope.signature, 'base64'))) {
                            producer = { id: trusted.id, trust: 'trusted-signer' };
                            break;
                        }
                    }
                    catch { /* Invalid or mismatched keys cannot establish trust. */ }
                }
            }
            return { ...expected, producer, integrity: derived.integrity, accepted: false };
        }
        catch (error) {
            return { ...record, producer: { id: 'unknown', trust: 'unattested' as const }, integrity: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'unavailable' as const : 'invalid' as const, accepted: false };
        }
    });
    return inspectEvidence(observations, policy);
}
