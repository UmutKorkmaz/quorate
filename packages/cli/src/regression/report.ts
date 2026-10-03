import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { lockSync } from 'proper-lockfile';
import { z } from 'zod';
import { classifyRegressionPair, type RegressionIssue, type RegressionReport, type RegressionRunResult } from '@quorate/core';
import { preflightSecureWorkspaceState, writeSecureWorkspaceState } from '../secure-state.js';
import { redactProofText } from '../proof-runner.js';
import { canonicalJson, digest, readBoundedJson, sourceFingerprint, MAX_REGRESSION_EXECUTION_ARGV } from './manifest.js';
const hex=z.string().regex(/^[a-f0-9]{64}$/),sha=z.string().regex(/^[a-f0-9]{40}$/);
const reason=z.enum(['reproduced-and-fixed','not-reproduced','not-fixed','unexpected-failure','setup-failed','environment-delta','missing-assertion','duplicate-assertion','skipped-assertion','invalid-output','incomplete-output','timeout','cancelled','input-mutated','cleanup-failed','unsupported-runner','unsupported-platform','unsupported-config','invalid-input']);
const issue=z.object({phase:z.enum(['preflight','setup','base','head','cleanup']),reason,detail:z.string().max(8192)}).strict();
const observation=z.object({execution:z.enum(['complete','incomplete']),assertionStatus:z.enum(['passed','failed','missing','duplicate','skipped']),expectedFailureMatched:z.boolean(),exitCode:z.number().int().nullable(),issues:z.array(issue).max(1000)}).strict();
const output=z.object({text:z.string().max(1048576),truncated:z.boolean()}).strict();
const execution=z.object({phase:z.enum(['setup','base','head']),target:z.enum(['base','head']),argv:z.array(z.string().max(8192)).max(MAX_REGRESSION_EXECUTION_ARGV),result:z.object({exitCode:z.number().int().nullable(),timedOut:z.boolean(),aborted:z.boolean(),stdout:output,stderr:output,cleanupFailed:z.boolean(),durationMs:z.number().nonnegative()}).strict(),fingerprint:hex,runnerVersion:z.string().max(80).nullable(),observation:observation.optional()}).strict();
const reportSchema=z.object({schemaVersion:z.literal(1),kind:z.literal('regression'),id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/),baseSha:sha,headSha:sha,sourceFingerprint:hex,manifestDigest:hex,bundleDigest:hex,environmentDigest:hex,nodeVersion:z.string().max(80),decision:z.object({state:z.enum(['verified','contradicted','inconclusive']),reason,issues:z.array(issue).max(1000)}).strict(),executions:z.array(execution).max(4),startedAt:z.string().datetime(),finishedAt:z.string().datetime(),durationMs:z.number().nonnegative(),trustMode:z.literal('local-assertion'),producer:z.literal('quorate-local'),artifactHash:hex,signature:hex}).strict();
export const defaultRegressionKeyDir=()=>resolve(process.env.QUORATE_REGRESSION_KEY_DIR??join(homedir(),'.quorate/regressions'));
export const resolveRegressionKeyDir = (cwd:string, explicit?:string):string => explicit === undefined ? defaultRegressionKeyDir() : resolve(cwd,explicit);
function keyAt(dir:string,create:boolean):Buffer {
 if(create)mkdirSync(dir,{recursive:true,mode:0o700});
 const st=lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||(process.platform!=='win32'&&(st.mode&0o777)!==0o700)||realpathSync(dir)!==resolve(dir))throw new Error('Untrusted regression key directory');
 const path=join(dir,'regressions.key');
 if(create){try{writeFileSync(path,randomBytes(32),{mode:0o600,flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}
 const file=lstatSync(path);if(!file.isFile()||file.isSymbolicLink()||file.size!==32||(process.platform!=='win32'&&(file.mode&0o777)!==0o600))throw new Error('Untrusted regression key');
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const current=fstatSync(fd);if(current.dev!==file.dev||current.ino!==file.ino)throw new Error('Key changed');const key=readFileSync(fd);if(key.length!==32)throw new Error('Invalid key');return key;}finally{closeSync(fd);}
}
const signature=(hash:string,key:Buffer)=>createHmac('sha256',key).update(`quorate:regression:v1:${hash}`).digest('hex');
function validIntegrity(report:RegressionReport):boolean {const {artifactHash,signature:_signature,...payload}=report;return digest(canonicalJson(payload))===artifactHash;}
function validDecision(report:RegressionReport):boolean {
 const runs=report.executions.filter(e=>e.phase!=='setup'),base=runs.filter(e=>e.phase==='base'),head=runs.filter(e=>e.phase==='head');
 if(base.length>1||head.length>1||runs.some(e=>e.phase!==e.target))return false;
 const issues:RegressionIssue[]=[...report.decision.issues];
 for(const e of report.executions){const r=e.result;if(r.aborted||r.timedOut||r.cleanupFailed||r.stdout.truncated||r.stderr.truncated)issues.push({phase:e.phase,reason:r.aborted?'cancelled':r.timedOut?'timeout':r.cleanupFailed?'cleanup-failed':'incomplete-output',detail:'Execution incomplete'});if(e.phase==='setup'&&r.exitCode!==0)issues.push({phase:'setup',reason:'setup-failed',detail:'Setup failed'});if(e.observation&&e.observation.exitCode!==r.exitCode)return false;}
 if(report.decision.state==='verified'&&(runs.length!==2||runs.some(e=>!/^4\.\d+\.\d+$/.test(e.runnerVersion??''))||base[0]?.runnerVersion!==head[0]?.runnerVersion))return false;
 const decision=classifyRegressionPair({base:base[0]?.observation,head:head[0]?.observation,issues});return decision.state===report.decision.state&&decision.reason===report.decision.reason;
}
export function readRegressionReport(path:string):RegressionReport {return reportSchema.parse(readBoundedJson(path,16*1048576)) as RegressionReport;}
export function publishRegressionReport(cwd:string,result:RegressionRunResult,options:{keyDir?:string}={}):RegressionReport {
 const input=result.input;
 const payload={schemaVersion:1 as const,kind:'regression' as const,id:input.manifest.id,baseSha:input.baseSha,headSha:input.headSha,sourceFingerprint:input.sourceFingerprint,manifestDigest:input.manifestDigest,bundleDigest:input.bundleDigest,environmentDigest:input.environmentDigest,nodeVersion:input.nodeVersion,decision:{...result.decision,issues:result.decision.issues.map(i=>({...i,detail:redactProofText(i.detail)}))},executions:result.executions.map(e=>({...e,argv:e.argv.map(redactProofText),result:{...e.result,stdout:{...e.result.stdout,text:redactProofText(e.result.stdout.text)},stderr:{...e.result.stderr,text:redactProofText(e.result.stderr.text)}}})),startedAt:result.startedAt,finishedAt:result.finishedAt,durationMs:result.durationMs,trustMode:'local-assertion' as const,producer:'quorate-local' as const};
 const key=keyAt(resolve(options.keyDir??defaultRegressionKeyDir()),true),artifactHash=digest(canonicalJson(payload)),report=reportSchema.parse({...payload,artifactHash,signature:signature(artifactHash,key)}) as RegressionReport;
 if(!validDecision(report))throw new Error('Regression decision is inconsistent');
 const prefix='.quorate/regressions',history=`${prefix}/history/${artifactHash}.json`,idJson=`${prefix}/${report.id}.json`,idMd=`${prefix}/${report.id}.md`;
 const targets=[history,idJson,idMd,`${prefix}/latest.json`,`${prefix}/latest.md`];preflightSecureWorkspaceState(cwd,targets);
 const dir=join(cwd,prefix),historyDir=join(dir,'history');
 const release=lockSync(dir,{realpath:true,lockfilePath:join(dir,'.publish.lock'),stale:10000,retries:0});
 try{
  preflightSecureWorkspaceState(cwd,targets);const content=canonicalJson(report)+'\n',path=join(cwd,history);
  if(Buffer.byteLength(content)>16*1048576)throw new Error('Regression report exceeds artifact budget');
  if(existsSync(path)){if(canonicalJson(readRegressionReport(path))!==canonicalJson(report))throw new Error('Immutable artifact collision');}
  else{
   const parent=lstatSync(historyDir),real=realpathSync(historyDir),fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
   try{writeFileSync(fd,content);fsyncSync(fd);const current=lstatSync(historyDir),file=lstatSync(path),owned=fstatSync(fd);if(parent.dev!==current.dev||parent.ino!==current.ino||realpathSync(historyDir)!==real||file.dev!==owned.dev||file.ino!==owned.ino)throw new Error('History identity changed');}finally{closeSync(fd);}
  }
  const markdown=`# Regression proof: ${report.id}\n\n${report.decision.state}: ${report.decision.reason}\n\nBase: ${report.baseSha}\nHead: ${report.headSha}\nArtifact: ${artifactHash}\n\nTrust: local assertion; a local signature is not hosted execution attestation.\n`;
  for(const [target,text] of [[idJson,content],[idMd,markdown],[`${prefix}/latest.json`,content],[`${prefix}/latest.md`,markdown]])writeSecureWorkspaceState(cwd,target!,text!);
  const records=readdirSync(historyDir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).flatMap(name=>{try{const r=readRegressionReport(join(historyDir,name));return validIntegrity(r)&&signature(r.artifactHash,key)===r.signature&&`${r.artifactHash}.json`===name?[{name,finishedAt:r.finishedAt}]:[];}catch{return [];}}).sort((a,b)=>b.finishedAt.localeCompare(a.finishedAt)||a.name.localeCompare(b.name));
  for(const old of records.filter(record=>record.name!==`${artifactHash}.json`).slice(99)){const path=join(historyDir,old.name),st=lstatSync(path);if(st.isFile()&&!st.isSymbolicLink())unlinkSync(path);}
  return report;
 }finally{release();}
}
export interface RegressionVerificationOptions {cwd:string;path:string;baseSha:string;headSha:string;manifestDigest:string;bundleDigest:string;trust:{mode:'local';keyDir:string}|{mode:'digest';expectedHash:string}}
export function verifyRegressionReport(options:RegressionVerificationOptions):{ok:boolean;reason:'verified'|'missing'|'tampered'|'stale'|'untrusted'|'unsupported';trustMode:'local-assertion'|'content-only';report?:RegressionReport}{
 const trustMode=options.trust.mode==='local'?'local-assertion':'content-only';
 let report:RegressionReport;
 try{const raw=readBoundedJson(options.path,16*1048576) as {schemaVersion?:unknown;kind?:unknown};if(raw?.schemaVersion!==1||raw?.kind!=='regression')return {ok:false,reason:'unsupported',trustMode};report=reportSchema.parse(raw) as RegressionReport;}catch(error){return {ok:false,reason:(error as NodeJS.ErrnoException).code==='ENOENT'?'missing':'tampered',trustMode};}
 if(!validIntegrity(report)||!validDecision(report))return {ok:false,reason:'tampered',trustMode};
 if(options.trust.mode==='local'){
  try{const expected=signature(report.artifactHash,keyAt(resolve(options.trust.keyDir),false));if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(report.signature,'hex')))return {ok:false,reason:'untrusted',trustMode};}catch{return {ok:false,reason:'untrusted',trustMode};}
 }else if(options.trust.expectedHash!==report.artifactHash)return {ok:false,reason:'tampered',trustMode};
 if(report.baseSha!==options.baseSha||report.headSha!==options.headSha||report.manifestDigest!==options.manifestDigest||report.bundleDigest!==options.bundleDigest||report.sourceFingerprint!==sourceFingerprint(options.cwd))return {ok:false,reason:'stale',trustMode,report};
 return {ok:true,reason:'verified',trustMode,report};
}
