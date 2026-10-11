import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { architecturePath } from '../architecture/index.js';
export const RULES_AUDIT_LIMIT = 1024 * 1024;
const pathSchema = z.string().refine(architecturePath, 'Unsafe relative path');
const toolSchema = z.enum(['claude-code', 'cursor']);
const descriptorSchema = z.object({ tool: toolSchema, path: pathSchema, kind: z.enum(['settings', 'instructions', 'rules']), scope: z.enum(['managed', 'session', 'local', 'project', 'user']) }).strict();
const manifestSchema = z.object({ version: z.literal(1), tools: z.object({ 'claude-code': z.string().min(1).max(100).optional(), cursor: z.string().min(1).max(100).optional() }).strict(), files: z.array(descriptorSchema).min(1).max(200), generated: z.array(z.object({ path: pathSchema, expectedDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(200).optional(), translations: z.array(z.object({ source: pathSchema, targetTool: toolSchema, capability: z.enum(['advisory', 'runtime-control']) }).strict()).max(200).optional() }).strict();
export type RulesAuditManifest = z.infer<typeof manifestSchema>;
export type RulesAuditFile = RulesAuditManifest['files'][number] & {
    content?: string;
};
export type RulesAuditInput = Omit<RulesAuditManifest, 'files'> & {
    files: RulesAuditFile[];
};
export type RuleSupport = 'advisory' | 'runtime-control' | 'unsupported' | 'unknown';
export interface RuleAuditRecord {
    source: string;
    tool: 'claude-code' | 'cursor';
    installedVersion: string | null;
    versionCompatibility: 'unverified';
    digest: string | null;
    scope: RulesAuditFile['scope'];
    pathScope: string;
    precedence: string;
    support: RuleSupport;
    application: 'all-sessions' | 'matching-files' | 'agent-selected' | 'manual' | 'settings' | 'on-demand' | 'unknown';
    patterns: string[];
    capabilities: string[];
    nativeObservation: 'unverified';
}
export interface RuleAuditFinding {
    code: string;
    source: string;
    relatedSource?: string;
    severity: 'invalid' | 'incomplete' | 'conflict' | 'drift';
    message: string;
}
export interface RulesAuditReport {
    version: 1;
    mode: 'read-only';
    complete: boolean;
    exitCode: 0 | 1 | 2;
    rules: RuleAuditRecord[];
    findings: RuleAuditFinding[];
    documentationSnapshot: '2026-10-11';
    nativeObservation: 'unverified';
    sources: string[];
}
const sources = ['https://code.claude.com/docs/en/settings', 'https://code.claude.com/docs/en/memory', 'https://code.claude.com/docs/en/permissions', 'https://cursor.com/docs/rules', 'https://cursor.com/docs/cli/reference/permissions', 'https://cursor.com/docs/cli/reference/configuration'];
export const rulesContentDigest = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
export function parseRulesAuditManifest(text: string): RulesAuditManifest { if (Buffer.byteLength(text) > RULES_AUDIT_LIMIT)
    throw new Error('Manifest exceeds size limit'); return validateManifest(JSON.parse(text)); }
function validateManifest(value: unknown): RulesAuditManifest { const result = manifestSchema.parse(value); const keys = result.files.map(x => `${x.tool}:${x.path}`); if (new Set(keys).size !== keys.length)
    throw new Error('Duplicate selected source'); return result; }
function parentScope(file: RulesAuditFile): string { const marker = file.kind === 'settings' ? (file.tool === 'cursor' ? '.cursor/' : '.claude/') : (file.tool === 'cursor' ? '.cursor/rules/' : '.claude/rules/'); const index = file.path.indexOf(marker); return index >= 0 ? (file.path.slice(0, index).replace(/\/$/, '') || '.') : posix.dirname(file.path); }
function settingsLocation(file: RulesAuditFile): boolean { return file.tool === 'claude-code' ? /(^|\/)\.claude\/(settings(?:\.local)?\.json|managed-settings\.json)$/.test(file.path) || posix.basename(file.path) === 'managed-settings.json' : /(^|\/)\.cursor\/(cli\.json|cli-config\.json)$/.test(file.path); }
function permissionSupported(tool: RulesAuditFile['tool'], token: string): boolean { return tool === 'cursor' ? /^(?:Shell|Read|Write|WebFetch|Mcp)\([^\r\n()]+\)$/.test(token) : /^(?:Bash|Read|Write|Edit|WebFetch|WebSearch|Glob|Grep)(?:\([^\r\n()]+\))?$/.test(token); }
/** Remove Markdown code examples before checking instruction import references. */
function instructionProse(content: string): string {
    let fence: { character: string; length: number } | undefined;
    const prose: string[] = [];
    for (const line of content.split(/\r?\n/)) {
        const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
            if (delimiter && delimiter[1][0] === fence.character && delimiter[1].length >= fence.length && !delimiter[2].trim())
                fence = undefined;
            prose.push('');
        } else if (delimiter) {
            fence = { character: delimiter[1][0], length: delimiter[1].length };
            prose.push('');
        } else {
            prose.push(line);
        }
    }
    const text = prose.join('\n'), runs = [...text.matchAll(/`+/g)];
    const nextByLength = new Map<number, number>(), nextRun = new Map<number, number>();
    for (let index = runs.length - 1; index >= 0; index--) {
        const length = runs[index][0].length, next = nextByLength.get(length);
        if (next !== undefined)
            nextRun.set(index, next);
        nextByLength.set(length, index);
    }
    const pieces: string[] = [];
    let cursor = 0;
    for (let index = 0; index < runs.length; index++) {
        const end = nextRun.get(index);
        if (end === undefined)
            continue;
        pieces.push(text.slice(cursor, runs[index].index), ' ');
        cursor = runs[end].index! + runs[end][0].length;
        index = end;
    }
    pieces.push(text.slice(cursor));
    return pieces.join('');
}
export function auditRules(input: RulesAuditInput): RulesAuditReport {
    const manifest = validateManifest({ ...input, files: input.files.map(({ content: _, ...descriptor }) => descriptor) }), findings: RuleAuditFinding[] = [], rules: RuleAuditRecord[] = [], permissions: {
        tool: string;
        source: string;
        action: string;
        token: string;
    }[] = [];
    const finding = (code: string, source: string, severity: RuleAuditFinding['severity'], message: string, relatedSource?: string) => findings.push({ code, source, severity, message, ...(relatedSource ? { relatedSource } : {}) });
    let bytes = 0;
    for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path, 'en') || a.tool.localeCompare(b.tool, 'en'))) {
        const record: RuleAuditRecord = { source: file.path, tool: file.tool, installedVersion: manifest.tools[file.tool] ?? null, versionCompatibility: 'unverified', digest: file.content === undefined ? null : rulesContentDigest(file.content), scope: file.scope, pathScope: parentScope(file), precedence: file.tool === 'claude-code' ? 'managed > session > local > project > user; permission lists merge; deny precedes ask and allow' : 'nested AGENTS instructions combine with parent; specific directory takes precedence; CLI deny precedes allow', support: 'unknown', application: 'unknown', patterns: [], capabilities: [], nativeObservation: 'unverified' };
        rules.push(record);
        if (file.content === undefined) {
            finding('missing-file', file.path, 'invalid', 'Selected source is missing');
            continue;
        }
        bytes += Buffer.byteLength(file.content);
        if (Buffer.byteLength(file.content) > RULES_AUDIT_LIMIT || bytes > 8 * RULES_AUDIT_LIMIT) {
            finding('size-limit', file.path, 'invalid', 'Selected configuration exceeds size limit');
            continue;
        }
        if (!record.installedVersion)
            finding('installed-version-unknown', file.path, 'incomplete', 'Installed tool version was not supplied');
        if (file.kind === 'settings') {
            record.application = 'settings';
            const name = posix.basename(file.path);
            if ((name === 'settings.local.json' && file.scope !== 'local') || (name === 'managed-settings.json' && file.scope !== 'managed') || (name === 'cli-config.json' && file.scope !== 'user') || (name === 'cli.json' && file.scope !== 'project')) {
                finding('settings-scope-mismatch', file.path, 'invalid', 'Declared scope does not match the documented settings location');
                continue;
            }
            if (!settingsLocation(file)) {
                record.support = 'unsupported';
                finding('unsupported-source', file.path, 'incomplete', 'Selected path is not a documented settings location');
                continue;
            }
            let value: Record<string, unknown>;
            try {
                value = JSON.parse(file.content);
                if (!value || typeof value !== 'object' || Array.isArray(value))
                    throw new Error('Not object');
            }
            catch {
                finding('malformed-json', file.path, 'invalid', 'Settings must be a strict JSON object');
                continue;
            }
            record.support = 'runtime-control';
            const unknownKeys = Object.keys(value).filter(x => x !== 'permissions' && x !== '$schema');
            if (unknownKeys.length) {
                record.support = 'unknown';
                finding('unmapped-settings', file.path, 'incomplete', 'Settings contain capabilities outside this conservative adapter');
            }
            if (value.permissions !== undefined) {
                const p = value.permissions;
                if (!p || typeof p !== 'object' || Array.isArray(p)) {
                    record.support = 'unknown';
                    finding('malformed-permissions', file.path, 'invalid', 'Permissions must be an object');
                    continue;
                }
                for (const [key, tokens] of Object.entries(p)) {
                    if (!['allow', 'deny', ...(file.tool === 'claude-code' ? ['ask'] : [])].includes(key)) {
                        record.support = 'unknown';
                        finding('unmapped-permissions', file.path, 'incomplete', 'Permission field is outside this adapter');
                        continue;
                    }
                    if (!Array.isArray(tokens) || tokens.length > 1000 || tokens.some(x => typeof x !== 'string' || x.length > 2048)) {
                        record.support = 'unknown';
                        finding('malformed-permissions', file.path, 'invalid', 'Permission lists must contain bounded strings');
                        continue;
                    }
                    record.capabilities.push(`permissions.${key}`);
                    for (const token of tokens as string[]) {
                        if (!permissionSupported(file.tool, token)) {
                            record.support = 'unknown';
                            finding('unmapped-permission-token', file.path, 'incomplete', 'Permission token is outside the documented supported subset');
                        }
                        else
                            permissions.push({ tool: file.tool, source: file.path, action: key, token });
                    }
                }
            }
            else if (!unknownKeys.length) {
                record.support = 'unknown';
                finding('empty-settings', file.path, 'incomplete', 'No supported settings capability supplied');
            }
        }
        else {
            record.support = 'advisory';
            record.application = file.kind === 'instructions' ? (record.pathScope === '.' ? 'all-sessions' : 'on-demand') : 'unknown';
            if (file.kind === 'instructions') {
                const name = posix.basename(file.path), supported = file.tool === 'cursor' ? name === 'AGENTS.md' : ['CLAUDE.md', 'CLAUDE.local.md'].includes(name);
                if (!supported) {
                    record.support = 'unsupported';
                    finding('unsupported-source', file.path, 'incomplete', 'Instruction file name is not a documented source');
                }
            }
            else {
                const recognized = file.tool === 'cursor' ? /(^|\/)\.cursor\/rules\/.*\.mdc$/.test(file.path) : /(^|\/)\.claude\/rules\/.*\.md$/.test(file.path);
                if (!recognized) {
                    record.support = 'unsupported';
                    finding('unsupported-rule-format', file.path, 'incomplete', 'Rule location or extension is unsupported');
                    continue;
                }
                const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(file.content);
                if (file.tool === 'cursor' && !match) {
                    record.support = 'unknown';
                    finding('missing-frontmatter', file.path, 'invalid', 'Cursor MDC requires frontmatter');
                    continue;
                }
                if (match) {
                    try {
                        const meta = parseYaml(match[1], { maxAliasCount: 10 }) as Record<string, unknown>;
                        if (!meta || typeof meta !== 'object' || Array.isArray(meta))
                            throw new Error('Invalid frontmatter');
                        const allowed = file.tool === 'cursor' ? ['alwaysApply', 'description', 'globs'] : ['paths'];
                        if (Object.keys(meta).some(key => !allowed.includes(key))) {
                            record.support = 'unknown';
                            finding('unmapped-frontmatter', file.path, 'incomplete', 'Frontmatter field has unknown semantics');
                        }
                        if (file.tool === 'cursor') {
                            if (meta.alwaysApply !== undefined && typeof meta.alwaysApply !== 'boolean')
                                throw new Error('Invalid alwaysApply');
                            if (meta.description !== undefined && typeof meta.description !== 'string')
                                throw new Error('Invalid description');
                            if (meta.globs !== undefined && typeof meta.globs !== 'string' && !(Array.isArray(meta.globs) && meta.globs.every(x => typeof x === 'string')))
                                throw new Error('Invalid globs');
                            record.patterns = typeof meta.globs === 'string' ? meta.globs.split(',').map(x => x.trim()).filter(Boolean) : (meta.globs as string[] ?? []);
                            record.application = meta.alwaysApply === true ? 'all-sessions' : record.patterns.length ? 'matching-files' : meta.description ? 'agent-selected' : 'manual';
                        }
                        else {
                            if (meta.paths !== undefined && typeof meta.paths !== 'string' && !(Array.isArray(meta.paths) && meta.paths.every(x => typeof x === 'string')))
                                throw new Error('Invalid paths');
                            record.patterns = typeof meta.paths === 'string' ? meta.paths.split(',').map(path => path.trim()).filter(Boolean) : (meta.paths as string[] ?? []);
                            record.application = record.patterns.length ? 'matching-files' : 'all-sessions';
                        }
                    }
                    catch {
                        record.support = 'unknown';
                        finding('malformed-frontmatter', file.path, 'invalid', 'Rule frontmatter is malformed');
                    }
                }
                else
                    record.application = 'all-sessions';
            }
            if (file.tool === 'claude-code' && /(?:^|[^\w\\])@[^\s`<>]+/.test(instructionProse(file.content))) {
                finding('unexpanded-import', file.path, 'incomplete', 'Imported instruction sources were not expanded by this audit');
                record.support = 'unknown';
            }
            record.capabilities = ['prompt-context'];
        }
        if (!record.installedVersion)
            record.support = 'unknown';
        record.patterns = [...new Set(record.patterns)].sort();
        record.capabilities = [...new Set(record.capabilities)].sort();
    }
    if (permissions.length > 5000) {
        finding('permission-count-limit', '.', 'invalid', 'Permission corpus exceeds bounded comparison count');
        permissions.length = 0;
    }
    const seenOverlap = new Set<string>();
    for (const a of permissions)
        for (const b of permissions)
            if (a.tool === b.tool && a.action === 'allow' && b.action === 'deny' && a.token !== b.token && a.token.split('(')[0] === b.token.split('(')[0] && /[?*]/.test(a.token + b.token)) {
                const key = JSON.stringify([a.source, b.source]);
                if (!seenOverlap.has(key)) {
                    seenOverlap.add(key);
                    finding('permission-overlap-unknown', a.source, 'incomplete', 'Nonidentical permission patterns may overlap; exact native matching is outside this audit', b.source);
                }
            }
    const seenConflict = new Set<string>();
    for (const a of permissions)
        for (const b of permissions)
            if (a.tool === b.tool && a.token === b.token && a.action === 'allow' && b.action === 'deny') {
                const key = JSON.stringify([a.source, b.source, a.token]);
                if (!seenConflict.has(key)) {
                    seenConflict.add(key);
                    finding('permission-conflict', a.source, 'conflict', 'Literal permission token appears in both allow and deny; documented deny takes precedence', b.source);
                }
            }
    for (const generated of manifest.generated ?? []) {
        const file = input.files.find(x => x.path === generated.path);
        if (file?.content === undefined)
            finding('generated-file-missing', generated.path, 'invalid', 'Generated digest source is not selected or is missing');
        else if (rulesContentDigest(file.content) !== generated.expectedDigest)
            finding('stale-generated-digest', generated.path, 'drift', 'Selected generated bytes differ from expected digest');
    }
    for (const translation of manifest.translations ?? []) {
        const source = rules.find(x => x.source === translation.source);
        if (!source)
            finding('translation-source-missing', translation.source, 'invalid', 'Translation source was not selected');
        else if (translation.capability === 'runtime-control' || source.support !== 'advisory')
            finding('unsupported-translation', translation.source, 'incomplete', 'No audited runtime-control translation or compiler is available');
    }
    const uniqueFindings = [...new Map(findings.map(x => [JSON.stringify(x), x])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')), complete = !uniqueFindings.some(x => x.severity === 'invalid' || x.severity === 'incomplete');
    return { version: 1, mode: 'read-only', complete, exitCode: !complete ? 2 : uniqueFindings.length ? 1 : 0, rules, findings: uniqueFindings, documentationSnapshot: '2026-10-11', nativeObservation: 'unverified', sources };
}
