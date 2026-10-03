import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const transient = /E404|ETARGET|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|E503|E502/i;
async function run(argv, {cwd, timeoutMs}) {
  return new Promise(resolveResult => {
    const executable = argv[0];
    const arguments_ = argv.slice(1);
    const child = spawn(executable, arguments_, {cwd, shell:false, detached:process.platform!=='win32', stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',bytes=0,settled=false,timedOut=false,outputLimit=false;
    const kill=()=>{try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
    const timer=setTimeout(()=>{timedOut=true;kill();},timeoutMs);
    const finish=code=>{if(settled)return;settled=true;clearTimeout(timer);resolveResult({code:code??124,timedOut,outputLimit,stdout,stderr});};
    for(const name of ['stdout','stderr']) child[name].on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){outputLimit=true;kill();return;}if(name==='stdout')stdout+=chunk;else stderr+=chunk;});
    child.on('error',()=>finish(127));child.on('close',finish);
  });
}
export async function verifyPublishedCli(options, deps={run,now:Date.now,sleep:ms=>new Promise(r=>setTimeout(r,ms))}) {
  if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(options.version))throw new Error('An exact version is required');
  const deadlineMs=options.deadlineMs??600000;
  if(!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>600000)throw new Error('deadline-ms must be 1..600000');
  const root=mkdtempSync(join(tmpdir(),'quorate-published-')), deadline=deps.now()+deadlineMs;
  let attempts=0,stage='metadata';
  const fail=detail=>({ok:false,stage,attempts,detail});
  const call=(argv,budgetMs=10000)=>{
    const remaining=deadline-deps.now();
    if(remaining<=0)return Promise.resolve({code:124,timedOut:true,stdout:'',stderr:''});
    return deps.run(argv,{cwd:root,timeoutMs:Math.min(budgetMs,remaining)});
  };
  const retryable=result=>!result.outputLimit&&(result.timedOut||transient.test(result.stderr));
  const retry=async()=>{const remaining=deadline-deps.now();if(remaining<=0)return false;await deps.sleep(Math.min(10000,remaining));return deps.now()<deadline;};
  try {
    writeFileSync(join(root,'clean.diff'),'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # Release smoke\n+No dependency changes.\n');
    writeFileSync(join(root,'unsafe.diff'),'diff --git a/Dockerfile b/Dockerfile\nnew file mode 100644\n--- /dev/null\n+++ b/Dockerfile\n@@ -0,0 +1 @@\n+FROM node:22\n');
    do {
      attempts++;stage='metadata';
      const metadata=await call(['npm','view',`quorate@${options.version}`,'version','dist.integrity','--json','--prefer-online','--fetch-retries=0','--fetch-timeout=10000']);
      if(metadata.code!==0){if(retryable(metadata)&&await retry())continue;return fail('Registry availability or transport failure');}
      let info;try{info=JSON.parse(metadata.stdout);}catch{return fail('Invalid registry JSON');}
      if(info?.version!==options.version||typeof (info['dist.integrity']??info.dist?.integrity)!=='string')return fail('Registry version or integrity metadata mismatch');
      stage='install';
      const installed=await call(['npm','install','--prefix',root,'--ignore-scripts','--prefer-online','--fetch-retries=0','--fetch-timeout=10000','--no-audit','--no-fund',`quorate@${options.version}`],120000);
      if(installed.code!==0){if(retryable(installed)&&await retry())continue;return fail('Exact-version installation failed');}
      const entry=join(root,'node_modules/quorate/dist/index.js'),cli=[process.execPath,entry];
      stage='version';const version=await call([...cli,'--version']);if(version.code!==0||version.stdout.trim()!==options.version)return fail('Installed CLI version mismatch');
      stage='help';const help=await call([...cli,'--help']);if(help.code!==0||!help.stdout.trim())return fail('CLI help failed');
      for(const unsafe of [false,true]){
        if(deps.now()>=deadline)return fail('Shared deadline exhausted');
        stage=unsafe?'unsafe-gate':'clean-gate';
        const smoke=await call([...cli,'--cwd',root,'supply-chain','scan','--diff',join(root,unsafe?'unsafe.diff':'clean.diff'),'--json','--gate',...(unsafe?['--fail-on','medium']:[])]);
        if(smoke.code!==(unsafe?1:0))return fail('Unexpected gate exit code');
        let report;try{report=JSON.parse(smoke.stdout);}catch{return fail('Invalid smoke JSON');}
        if(!Array.isArray(report.findings)|| (unsafe?report.findings.length===0:report.findings.length!==0))return fail('Unexpected gate findings');
      }
      return {ok:true,stage:'complete',attempts};
    }while(deps.now()<deadline);
    return fail('Shared deadline exhausted');
  }finally{rmSync(root,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const args=process.argv.slice(2),options={};
    for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--version','--deadline-ms'].includes(key)||!args[i+1])throw new Error('Use --version and optional --deadline-ms');options[key==='--version'?'version':'deadlineMs']=key==='--version'?args[i+1]:Number(args[i+1]);}
    const result=await verifyPublishedCli(options);console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
