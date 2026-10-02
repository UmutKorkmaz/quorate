import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import type { ResolvedRegressionInput, RegressionIssue } from '@quorate/core';
import { canonicalJson, digest, gitRead } from './manifest.js';
export interface RegressionCheckouts {ownerId:string;tempRoot:string;baseDir:string;headDir:string;captureProductionDigests():Promise<{base:string;head:string}>;cleanup():Promise<RegressionIssue[]>}
const identity=(path:string)=>{const st=lstatSync(path);if(st.isSymbolicLink()||!st.isDirectory())throw new Error('Owned directory identity invalid');return `${st.dev}:${st.ino}`;};
export async function createRegressionCheckouts(input:ResolvedRegressionInput):Promise<RegressionCheckouts>{
 if(process.platform==='win32')throw new Error('Regression execution unsupported on Windows');
 if(input.issues.length)throw new Error('Regression preflight issues must be resolved');
 const ownerId=randomUUID(),tempRoot=realpathSync(mkdtempSync(join(tmpdir(),'quorate-regression-'))),baseDir=join(tempRoot,'base'),headDir=join(tempRoot,'head');
 const marker=canonicalJson({ownerId,sourceRoot:input.sourceRoot,baseSha:input.baseSha,headSha:input.headSha}),markerPath=join(tempRoot,'owner.json'),rootIdentity=identity(tempRoot);
 writeFileSync(markerPath,marker,{mode:0o600,flag:'wx'});
 const markerStat=lstatSync(markerPath);
 const owned=new Map<string,{identity:string;gitFile:string;gitIdentity:string}>();let cleaned=false;
 const checkOwnership=()=>{
  if(identity(tempRoot)!==rootIdentity||realpathSync(tempRoot)!==tempRoot)throw new Error('Owned root changed');
  const st=lstatSync(markerPath);if(!st.isFile()||st.isSymbolicLink()||st.dev!==markerStat.dev||st.ino!==markerStat.ino||readFileSync(markerPath,'utf8')!==marker)throw new Error('Ownership marker changed');
  for(const [path,record] of owned){const gitStat=lstatSync(join(path,'.git'));if(!gitStat.isFile()||gitStat.isSymbolicLink()||`${gitStat.dev}:${gitStat.ino}`!==record.gitIdentity||realpathSync(path)!==path||identity(path)!==record.identity||readFileSync(join(path,'.git'),'utf8')!==record.gitFile)throw new Error('Owned checkout changed');}
 };
 const cleanup=async():Promise<RegressionIssue[]>=>{
  if(cleaned)return [];
  try{
   checkOwnership();
   for(const path of [...owned.keys()].reverse()){
    // The linked git file and inode must still match the checkout we created.
    gitRead(input.sourceRoot,['-c','core.hooksPath=/dev/null','worktree','remove','--force',path]);owned.delete(path);
   }
   checkOwnership();rmSync(tempRoot,{recursive:true});cleaned=true;return [];
  }catch{return [{phase:'cleanup',reason:'cleanup-failed',detail:'Owned checkout cleanup refused or failed; temporary evidence retained'}];}
 };
 const inventory=(cwd:string)=>{
  const tracked=gitRead(cwd,['ls-files','-z']).toString().split('\0').filter(Boolean);
  const untracked=gitRead(cwd,['ls-files','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean).filter(p=>! /^(?:node_modules\/|coverage\/|dist\/|\.quorate\/(?:regressions|proofs)\/)/.test(p));
  const assets=new Set(input.assets.map(a=>a.path));
  return digest(canonicalJson([...new Set([...tracked,...untracked])].filter(p=>!assets.has(p)).sort().map(path=>{
   const full=resolve(cwd,path);if(relative(cwd,full).startsWith('..'))throw new Error('Invalid inventory path');
   try{const st=lstatSync(full);return {path,mode:st.mode&0o777,hash:st.isSymbolicLink()?digest(readlinkSync(full)):st.isFile()?digest(readFileSync(full)):'non-regular'};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {path,hash:'missing'};throw error;}
  })));
 };
 try{
  for(const [path,sha] of [[baseDir,input.baseSha],[headDir,input.headSha]]){
   gitRead(input.sourceRoot,['-c','core.hooksPath=/dev/null','-c','submodule.recurse=false','worktree','add','--detach',path!,sha!]);
   const gitStat=lstatSync(join(path!,'.git'));
   owned.set(path!,{identity:identity(path!),gitFile:readFileSync(join(path!,'.git'),'utf8'),gitIdentity:`${gitStat.dev}:${gitStat.ino}`});
   for(const asset of input.assets){
    const target=join(path!,asset.path);let parent=path!;
    for(const part of asset.path.split('/').slice(0,-1)){parent=join(parent,part);try{const st=lstatSync(parent);if(!st.isDirectory()||st.isSymbolicLink())throw new Error('Unsafe overlay parent');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')mkdirSync(parent);else throw error;}}
    try{const st=lstatSync(target);if(!st.isFile()||st.isSymbolicLink())throw new Error('Unsafe overlay destination');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    writeFileSync(target,asset.bytes);
   }
  }
  return {ownerId,tempRoot,baseDir,headDir,captureProductionDigests:async()=>{checkOwnership();return {base:inventory(baseDir),head:inventory(headDir)};},cleanup};
 }catch(error){const issues=await cleanup();throw new Error(issues.length?'Checkout creation and cleanup failed':'Regression checkout creation failed',{cause:error});}
}
