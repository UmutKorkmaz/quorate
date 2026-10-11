import { Command } from 'commander';
import { resolve } from 'node:path';
import { z } from 'zod';
import { evidenceExitCode } from '@quorate/core';
import { exportEvidenceBundle, inspectEvidenceBundle, readEvidenceJson } from './bundle.js';
export function evidenceCommandFailure(error: unknown): void { console.error(`Evidence input rejected: ${error instanceof Error ? error.message : 'invalid input'}`); process.exitCode = 2; }
export function registerEvidenceCommands(program: Command): void {
    const command = program.command('evidence').description('Export selected portable JSON evidence and explain policy blockers without executing imports.');
    const cwd = () => resolve(program.optsWithGlobals().cwd ?? process.env.INIT_CWD ?? process.cwd());
    command.command('export').requiredOption('--manifest <path>', 'Explicit selected artifact manifest').requiredOption('--output <directory>', 'New root-relative output directory').option('--json', 'Print bundle manifest JSON').action(options => { try {
        const manifest = z.object({ schemaVersion: z.literal(1), inputs: z.array(z.object({ id: z.string(), path: z.string(), references: z.array(z.string()).optional() }).strict()).min(1).max(256) }).strict().parse(readEvidenceJson(cwd(), options.manifest));
        const result = exportEvidenceBundle({ root: cwd(), output: options.output, inputs: manifest.inputs });
        console.log(options.json ? JSON.stringify(result) : `Exported ${result.records.length} selected artifact(s) to ${options.output}. Producer authentication requires explicit signer policy.`);
        process.exitCode = 0;
    }
    catch (error) {
        evidenceCommandFailure(error);
    } });
    command.command('inspect').requiredOption('--bundle <directory>', 'Root-relative bundle directory').requiredOption('--policy <path>', 'Explicit operator policy').option('--json', 'Print structured inspection').action(options => { try {
        const result = inspectEvidenceBundle({ root: cwd(), bundle: options.bundle, policy: readEvidenceJson(cwd(), options.policy) });
        console.log(options.json ? JSON.stringify(result) : `${result.state}; revision ${result.sourceRevision}\n${result.issues.map(i => `${i.code}: ${i.nextCheck}`).join('\n')}`);
        process.exitCode = evidenceExitCode(result.state);
    }
    catch (error) {
        evidenceCommandFailure(error);
    } });
}
