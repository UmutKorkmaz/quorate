import { Command } from 'commander';
import { resolve } from 'node:path';
import { adjudicateFindings, evidenceExitCode, type CouncilReport, type FindingAdjudicationReport, type EvidenceInspection } from '@quorate/core';
import { readEvidenceJson, inspectEvidenceBundle } from '../evidence/bundle.js';
import { evidenceCommandFailure } from '../evidence/command.js';
export function runFindingAdjudication(options: {
    cwd: string;
    report: string;
    attachments: string;
    evidence: string;
    policy: string;
}): FindingAdjudicationReport & {
    evidence: EvidenceInspection;
} {
    const evidence = inspectEvidenceBundle({ root: options.cwd, bundle: options.evidence, policy: readEvidenceJson(options.cwd, options.policy) });
    const result = adjudicateFindings({ report: readEvidenceJson(options.cwd, options.report) as CouncilReport, attachments: readEvidenceJson(options.cwd, options.attachments), evidence });
    const state = result.state === 'contradicted' || evidence.state === 'contradicted' ? 'contradicted' : result.state === 'missing' || evidence.state === 'missing' ? 'missing' : result.state === 'inconclusive' || evidence.state === 'inconclusive' ? 'inconclusive' : 'verified';
    return { ...result, state, evidence };
}
export function registerAdjudicationCommands(program: Command): void {
    program.command('adjudication').description('Inspect exact report-bound evidence without changing human feedback labels.').command('check').requiredOption('--report <path>', 'Exact saved council report').requiredOption('--attachments <path>', 'Explicit report/finding-bound attachments').requiredOption('--evidence <directory>', 'Portable evidence bundle').requiredOption('--policy <path>', 'Operator evidence policy').option('--json', 'Print structured adjudication report').action(options => { try {
        const result = runFindingAdjudication({ ...options, cwd: resolve(program.optsWithGlobals().cwd ?? process.env.INIT_CWD ?? process.cwd()) });
        console.log(options.json ? JSON.stringify(result) : `${result.state}; review ${result.reviewId}; revision ${result.sourceRevision}\n${result.findings.map(f => `${f.fingerprint}: ${f.state}`).join('\n')}`);
        process.exitCode = evidenceExitCode(result.state);
    }
    catch (error) {
        evidenceCommandFailure(error);
    } });
}
