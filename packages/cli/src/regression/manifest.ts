import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { RegressionIssue, RegressionManifest, ResolvedRegressionInput } from '@quorate/core';
import { getWorktreeFingerprint } from '../proof-runner.js';
export function canonicalJson(value:unknown):string {
 if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.keys(value).sort().filter(k=>(value as Record<string,unknown>)[k]!==undefined).map(k=>`${JSON.stringify(k)}:${canonicalJson((value as Record<string,unknown>)[k])}`).join(',')}}`;
 return JSON.stringify(value);
}
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function readBoundedJson(path:string,maxBytes:number):unknown {
 const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||st.size>maxBytes)throw new Error('Invalid input: non-regular or oversized file');
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try {const current=fstatSync(fd);if(current.dev!==st.dev||current.ino!==st.ino||current.size>maxBytes)throw new Error('Invalid input: file changed');const raw=readFileSync(fd);if(raw.length>maxBytes)throw new Error('Invalid input: oversized file');return JSON.parse(raw.toString('utf8'));}finally{closeSync(fd);}
}
const invalid=():never=>{throw new Error('Invalid regression input');};
const string=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&!v.includes('\0')&&v.length<=8192;
function paths(value:unknown,tests:boolean):string[]{
 if(!Array.isArray(value)||value.length>100||(tests&&!value.length))return invalid();
 const result=value as string[];
 if(result.some(p=>!string(p)||isAbsolute(p)||p.includes('\\')||p.includes(':')||p.split('/').some(s=>!s||s==='.'||s==='..')||p.startsWith('-')|| (tests?!/\.(?:test|spec)\.(?:ts|js)$/.test(p):! /^(?:test\/fixtures\/|tests\/fixtures\/|__fixtures__\/).+\.(?:json|txt|csv|md|html|xml|yaml|yml|bin|png|jpg|snap)$/.test(p))))return invalid();
 return result;
}
export function normalizeRegressionManifest(value:unknown):RegressionManifest {
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['schemaVersion','id','base','head','runner','testFiles','supportFiles','assertion','setupArgv','runArgv','timeoutMs','setupTimeoutMs','maxOutputBytes'].includes(k)))return invalid();
 if(v.schemaVersion!==1||!string(v.id)||! /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v.id)||!string(v.base)||!string(v.head)||v.base.startsWith('-')||v.head.startsWith('-')||v.runner!=='vitest')return invalid();
 const testFiles=paths(v.testFiles,true),supportFiles=paths(v.supportFiles??[],false),all=[...testFiles,...supportFiles];if(new Set(all.map(p=>p.toLowerCase())).size!==all.length)return invalid();
 const assertion=v.assertion as Record<string,unknown>;if(!assertion||!string(assertion.fullName)||!string(assertion.expectedFailureText)||Object.keys(assertion).some(k=>!['fullName','expectedFailureText'].includes(k)))return invalid();
 const expected=['node_modules/.bin/vitest','run',...testFiles,'--reporter=json'];
 if(!Array.isArray(v.runArgv)||canonicalJson(v.runArgv)!==canonicalJson(expected))return invalid();
 let setupArgv:string[]|undefined;
 if(v.setupArgv!==undefined){if(!Array.isArray(v.setupArgv)||v.setupArgv.length<3||v.setupArgv.some(a=>!string(a))||v.setupArgv[0]!=='npm'||v.setupArgv[1]!=='ci'||!v.setupArgv.includes('--ignore-scripts')||v.setupArgv.slice(2).some(a=>!['--ignore-scripts','--offline','--no-audit','--no-fund'].includes(a)))return invalid();setupArgv=v.setupArgv as string[];}
 const budget=(key:string,def:number,max:number)=>{const n=v[key]??def;if(typeof n!=='number'||!Number.isInteger(n)||n<1||n>max)return invalid();return n;};
 return {schemaVersion:1,id:v.id,base:v.base,head:v.head,runner:'vitest',testFiles,supportFiles,assertion:{fullName:assertion.fullName,expectedFailureText:assertion.expectedFailureText},...(setupArgv?{setupArgv}:{}),runArgv:expected,timeoutMs:budget('timeoutMs',120000,600000),setupTimeoutMs:budget('setupTimeoutMs',600000,600000),maxOutputBytes:budget('maxOutputBytes',65536,1048576)};
}
export function readRegressionManifest(path:string):RegressionManifest {try{return normalizeRegressionManifest(readBoundedJson(path,1048576));}catch{throw new Error('Invalid regression input: manifest must be bounded regular JSON');}}
export function gitRead(cwd:string,args:string[],binary=false):Buffer {
 const r=spawnSync('git',args,{cwd,shell:false,maxBuffer:2*1048576,timeout:10000,env:{...process.env,GIT_CONFIG_COUNT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}});
 if(r.status!==0||r.error)throw new Error('Invalid regression input: Git query failed');return binary?r.stdout:Buffer.from(r.stdout.toString());
}
export function sourceFingerprint(cwd:string):string {return digest(canonicalJson(getWorktreeFingerprint(cwd,['.quorate/regressions'])));}
export function resolveRegressionInput(cwd:string,rawManifest:RegressionManifest):ResolvedRegressionInput {
 const manifest=normalizeRegressionManifest(rawManifest),sourceRoot=realpathSync(gitRead(cwd,['rev-parse','--show-toplevel']).toString().trim());
 if(realpathSync(cwd)!==sourceRoot)throw new Error('Invalid regression input: select repository root');
 const baseSha=gitRead(sourceRoot,['rev-parse','--verify',`${manifest.base}^{commit}`]).toString().trim(),headSha=gitRead(sourceRoot,['rev-parse','--verify',`${manifest.head}^{commit}`]).toString().trim();
 if(!/^[a-f0-9]{40}$/.test(baseSha)||!/^[a-f0-9]{40}$/.test(headSha))return invalid();
 gitRead(sourceRoot,['merge-base','--is-ancestor',baseSha,headSha]);
 const dirty=gitRead(sourceRoot,['status','--porcelain=v1','--untracked-files=all','--','.',':(exclude,literal).quorate/regressions']).toString();
 if(dirty.trim())throw new Error('Regression requires a clean source checkout');
 const tree=(sha:string)=>gitRead(sourceRoot,['ls-tree','-r','-z',sha]).toString().split('\0').filter(Boolean).map(line=>{const [meta,path]=line.split('\t');return {path:path!,mode:meta!.split(' ')[0]!,oid:meta!.split(' ')[2]!};});
 const baseTree=tree(baseSha),headTree=tree(headSha),issues:RegressionIssue[]=[];
 const add=(reason:RegressionIssue['reason'],detail:string)=>issues.push({phase:'preflight',reason,detail});
 const selected=[...manifest.testFiles,...manifest.supportFiles].sort();let bytes=0;
 // Reject aliases on every platform before creating worktrees. Checking each
 // component also catches a differently cased parent directory, including a
 // parent that contains another tracked file rather than the selected asset.
 const folded=(path:string)=>path.normalize('NFC').toLowerCase();
 const prefixes=(path:string)=>path.split('/').map((_,i,parts)=>parts.slice(0,i+1).join('/'));
 const committedPrefixes=new Map<string,Set<string>>();
 for(const entry of [...baseTree,...headTree])for(const path of prefixes(entry.path)){
  const key=folded(path),spellings=committedPrefixes.get(key)??new Set<string>();
  spellings.add(path);committedPrefixes.set(key,spellings);
 }
 if(selected.some(asset=>prefixes(asset).some(path=>[...(committedPrefixes.get(folded(path))??[])].some(spelling=>spelling!==path)))){
  add('unsupported-config','Selected assets have a case-colliding committed path');
 }
 const assets=selected.map(path=>{
  const entry=headTree.find(e=>e.path===path);if(!entry||!['100644','100755'].includes(entry.mode)||path.split('/').some((_,i,parts)=>headTree.some(e=>e.path===parts.slice(0,i+1).join('/')&&['120000','160000'].includes(e.mode))))return invalid();
  if(manifest.supportFiles.includes(path)&&entry.mode!=='100644')return invalid();
  const content=gitRead(sourceRoot,['cat-file','blob',entry.oid],true);bytes+=content.length;if(bytes>1048576)return invalid();return {path,bytes:content,sha256:digest(content)};
 });
 const environmentPath=(path:string)=>/(^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|\.npmrc|\.yarnrc.*|vitest\.(?:config|workspace)\..+|vite\.config\..+|tsconfig.*\.json)$/.test(path);
 const environments=[...new Set([...baseTree,...headTree].map(e=>e.path).filter(environmentPath))].sort();
 for(const path of environments)if(baseTree.find(e=>e.path===path)?.oid!==headTree.find(e=>e.path===path)?.oid)add('environment-delta','Dependency or runner configuration differs');
 const pkg=headTree.find(e=>e.path==='package.json');
 if(!pkg||pkg.mode!=='100644')add('unsupported-config','A standalone regular npm package is required');
 else {try{const obj=JSON.parse(gitRead(sourceRoot,['cat-file','blob',pkg.oid]).toString());if(obj.workspaces||Object.hasOwn(obj,'vitest')||Object.hasOwn(obj,'vite'))add('unsupported-config','Workspace or embedded runner configuration unsupported');}catch{add('unsupported-config','Package metadata unreadable');}}
 if(headTree.some(e=>e.path!== 'package.json'&&e.path.endsWith('/package.json'))||headTree.some(e=>/(^|\/)(?:vitest\.(?:config|workspace)|vite\.config|\.npmrc|\.yarnrc|\.gitmodules)/.test(e.path)))add('unsupported-config','Only configuration-free standalone projects are supported');
 const environmentDigest=digest(canonicalJson(environments.map(path=>({path,base:baseTree.find(e=>e.path===path)?.oid??null,head:headTree.find(e=>e.path===path)?.oid??null}))));
 return {sourceRoot,baseSha,headSha,sourceFingerprint:sourceFingerprint(sourceRoot),manifestDigest:digest(canonicalJson(manifest)),bundleDigest:digest(canonicalJson(assets.map(({path,sha256})=>({path,sha256})))),environmentDigest,nodeVersion:process.version,manifest,assets,issues};
}
