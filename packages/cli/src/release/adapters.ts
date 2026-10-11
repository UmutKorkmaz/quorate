import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,realpathSync } from 'node:fs';
import { join } from 'node:path';
import { executeBoundedCommand,type BoundedCommandOptions,type BoundedCommandResult } from '../bounded-command.js';
import { isPathWithinPackage } from './package-path.js';
import { ownedScratch } from './scratch.js';
import type { ReleaseAdapters,ReleaseTarget,NpmTarget,ArtifactObservation,SmokeObservation } from './types.js';
const transient=/E404|ETARGET|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|E503|E502/i;
interface NativeDeps {run(options:BoundedCommandOptions):Promise<BoundedCommandResult>;fetch:typeof fetch;now():number}
const defaults:NativeDeps={run:executeBoundedCommand,fetch,now:Date.now};
const incomplete=(r:BoundedCommandResult)=>r.timedOut||r.aborted||r.cleanupFailed||r.stdout.truncated||r.stderr.truncated;
async function digestDownload(url:string,timeoutMs:number,deps:NativeDeps,maxBytes=64*1024*1024,signal?:AbortSignal,githubAsset=false):Promise<string>{
 if(timeoutMs<=0)throw new Error('Download deadline exhausted');
 const deadline=deps.now()+timeoutMs;
 const allowed=new Set(githubAsset?['api.github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github.com']:['registry.npmjs.org']);
 const permitted=(address:string)=>{const target=new URL(address);if(target.protocol!=='https:'||!allowed.has(target.hostname)||target.username||target.password||(target.port&&target.port!=='443'))throw new Error('Unexpected artifact host');return target;};
 let current=permitted(url).href;
 for(let redirects=0;redirects<=5;redirects++){
  const remaining=deadline-deps.now();if(remaining<=0)throw new Error('Download deadline exhausted');
  const timeout=AbortSignal.timeout(Math.max(1,remaining));
  const response=await deps.fetch(current,{signal:signal?AbortSignal.any([signal,timeout]):timeout,redirect:'manual',...(githubAsset?{headers:{Accept:'application/octet-stream'}}:{})});
  permitted(response.url||current);
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');await response.body?.cancel();if(!location||redirects===5)throw new Error('Artifact redirect unavailable');
   current=permitted(new URL(location,current).href).href;continue;
  }
  if(!response.ok||!response.body)throw new Error('Artifact download unavailable');
  const declared=Number(response.headers.get('content-length'));if(declared>maxBytes)throw new Error('Artifact too large');
  const digest=createHash('sha256'),reader=response.body.getReader();let bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>maxBytes)throw new Error('Artifact too large');digest.update(value);}return digest.digest('hex');}finally{await reader.cancel();}
 }
 throw new Error('Artifact redirect limit exceeded');
}
export function createNativeReleaseAdapters(deps:NativeDeps=defaults,signal?:AbortSignal):ReleaseAdapters {
 const run=(argv:string[],cwd:string,budgetMs:number,env?:NodeJS.ProcessEnv)=>deps.run({argv,cwd,env,timeoutMs:Math.max(1,Math.min(budgetMs,120000)),maxOutputBytes:65536,signal});
 const observe=async(target:ReleaseTarget,budgetMs:number):Promise<ArtifactObservation>=>{
  if(process.platform==='win32'&&deps.run===executeBoundedCommand)return {status:'unknown',code:'native-provider-cli-unsupported-platform'};
  const start=deps.now(),remaining=()=>budgetMs-(deps.now()-start);
  if(target.kind==='npm'){
   const scratch=ownedScratch('quorate-release-metadata-');try{
    const result=await run(['npm','view',`${target.package}@${target.version}`,'version','dist.integrity','gitHead','dist.attestations','--json','--registry=https://registry.npmjs.org','--prefer-online','--fetch-retries=0','--fetch-timeout=10000'],scratch.cwd,Math.min(10000,remaining()),scratch.env);
    if(result.timedOut&&!result.cleanupFailed&&!result.stdout.truncated&&!result.stderr.truncated)return {status:'missing',code:'metadata-transport-timeout'};
    if(incomplete(result))return {status:'unknown',code:'metadata-incomplete'};
    if(result.exitCode!==0)return {status:transient.test(result.stderr.text)?'missing':'unknown',code:'registry-unavailable'};
    let info;try{info=JSON.parse(result.stdout.text);}catch{return {status:'unknown',code:'invalid-registry-json'};}
    if(!info||typeof info!=='object'||Array.isArray(info))return {status:'unknown',code:'ambiguous-registry-identity'};
    let provenanceDigest:string|undefined;
    const provenanceUrl=info['dist.attestations']?.url??info.dist?.attestations?.url;
    if(target.expectedProvenanceDigest&&typeof provenanceUrl==='string'){
     const url=new URL(provenanceUrl);if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org'||url.username||url.password)return {status:'unknown',code:'unexpected-provenance-host'};
     try{provenanceDigest=await digestDownload(url.href,remaining(),deps,1024*1024,signal);}catch{return {status:'unknown',code:'provenance-unavailable'};}
    }
    return {status:'available',version:info.version,digest:info['dist.integrity']??info.dist?.integrity,sourceRevision:typeof info.gitHead==='string'?info.gitHead:undefined,provenanceDigest};
   }finally{scratch.cleanup();}
  }
  // gh sees fixed official-host GET endpoints only; no URLs or shell text from artifacts.
  const endpoint=`repos/${target.repository}/releases/tags/${encodeURIComponent(target.tag)}`;
  const result=await run(['gh','api','--hostname','github.com',endpoint,'--method','GET'],process.cwd(),Math.min(10000,remaining()));
  if(incomplete(result))return {status:'unknown',code:'github-metadata-incomplete'};
  if(result.exitCode!==0)return {status:/404|Not Found/i.test(result.stderr.text)?'missing':'unknown',code:'github-release-unavailable'};
  let info;try{info=JSON.parse(result.stdout.text);}catch{return {status:'unknown',code:'invalid-github-json'};}
  if(!info||info.tag_name!==target.tag||!Array.isArray(info.assets))return {status:'unknown',code:'ambiguous-release-identity'};
  const assets=info.assets.filter((a:any)=>a.id===target.assetId);if(assets.length!==1)return {status:assets.length?'unknown':'missing',code:'immutable-asset-unavailable'};
  const asset=assets[0];if(asset.name!==target.name)return {status:'failed',code:'wrong-asset-name'};
  // Tag/name download URLs are mutable. Fetch only the manifest-selected immutable asset ID.
  const url=`https://api.github.com/repos/${target.repository}/releases/assets/${target.assetId}`;
  try{return {status:'available',assetId:asset.id,name:asset.name,digest:await digestDownload(url,remaining(),deps,64*1024*1024,signal,true),sourceRevision:/^[a-f0-9]{40,64}$/.test(info.target_commitish??'')?info.target_commitish:undefined};}catch{return {status:'unknown',code:'asset-download-incomplete'};}

 };
 const smoke=async(target:NpmTarget,budgetMs:number):Promise<SmokeObservation>=>{
  if(process.platform==='win32')return {status:'unknown',code:'native-install-unsupported-platform'};
  const scratch=ownedScratch('quorate-release-install-'),start=deps.now(),remaining=()=>budgetMs-(deps.now()-start);
  const call=(argv:string[],cap=10000)=>remaining()<=0?Promise.resolve(null):run(argv,scratch.cwd,Math.min(cap,remaining()),scratch.env);
  try{
   const install=await call(['npm','install','--prefix',scratch.cwd,'--ignore-scripts','--registry=https://registry.npmjs.org','--prefer-online','--fetch-retries=0','--fetch-timeout=10000','--no-audit','--no-fund',`${target.package}@${target.version}`],120000);
   if(!install||incomplete(install))return {status:'missing',code:'install-incomplete'};
   if(install.exitCode!==0)return {status:transient.test(install.stderr.text)?'missing':'failed',code:'exact-install-failed'};
   const packagePath=join(scratch.cwd,'node_modules',target.package),pkg=JSON.parse(readFileSync(join(packagePath,'package.json'),'utf8')),lock=JSON.parse(readFileSync(join(scratch.cwd,'package-lock.json'),'utf8'));
   if(pkg.name!==target.package||pkg.version!==target.version)return {status:'failed',code:'installed-identity-mismatch'};
   if(lock.packages?.[`node_modules/${target.package}`]?.integrity!==target.expectedIntegrity)return {status:'failed',code:'installed-integrity-mismatch'};
   const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.quorate;
   if(typeof bin!=='string')return {status:'failed',code:'packaged-cli-missing'};
   const entry=realpathSync(join(packagePath,bin));if(!isPathWithinPackage(realpathSync(packagePath),entry))return {status:'failed',code:'packaged-cli-outside-package'};
   const cli=[process.execPath,entry];
   const version=await call([...cli,'--version']);if(!version||incomplete(version))return {status:'unknown',code:'version-incomplete'};if(version.exitCode!==0||version.stdout.text.trim()!==target.version)return {status:'failed',code:'installed-version-mismatch'};
   const help=await call([...cli,'--help']);if(!help||incomplete(help))return {status:'unknown',code:'help-incomplete'};if(help.exitCode!==0||!help.stdout.text.trim())return {status:'failed',code:'installed-help-failed'};
   for(const unsafe of [false,true]){
    const diff=join(scratch.cwd,unsafe?'unsafe.diff':'clean.diff');writeFileSync(diff,unsafe?'diff --git a/Dockerfile b/Dockerfile\nnew file mode 100644\n--- /dev/null\n+++ b/Dockerfile\n@@ -0,0 +1 @@\n+FROM node:22\n':'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # Release smoke\n+No dependency changes.\n');
    const result=await call([...cli,'--cwd',scratch.cwd,'supply-chain','scan','--diff',diff,'--json','--gate',...(unsafe?['--fail-on','medium']:[])]);
    if(!result||incomplete(result))return {status:'unknown',code:'gate-incomplete'};
    let report;try{report=JSON.parse(result.stdout.text);}catch{return {status:'failed',code:'gate-json-invalid'};}
    if(result.exitCode!==(unsafe?1:0)||!Array.isArray(report.findings)||(unsafe?report.findings.length===0:report.findings.length!==0))return {status:'failed',code:'gate-behavior-mismatch'};
   }
   return {status:'verified'};
  }catch{return {status:'failed',code:'installed-package-invalid'};}finally{scratch.cleanup();}
 };
 return {now:deps.now,sleep:ms=>new Promise<void>(r=>{if(signal?.aborted){r();return;}const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',finish);r();};const timer=setTimeout(finish,ms);signal?.addEventListener('abort',finish,{once:true});}),observe,smoke};
}
export const nativeReleaseAdapters=createNativeReleaseAdapters();
