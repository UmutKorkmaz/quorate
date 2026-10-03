import { mkdirSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { classifyRegressionPair, type RegressionRunResult, type RegressionExecutionRecord, type RegressionIssue, type RegressionObservation } from '@quorate/core';
import { executeBoundedCommand } from '../bounded-command.js';
import { getWorktreeFingerprint, redactProofText } from '../proof-runner.js';
import { createRegressionCheckouts, type RegressionCheckouts } from './checkouts.js';
import { canonicalJson, digest, readRegressionManifest, resolveRegressionInput, sourceFingerprint } from './manifest.js';
import { inspectVitestVersion, parseVitestObservation } from './vitest-adapter.js';
export async function runRegression(options:{cwd:string;manifestPath:string;signal?:AbortSignal}):Promise<RegressionRunResult>{
 const startedMs=Date.now(),startedAt=new Date(startedMs).toISOString();
 const input=resolveRegressionInput(options.cwd,readRegressionManifest(options.manifestPath)),manifest=input.manifest,issues=[...input.issues],executions:RegressionExecutionRecord[]=[];
 let checkouts:RegressionCheckouts|undefined,base:RegressionObservation|undefined,head:RegressionObservation|undefined;
 const add=(phase:RegressionIssue['phase'],reason:RegressionIssue['reason'],detail:string)=>issues.push({phase,reason,detail});
 if(process.platform==='win32')add('preflight','unsupported-platform','Regression execution requires Linux or macOS');
 if(options.signal?.aborted)add('preflight','cancelled','Cancelled before setup');
 try{
  if(!issues.length){
   checkouts=await createRegressionCheckouts(input);
   const before=await checkouts.captureProductionDigests();
   const home=join(checkouts.tempRoot,'home'),cache=join(checkouts.tempRoot,'npm-cache');mkdirSync(home);mkdirSync(cache);
   const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:home,TMPDIR:checkouts.tempRoot,TMP:checkouts.tempRoot,TEMP:checkouts.tempRoot,CI:'1',NODE_ENV:'test',TZ:'UTC',npm_config_cache:cache,npm_config_userconfig:join(home,'npmrc'),npm_config_registry:'https://registry.npmjs.org'};
   const assetsMatch=(cwd:string)=>input.assets.every(asset=>{try{const path=join(cwd,asset.path),st=lstatSync(path);return st.isFile()&&!st.isSymbolicLink()&&digest(readFileSync(path))===asset.sha256;}catch{return false;}});
   let firstVersion:string|undefined;
   for(const target of ['base','head'] as const){
    if(options.signal?.aborted){add(target,'cancelled','Cancelled before target execution');break;}
    const cwd=target==='base'?checkouts.baseDir:checkouts.headDir;
    const capture=()=>digest(canonicalJson(getWorktreeFingerprint(cwd,['.quorate/regressions'])));
    const record=async(phase:RegressionExecutionRecord['phase'],argv:string[],timeoutMs:number,version:string|null)=>{
     const raw=await executeBoundedCommand({cwd,argv,timeoutMs,maxOutputBytes:manifest.maxOutputBytes,signal:options.signal,env});
     const observation=phase==='setup'?undefined:parseVitestObservation(raw,{...manifest.assertion,testFiles:manifest.testFiles,checkoutDir:cwd},target);
     executions.push({phase,target,argv:argv.map(redactProofText),result:{...raw,stdout:{...raw.stdout,text:redactProofText(raw.stdout.text)},stderr:{...raw.stderr,text:redactProofText(raw.stderr.text)}},fingerprint:capture(),runnerVersion:version,...(observation?{observation}:{})});
     return {raw,observation};
    };
    if(manifest.setupArgv){
     const {raw}=await record('setup',manifest.setupArgv,manifest.setupTimeoutMs,null);
     if(raw.aborted||raw.timedOut||raw.cleanupFailed||raw.stdout.truncated||raw.stderr.truncated||raw.exitCode!==0){add('setup',raw.aborted?'cancelled':raw.timedOut?'timeout':raw.cleanupFailed?'cleanup-failed':raw.stdout.truncated||raw.stderr.truncated?'incomplete-output':'setup-failed','Declared dependency setup did not complete successfully');break;}
    }
    const afterSetup=await checkouts.captureProductionDigests();
    if(afterSetup[target]!==before[target]||!assetsMatch(cwd)){add('setup','input-mutated','Setup modified immutable production or selected test inputs');break;}
    const version=inspectVitestVersion(cwd);
    if(!version.supported){add(target,version.version==='unknown'?'setup-failed':'unsupported-runner','An installed local Vitest 4.x runner is required; no implicit install performed');break;}
    if(firstVersion&&firstVersion!==version.version){add(target,'environment-delta','Installed runner versions differ');break;}firstVersion=version.version;
    const entry=join(cwd,'node_modules/vitest/vitest.mjs');
    if(!realpathSync(entry).startsWith(realpathSync(cwd)+'/')){add(target,'unsupported-runner','Runner executable escapes owned checkout');break;}
    const {observation}=await record(target,[process.execPath,entry,...manifest.runArgv.slice(1)],manifest.timeoutMs,version.version);
    if(target==='base')base=observation;else head=observation;
    const after=await checkouts.captureProductionDigests();
    if(after[target]!==before[target]||!assetsMatch(cwd))add(target,'input-mutated','Test execution modified immutable production or selected test inputs');
   }
  }
 }catch{
  add(checkouts?'base':'preflight','invalid-output','Regression execution could not safely complete');
 }finally{if(checkouts)issues.push(...await checkouts.cleanup());}
 if(options.signal?.aborted&&!issues.some(i=>i.reason==='cancelled'))add('cleanup','cancelled','Cancelled before final classification');
 if(sourceFingerprint(input.sourceRoot)!==input.sourceFingerprint)add('cleanup','input-mutated','Source checkout changed during execution');
 const finishedAt=new Date().toISOString();
 return {input,decision:classifyRegressionPair({base,head,issues}),executions,startedAt,finishedAt,durationMs:Date.now()-startedMs};
}
