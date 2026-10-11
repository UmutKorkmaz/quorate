import type { Command } from 'commander';
import { resolve } from 'node:path';
import { auditRules, parseRulesAuditManifest, RULES_AUDIT_LIMIT } from '@quorate/core';
import { printAuditFailure, readAuditFile } from '../architecture/read.js';
export function registerRulesCommands(program: Command): void {
    program.command('rules').description('Audit explicitly selected agent configuration without executing it.').command('doctor').requiredOption('--manifest <path>', 'Explicit versioned file selection and installed tool versions').option('--json', 'Print deterministic versioned JSON').action((options) => {
        const cwd = resolve(program.optsWithGlobals().cwd ?? process.cwd());
        try {
            const manifest = parseRulesAuditManifest(readAuditFile(cwd, options.manifest, RULES_AUDIT_LIMIT)), files = manifest.files.map(file => { let content: string | undefined; try {
                content = readAuditFile(cwd, file.path, RULES_AUDIT_LIMIT);
            }
            catch { /* A missing or rejected selected source is invalid evidence in the report. */ } return { ...file, content }; });
            const report = auditRules({ ...manifest, files });
            console.log(options.json ? JSON.stringify(report) : `Rules audit ${report.complete ? 'complete' : 'incomplete'}; ${report.findings.length} finding(s). Native enforcement: unverified. Configuration was not changed.`);
            process.exitCode = report.exitCode;
        }
        catch {
            printAuditFailure(Boolean(options.json));
        }
    });
}
