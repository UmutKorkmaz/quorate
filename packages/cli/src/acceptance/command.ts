import { Command } from 'commander';
import { resolve, isAbsolute, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkAcceptance, evidencePolicySchema, evidenceExitCode, type AcceptanceFormat, type AcceptanceReport, type EvidenceInspection } from '@quorate/core';
import { inspectEvidenceBundle, readEvidenceBytes, readEvidenceJson } from '../evidence/bundle.js';
import { evidenceCommandFailure } from '../evidence/command.js';
import { isolatedGitEnvironment } from '../git-environment.js';
export interface AcceptanceCommandOptions {
    cwd: string;
    spec: string;
    mapping: string;
    evidence: string;
    policy: string;
    format?: AcceptanceFormat;
    base?: string;
}
export interface AcceptanceCommandReport extends AcceptanceReport {
    evidence: EvidenceInspection;
    trustedBaseRevision?: string;
}
function gitRead(cwd: string, args: string[], bound = 4 * 1024 * 1024): string { const r = spawnSync('git', args, { cwd, env: isolatedGitEnvironment(), encoding: 'utf8', shell: false, maxBuffer: bound, timeout: 10000 }); if (r.status !== 0 || r.error)
    throw new Error('Trusted Git input unavailable'); return r.stdout; }
function gitCommit(cwd: string, ref: string): string { const sha = gitRead(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim(); if (!/^[a-f0-9]{40,64}$/.test(sha))
    throw new Error('Invalid trusted base revision'); return sha; }
function baseFile(cwd: string, sha: string, path: string): string { if (!path || isAbsolute(path) || win32.isAbsolute(path) || path.includes('\\') || path.includes(':') || path.split('/').some(p => !p || p === '.' || p === '..'))
    throw new Error('Trusted base paths must be repository relative'); return gitRead(cwd, ['show', `${sha}:${path}`]); }
export function runAcceptanceCheck(options: AcceptanceCommandOptions): AcceptanceCommandReport {
    const spec = readEvidenceBytes(options.cwd, options.spec, 1024 * 1024).toString('utf8'), mapping = readEvidenceJson(options.cwd, options.mapping);
    let policy = options.base ? undefined : readEvidenceJson(options.cwd, options.policy), trustedBase: {
        spec: string;
        mapping: unknown;
    } | undefined, trustedBaseRevision: string | undefined;
    if (options.base) {
        trustedBaseRevision = gitCommit(options.cwd, options.base);
        const current = gitCommit(options.cwd, 'HEAD');
        trustedBase = { spec: baseFile(options.cwd, trustedBaseRevision, options.spec), mapping: JSON.parse(baseFile(options.cwd, trustedBaseRevision, options.mapping)) };
        const trustedPolicy = evidencePolicySchema.parse(JSON.parse(baseFile(options.cwd, trustedBaseRevision, options.policy)));
        policy = { ...trustedPolicy, sourceRevision: current };
        if ((mapping as {
            sourceRevision?: unknown;
        })?.sourceRevision !== undefined && (mapping as {
            sourceRevision?: unknown;
        }).sourceRevision !== current)
            throw new Error('Candidate mapping does not bind current HEAD');
    }
    const evidence = inspectEvidenceBundle({ root: options.cwd, bundle: options.evidence, policy }), result = checkAcceptance({ spec, mapping, evidence, format: options.format, trustedBase });
    // Required base policy checks remain a gate even if no criterion currently maps them.
    const state = result.state === 'contradicted' || evidence.state === 'contradicted' ? 'contradicted' : result.state === 'missing' || evidence.state === 'missing' ? 'missing' : result.state === 'inconclusive' || evidence.state === 'inconclusive' ? 'inconclusive' : 'verified';
    return { ...result, state, evidence, trustedBaseRevision };
}
export function registerAcceptanceCommands(program: Command): void {
    program.command('acceptance').description('Bind explicit criteria to accepted evidence.').command('check').requiredOption('--spec <path>', 'Explicit criteria file').requiredOption('--mapping <path>', 'User-maintained check mapping').requiredOption('--evidence <directory>', 'Portable bundle directory').requiredOption('--policy <path>', 'Operator evidence policy').option('--format <format>', 'markdown, openspec or speckit', 'markdown').option('--base <revision>', 'Read trusted criteria, mapping and policy at this immutable Git revision').option('--json', 'Print structured report').action(options => { try {
        const result = runAcceptanceCheck({ ...options, cwd: resolve(program.optsWithGlobals().cwd ?? process.env.INIT_CWD ?? process.cwd()) });
        console.log(options.json ? JSON.stringify(result) : `${result.state}; spec ${result.specDigest}; revision ${result.sourceRevision}\n${result.criteria.map(c => `${c.id}: ${c.state}`).join('\n')}`);
        process.exitCode = evidenceExitCode(result.state);
    }
    catch (error) {
        evidenceCommandFailure(error);
    } });
}
