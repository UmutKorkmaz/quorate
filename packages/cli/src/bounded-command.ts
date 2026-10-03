import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { BoundedCommandResult } from '@quorate/core';
export type { BoundedCommandResult } from '@quorate/core';
export interface BoundedCommandOptions {cwd:string;argv:string[];timeoutMs:number;maxOutputBytes:number;signal?:AbortSignal;env?:NodeJS.ProcessEnv}
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export async function executeBoundedCommand(options:BoundedCommandOptions):Promise<BoundedCommandResult>{
 const start=Date.now();
 const result:BoundedCommandResult={exitCode:null,timedOut:false,aborted:options.signal?.aborted??false,stdout:{text:'',truncated:false},stderr:{text:'',truncated:false},cleanupFailed:false,durationMs:0};
 if(result.aborted)return result;
 if(process.platform==='win32')throw new Error('Process-tree execution is unsupported on Windows');
 if(!options.argv.length||options.argv.some(s=>typeof s!=='string'||s.includes('\0'))||!options.argv[0]||!Number.isInteger(options.timeoutMs)||options.timeoutMs<1||!Number.isInteger(options.maxOutputBytes)||options.maxOutputBytes<1)throw new Error('Invalid bounded command options');
 return new Promise<BoundedCommandResult>(resolveResult=>{
  // The caller authorizes this operator-selected argv before execution.
  // Keep the executable and arguments distinct; neither enters a shell.
  const executable = options.argv[0]!;
  const arguments_ = options.argv.slice(1);
  const child=spawn(executable,arguments_,{cwd:options.cwd,env:options.env,shell:false,detached:true,stdio:['ignore','pipe','pipe']});
  let finishing=false,closed=false,killTimer:NodeJS.Timeout|undefined;
  const bytes={stdout:0,stderr:0},decoders={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')};
  const alive=()=>{if(!child.pid)return false;try{process.kill(-child.pid,0);return true;}catch{return false;}};
  const kill=(signal:NodeJS.Signals)=>{if(child.pid){try{process.kill(-child.pid,signal);}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')result.cleanupFailed=true;}}};
  const interrupt=()=>{kill('SIGTERM');killTimer??=setTimeout(()=>kill('SIGKILL'),1000);};
  const abort=()=>{if(finishing)return;result.aborted=true;interrupt();};
  options.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{result.timedOut=true;interrupt();},options.timeoutMs);
  const finish=async(code:number|null)=>{
   if(finishing)return;finishing=true;result.exitCode=code;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
   const deadline=Date.now()+2000;
   kill('SIGTERM');const grace=Date.now()+1000;
   while(alive()&&Date.now()<grace)await sleep(10);
   if(alive())kill('SIGKILL');
   while((alive()||!closed)&&Date.now()<deadline)await sleep(10);
   if(alive()||!closed)result.cleanupFailed=true;
   if(killTimer)clearTimeout(killTimer);
   child.stdout.destroy();child.stderr.destroy();result.durationMs=Date.now()-start;resolveResult(result);
  };
  for(const stream of ['stdout','stderr'] as const)child[stream].on('data',(chunk:Buffer)=>{
   const remaining=Math.max(0,options.maxOutputBytes-bytes[stream]);
   const kept=chunk.subarray(0,remaining);bytes[stream]+=kept.length;
   if(chunk.length>remaining)result[stream].truncated=true;
   result[stream].text+=decoders[stream].write(kept);
  });
  child.once('error',()=>{closed=true;void finish(127);});
  child.once('exit',code=>{void finish(code);});
  child.once('close',code=>{closed=true;void finish(code);});
  // A signal can abort between preflight and listener registration.
  if(options.signal?.aborted)abort();
 });
}
