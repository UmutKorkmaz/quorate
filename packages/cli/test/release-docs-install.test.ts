import { expect,it } from 'vitest';
import { mkdirSync,writeFileSync,existsSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ownedScratch } from '../src/release/scratch.js';
import { executeBoundedCommand } from '../src/bounded-command.js';
import { createNativeReleaseAdapters } from '../src/release/adapters.js';
import { checkDocs } from '../src/docs-check/runner.js';
it.skipIf(process.platform==='win32')('packs and installs a real owned fixture then verifies version/help/demo/blocked/corrected journeys',async()=>{
 const scratch=ownedScratch('quorate-native-package-test-');
 try{
  const name='quorate-owned-fixture',version='1.0.0';mkdirSync(join(scratch.cwd,'dist'));writeFileSync(join(scratch.cwd,'package.json'),JSON.stringify({name,version,type:'module',bin:{quorate:'dist/index.js'},files:['dist']}));
  writeFileSync(join(scratch.cwd,'dist/index.js'),'#!/usr/bin/env node\n'+`import {readFileSync,writeFileSync} from 'node:fs';\nconst a=process.argv.slice(2);\nif(a.includes('--version'))console.log('${version}');\nelse if(a.includes('--help'))console.log('Owned fixture help');\nelse if(a.includes('setup')){writeFileSync('demo.json','{}');console.log(JSON.stringify({demo:true}));}\nelse {const unsafe=readFileSync(a[a.indexOf('--diff')+1],'utf8').includes('FROM');console.log(JSON.stringify({findings:unsafe?[{severity:'medium'}]:[]}));process.exitCode=unsafe?1:0;}\n`);
  const packed=await executeBoundedCommand({cwd:scratch.cwd,argv:['npm','pack','--json','--ignore-scripts','--pack-destination',scratch.cwd],timeoutMs:30000,maxOutputBytes:65536,env:scratch.env});expect(packed.exitCode).toBe(0);const metadata=JSON.parse(packed.stdout.text)[0],tarball=join(scratch.cwd,metadata.filename);
  const observedRoots:string[]=[];
  const native=createNativeReleaseAdapters({now:Date.now,fetch,run:async(options)=>{
   observedRoots.push(options.cwd);const argv=options.argv.map(a=>a===`${name}@${version}`?tarball:a);return executeBoundedCommand({...options,argv});
  }});
  expect(await native.smoke({id:'owned',kind:'npm',package:name,version,expectedIntegrity:metadata.integrity},120000)).toEqual({status:'verified'});
  expect(observedRoots.every(path=>!existsSync(path))).toBe(true);
  const manifestPath=join(scratch.cwd,'docs.json');writeFileSync(manifestPath,JSON.stringify({schemaVersion:1,sourceRevision:'a'.repeat(40),artifact:{mode:'published-package',package:name,version,entrypoint:'dist/index.js'},files:[{path:'unsafe.diff',content:'FROM node:22'},{path:'clean.diff',content:'No dependency changes'}],steps:[
   {id:'install',argv:['npm','install','--prefix','{workspace}','--ignore-scripts','--no-audit','--no-fund',tarball],expectedExit:0},
   {id:'version',argv:['{cli}','--version'],expectedExit:0,stdoutIncludes:[version]},
   {id:'help',argv:['{cli}','--help'],expectedExit:0,stdoutIncludes:['Owned fixture help']},
   {id:'demo',argv:['{cli}','setup','demo'],expectedExit:0,expectedJson:{demo:true}},
   {id:'blocked',argv:['{cli}','supply-chain','scan','--diff','{workspace}/unsafe.diff','--json','--gate'],expectedExit:1,expectedJson:{findings:[{severity:'medium'}]}},
   {id:'corrected',argv:['{cli}','supply-chain','scan','--diff','{workspace}/clean.diff','--json','--gate'],expectedExit:0,expectedJson:{findings:[]}}
  ]}));
  const report=await checkDocs({cwd:scratch.cwd,manifestPath});expect(report.decision.state).toBe('verified');expect(report.checks).toHaveLength(6);expect(report.checks.every(c=>c.outcome==='passed')).toBe(true);
  const sourceManifest=JSON.parse(readFileSync(manifestPath,'utf8'));sourceManifest.artifact={mode:'source-candidate',entrypoint:join(scratch.cwd,'dist/index.js')};sourceManifest.steps=sourceManifest.steps.slice(1);const sourcePath=join(scratch.cwd,'source-docs.json');writeFileSync(sourcePath,JSON.stringify(sourceManifest));
  const sourceReport=await checkDocs({cwd:scratch.cwd,manifestPath:sourcePath});expect(sourceReport.artifactMode).toBe('source-candidate');expect(sourceReport.decision.state).toBe('verified');expect(sourceReport.checks).toHaveLength(5);expect(sourceReport.checks.every(c=>c.outcome==='passed')).toBe(true);
 }finally{scratch.cleanup();}
},120000);
