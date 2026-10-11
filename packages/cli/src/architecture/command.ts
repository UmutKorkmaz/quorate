import type { Command } from 'commander';
import { resolve } from 'node:path';
import { analyzeArchitecture, ARCHITECTURE_IMPORT_LIMIT, parseArchitecturePolicy, parseDependencyCruiser } from '@quorate/core';
import { printAuditFailure, readAuditFile } from './read.js';
export function registerArchitectureCommands(program: Command): void {
    const cwd = () => resolve(program.optsWithGlobals().cwd ?? process.cwd());
    const register = (command: Command) => command.requiredOption('--input <path>', 'Explicit dependency-cruiser revision envelope').requiredOption('--subject <sha>', 'Expected full subject revision').option('--baseline <path>', 'Explicit base revision envelope').option('--base <sha>', 'Expected full baseline revision').option('--policy <path>', 'Explicit architecture policy JSON; report only').option('--changed <paths>', 'Comma-separated changed paths').option('--json', 'Print versioned deterministic JSON').action((options) => {
        try {
            if (Boolean(options.baseline) !== Boolean(options.base))
                throw new Error('Baseline and base must be provided together');
            const subject = parseDependencyCruiser(readAuditFile(cwd(), options.input, ARCHITECTURE_IMPORT_LIMIT)), baseline = options.baseline ? parseDependencyCruiser(readAuditFile(cwd(), options.baseline, ARCHITECTURE_IMPORT_LIMIT)) : undefined, policy = options.policy ? parseArchitecturePolicy(readAuditFile(cwd(), options.policy, 1024 * 1024)) : undefined;
            const report = analyzeArchitecture({ subject, subjectRevision: options.subject, baseline, baseRevision: options.base, policy, changed: options.changed?.split(',').map((path: string) => path.trim()) });
            console.log(options.json ? JSON.stringify(report) : `Architecture ${report.complete ? 'complete' : 'incomplete'}; ${report.newViolations.length} new violation(s), ${report.unknown.length} unknown relationship(s). Recommended checks: ${report.impact.recommendedChecks.join(', ') || 'none mapped'}. Existing CI remains enabled.`);
            process.exitCode = report.exitCode;
        }
        catch {
            printAuditFailure(Boolean(options.json));
        }
    });
    register(program.command('arch').description('Inspect explicitly imported architecture evidence.').command('check').description('Compare boundaries, cycles and layers to an explicit baseline.'));
    register(program.command('impact').description('Recommend configured consumer checks from an explicit dependency import; never execute or skip CI.'));
}
