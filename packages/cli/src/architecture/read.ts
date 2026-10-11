import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
/** Bounded explicit project import. No discovery, execution or file writes. */
export function readAuditFile(cwd: string, inputPath: string, limit: number): string {
    const root = realpathSync(cwd), candidate = resolve(root, inputPath), lexical = relative(root, candidate);
    if (!lexical || isAbsolute(lexical) || lexical === '..' || lexical.startsWith('../') || lexical.startsWith('..\\'))
        throw new Error('Import path escapes selected directory');
    const path = realpathSync(candidate), actual = relative(root, path);
    if (isAbsolute(actual) || actual === '..' || actual.startsWith('../') || actual.startsWith('..\\'))
        throw new Error('Import symlink escapes selected directory');
    const expected = statSync(path);
    if (!expected.isFile() || expected.size > limit)
        throw new Error('Invalid import type or size');
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.size > limit || opened.dev !== expected.dev || opened.ino !== expected.ino)
            throw new Error('Import changed while opening');
        const bytes = readFileSync(fd);
        if (bytes.length > limit)
            throw new Error('Import exceeds size limit');
        return bytes.toString('utf8');
    }
    finally {
        closeSync(fd);
    }
}
export function printAuditFailure(json: boolean): void { const report = { version: 1, mode: 'read-only', exitCode: 2, error: { code: 'invalid-input', message: 'Explicit inputs are missing, invalid, stale, oversized or outside the selected working directory.' } }; console.log(json ? JSON.stringify(report) : report.error.message); process.exitCode = 2; }
