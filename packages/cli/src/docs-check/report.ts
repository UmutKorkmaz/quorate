import { record,revisionPattern,shaPattern,readJson,timestamp,packagePattern,versionPattern } from '../release/report.js';
import { writeSecureWorkspaceState } from '../secure-state.js';
import type { DocsCheckReport,DocsManifest } from './types.js';
import { isAbsolute,win32 } from 'node:path';
export function safeFixturePath(path:unknown):path is string{return typeof path==='string'&&path.length>0&&path.length<240&&!isAbsolute(path)&&!win32.isAbsolute(path)&&!path.includes('\0')&&!path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'||p==='.git'||p==='.quorate-owner');}
export function validateDocsManifest(value:unknown):DocsManifest {
 const m=record(value),artifact=record(m.artifact);
 if(m.schemaVersion!==1||typeof m.sourceRevision!=='string'||!revisionPattern.test(m.sourceRevision)||!Array.isArray(m.steps)||m.steps.length<1||m.steps.length>16)throw new Error('Invalid docs manifest');
 if(artifact.mode==='source-candidate'){if(typeof artifact.entrypoint!=='string'||!artifact.entrypoint||artifact.entrypoint.includes('\0'))throw new Error('Explicit candidate entrypoint required');}
 else if(artifact.mode==='published-package'){if(typeof artifact.package!=='string'||!packagePattern.test(artifact.package)||typeof artifact.version!=='string'||!versionPattern.test(artifact.version)||!safeFixturePath(artifact.entrypoint))throw new Error('Published journey needs exact package/version/entrypoint');}else throw new Error('Explicit artifact mode required');
 for(const [key,max] of [['deadlineMs',600000],['maxOutputBytes',65536]] as const){if(m[key]!==undefined&&(!Number.isInteger(m[key])||Number(m[key])<1||Number(m[key])>max))throw new Error(`Invalid ${key}`);}
 const ids=new Set<string>();for(const value of m.steps){const step=record(value);if(typeof step.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(step.id)||ids.has(step.id)||!Array.isArray(step.argv)||!step.argv.length||step.argv.length>128||step.argv.some(a=>typeof a!=='string'||a.includes('\0')||a.length>16384)||!Number.isInteger(step.expectedExit)||Number(step.expectedExit)<0||Number(step.expectedExit)>255)throw new Error('Invalid explicit docs step');ids.add(step.id);
  if(step.timeoutMs!==undefined&&(!Number.isInteger(step.timeoutMs)||Number(step.timeoutMs)<1||Number(step.timeoutMs)>120000))throw new Error('Invalid step timeout');
  if(step.stdoutIncludes!==undefined&&(!Array.isArray(step.stdoutIncludes)||step.stdoutIncludes.length>32||step.stdoutIncludes.some(x=>typeof x!=='string'||x.length>8192)))throw new Error('Invalid output expectation');
 }
 if(!m.steps.some(s=>(record(s).argv as unknown[])[0]==='{cli}'))throw new Error('Docs journey must directly execute its selected artifact');
 if(m.files!==undefined){if(!Array.isArray(m.files)||m.files.length>32)throw new Error('Invalid fixture files');const paths=new Set<string>();for(const value of m.files){const f=record(value);if(!safeFixturePath(f.path)||paths.has(f.path)||typeof f.content!=='string'||Buffer.byteLength(f.content)>65536)throw new Error('Invalid fixture path/content');paths.add(f.path);}}
 if(m.documentation!==undefined){const d=record(m.documentation);if(typeof d.path!=='string'||!d.path||!shaPattern.test(String(d.sha256)))throw new Error('Invalid docs digest expectation');}
 if(m.advertisedOptions!==undefined){if(!Array.isArray(m.advertisedOptions)||m.advertisedOptions.length>128)throw new Error('Invalid command metadata');for(const value of m.advertisedOptions){const c=record(value);if(typeof c.command!=='string'||!Array.isArray(c.flags)||c.flags.some(f=>typeof f!=='string'||!/^--?[-A-Za-z0-9]+$/.test(f)))throw new Error('Invalid advertised option');}}
 return m as unknown as DocsManifest;
}
export function validateDocsReport(value:unknown):DocsCheckReport {
 const r=record(value),producer=record(r.producer),decision=record(r.decision),freshness=record(r.freshness);
 if(r.schemaVersion!==1||r.kind!=='docs-check'||!revisionPattern.test(String(r.sourceRevision))||!shaPattern.test(String(r.manifestDigest))||!shaPattern.test(String(r.subjectDigest))||producer.id!=='quorate-local'||producer.trust!=='unattested'||!timestamp(r.createdAt)||!['source-candidate','published-package'].includes(String(r.artifactMode))||!['verified','failed','inconclusive'].includes(String(decision.state))||typeof decision.reason!=='string'||!['verified','failed','inconclusive'].includes(String(r.functionalState))||!['current','stale','unknown'].includes(String(freshness.state))||!Array.isArray(freshness.issues)||freshness.issues.some(i=>typeof i!=='string')||!Array.isArray(r.issues)||r.issues.some(i=>typeof i!=='string')||!Array.isArray(r.checks)||r.checks.length<1||r.checks.length>16)throw new Error('Invalid docs report');
 const ids=new Set<string>();for(const value of r.checks){const c=record(value),out=record(c.stdout),err=record(c.stderr);if(typeof c.id!=='string'||ids.has(c.id)||!['passed','failed','inconclusive','missing'].includes(String(c.outcome))||!Number.isInteger(c.expectedExit)||Number(c.expectedExit)<0||Number(c.expectedExit)>255||(c.actualExit!==null&&!Number.isInteger(c.actualExit))||typeof out.text!=='string'||typeof err.text!=='string'||typeof out.truncated!=='boolean'||typeof err.truncated!=='boolean'||Buffer.byteLength(out.text)>65536||Buffer.byteLength(err.text)>65536||typeof c.durationMs!=='number'||c.durationMs<0||!Number.isFinite(c.durationMs))throw new Error('Invalid docs check');ids.add(c.id);if(c.outcome==='passed'&&(c.expectedExit!==c.actualExit||out.truncated||err.truncated))throw new Error('Passed docs check contradicts execution');}
 const functional=r.checks.some(c=>['failed','missing'].includes(String(record(c).outcome)))?'failed':r.checks.some(c=>record(c).outcome==='inconclusive')?'inconclusive':'verified';
 if(r.functionalState!==functional)throw new Error('Functional state contradicts checks');
 const state=functional==='failed'||freshness.state==='stale'?'failed':functional==='inconclusive'?'inconclusive':'verified';if(decision.state!==state)throw new Error('Docs decision contradicts evidence');
 return r as unknown as DocsCheckReport;
}
export function readDocsReport(path:string):DocsCheckReport{return validateDocsReport(readJson(path));}
export function publishDocsReport(cwd:string,report:DocsCheckReport):void {validateDocsReport(report);writeSecureWorkspaceState(cwd,'.quorate/docs/latest.json',JSON.stringify(report,null,2)+'\n');}
