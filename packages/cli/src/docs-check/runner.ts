import { mkdirSync,writeFileSync,readFileSync,realpathSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { dirname,join,resolve } from 'node:path';
import { executeBoundedCommand } from '../bounded-command.js';
import { redactProofText } from '../proof-runner.js';
import { readBoundedProofFile } from '../portable-proof.js';
import { hash,hashJson,readJson } from '../release/report.js';
import { isPathWithinPackage } from '../release/package-path.js';
import { ownedScratch } from '../release/scratch.js';
import { validateDocsManifest,publishDocsReport } from './report.js';
import type { CommandMetadata,DocsAdapter,DocsCheckReport,DocsCheck,DocsManifest } from './types.js';
export class UnsupportedDocsPlatformError extends Error {
 constructor(){super('Docs native execution is unsupported on Windows; read-only evidence inspection remains available.');this.name='UnsupportedDocsPlatformError';}
}
export function docsExitCode(state:DocsCheckReport['decision']['state']):number{return state==='verified'?0:state==='failed'?1:2;}
function redactedOutput(output:{text:string;truncated:boolean},limit:number){const text=redactProofText(output.text),bytes=Buffer.from(text);return bytes.length<=limit?{text,truncated:output.truncated}:{text:new StringDecoder('utf8').write(bytes.subarray(0,limit)),truncated:true};}
function subset(actual:unknown,expected:unknown):boolean {
 if(expected===null||typeof expected!=='object')return actual===expected;
 if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((v,i)=>subset(actual[i],v));
 if(actual===null||typeof actual!=='object'||Array.isArray(actual))return false;
 return Object.entries(expected).every(([k,v])=>Object.hasOwn(actual,k)&&subset((actual as Record<string,unknown>)[k],v));
}
export async function checkDocs(options:{cwd:string;manifestPath:string;metadata?:CommandMetadata[];signal?:AbortSignal},adapter:DocsAdapter={run:executeBoundedCommand}):Promise<DocsCheckReport>{
 if(process.platform==='win32')throw new UnsupportedDocsPlatformError();
 const manifest=validateDocsManifest(readJson(options.manifestPath,65536)),manifestDir=dirname(resolve(options.manifestPath)),scratch=ownedScratch('quorate-docs-'),start=Date.now(),deadline=start+(manifest.deadlineMs??600000);
 const report:DocsCheckReport={schemaVersion:1,kind:'docs-check',sourceRevision:manifest.sourceRevision,manifestDigest:hashJson(manifest),subjectDigest:hashJson(manifest.artifact),producer:{id:'quorate-local',trust:'unattested'},createdAt:new Date(start).toISOString(),artifactMode:manifest.artifact.mode,decision:{state:'inconclusive',reason:'Journey pending'},functionalState:'inconclusive',checks:[],freshness:{state:'unknown',issues:[]},issues:[]};
 const missing=(step:DocsManifest['steps'][number],outcome:DocsCheck['outcome'],reason:string)=>{report.checks.push({id:step.id,outcome,expectedExit:step.expectedExit,actualExit:null,stdout:{text:'',truncated:false},stderr:{text:'',truncated:false},durationMs:0});report.issues.push(`${step.id}:${reason}`);};
 try{
  const init=await executeBoundedCommand({cwd:scratch.cwd,argv:['git','init','--quiet'],timeoutMs:Math.min(5000,manifest.deadlineMs??600000),maxOutputBytes:8192,env:scratch.env,signal:options.signal});
  if(init.exitCode!==0||init.timedOut||init.cleanupFailed)throw new Error('Owned scratch Git initialization failed');
  for(const f of manifest.files??[]){const path=join(scratch.cwd,f.path);mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,f.content,{mode:0o600,flag:'wx'});}
  if(manifest.documentation){try{const bytes=readBoundedProofFile(resolve(manifestDir,manifest.documentation.path));if(hash(bytes)!==manifest.documentation.sha256)report.freshness.issues.push('documentation-digest-changed');}catch{report.freshness.issues.push('documentation-unavailable');}}
  for(const advertised of manifest.advertisedOptions??[]){const command=options.metadata?.find(c=>c.command===advertised.command);if(!command)report.freshness.issues.push(`command-missing:${advertised.command}`);else for(const flag of advertised.flags)if(!command.flags.includes(flag))report.freshness.issues.push(`option-missing:${advertised.command}:${flag}`);}
  report.freshness.state=report.freshness.issues.length?'stale':manifest.documentation||manifest.advertisedOptions?'current':'unknown';
  let stopped:false|'failed'|'inconclusive'=false;
  for(const step of manifest.steps){
   if(stopped){missing(step,stopped==='inconclusive'?'inconclusive':'missing','earlier-step-incomplete');continue;}
   if(options.signal?.aborted||deadline<=Date.now()){missing(step,'inconclusive','journey-deadline');stopped='inconclusive';continue;}
   let entry:string|undefined;
   if(step.argv.includes('{cli}')){
    try{
     if(manifest.artifact.mode==='source-candidate')entry=realpathSync(resolve(manifestDir,manifest.artifact.entrypoint));
     else {const base=join(scratch.cwd,'node_modules',manifest.artifact.package),pkg=JSON.parse(readFileSync(join(base,'package.json'),'utf8'));if(pkg.name!==manifest.artifact.package||pkg.version!==manifest.artifact.version)throw new Error('Installed package identity mismatch');entry=realpathSync(join(base,manifest.artifact.entrypoint));if(!isPathWithinPackage(realpathSync(base),entry))throw new Error('Entrypoint outside package');}
    }catch{missing(step,'missing','selected-artifact-entrypoint-unavailable');stopped='failed';continue;}
   }
   const placeholders:Record<string,string>={workspace:scratch.cwd,home:scratch.home,node:process.execPath,manifestDir};
   const argv=step.argv.flatMap(arg=>arg==='{cli}'?[process.execPath,entry!]:[arg.replace(/\{(workspace|home|node|manifestDir)\}/g,(_,name:string)=>placeholders[name])]);
   let result;try{result=await adapter.run({cwd:scratch.cwd,argv,env:scratch.env,timeoutMs:Math.min(step.timeoutMs??120000,deadline-Date.now()),maxOutputBytes:manifest.maxOutputBytes??65536,signal:options.signal});}catch{missing(step,'inconclusive','runner-error');stopped='inconclusive';continue;}
   const stdout=redactedOutput(result.stdout,manifest.maxOutputBytes??65536),stderr=redactedOutput(result.stderr,manifest.maxOutputBytes??65536);
   const incomplete=result.timedOut||result.aborted||result.cleanupFailed||stdout.truncated||stderr.truncated;
   let passed=result.exitCode===step.expectedExit&&(step.stdoutIncludes??[]).every(s=>result.stdout.text.includes(s));
   if(step.expectedJson!==undefined){try{passed=passed&&subset(JSON.parse(result.stdout.text),step.expectedJson);}catch{passed=false;}}
   const outcome=incomplete?'inconclusive':passed?'passed':'failed';
   report.checks.push({id:step.id,outcome,expectedExit:step.expectedExit,actualExit:result.exitCode,stdout,stderr,durationMs:result.durationMs});
   if(outcome!=='passed'){report.issues.push(`${step.id}:${incomplete?'execution-incomplete':'expectation-mismatch'}`);stopped=incomplete?'inconclusive':'failed';}
  }
 }finally{try{scratch.cleanup();}catch{report.issues.push('scratch-cleanup-refused');for(const check of report.checks)if(check.outcome==='passed')check.outcome='inconclusive';}}
 report.functionalState=report.checks.some(c=>c.outcome==='failed'||c.outcome==='missing')?'failed':report.checks.some(c=>c.outcome==='inconclusive')?'inconclusive':'verified';
 report.decision=report.functionalState==='failed'||report.freshness.state==='stale'?{state:'failed',reason:'Journey expectations or documentation freshness failed'}:report.functionalState==='inconclusive'?{state:'inconclusive',reason:'Execution evidence is incomplete'}:{state:'verified',reason:'Selected explicit journey matched its expectations'};
 publishDocsReport(options.cwd,report);return report;
}
