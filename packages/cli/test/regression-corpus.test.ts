import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';import { join } from 'node:path';
import { classifyRegressionPair, type RegressionIssue } from '@quorate/core';
import { parseVitestObservation } from '../src/regression/vitest-adapter.js';
import { runRegression } from '../src/regression/runner.js';
import { regressionFixture, git } from './regression-fixture.js';
import { reporter, execution } from './regression-reporter-fixture.js';
interface Case {id:string;group:string;mode:string;base:string;head:string;fullName?:string;headFailure?:string;mutation?:string;issue?:RegressionIssue;expected:{state:string;reason:string}}
const corpus=JSON.parse(readFileSync(new URL('./fixtures/regression-corpus/manifest.json',import.meta.url),'utf8')) as {cases:Case[]};
it('freezes 24 cases in six equal groups with execution evidence labels',()=>{
 expect(corpus.cases).toHaveLength(24);expect(new Set(corpus.cases.map(c=>c.id)).size).toBe(24);for(const group of new Set(corpus.cases.map(c=>c.group)))expect(corpus.cases.filter(c=>c.group===group)).toHaveLength(4);expect(corpus.cases.filter(c=>c.mode==='live-process')).toHaveLength(4);
});
for(const c of corpus.cases){
 it.skipIf(c.mode==='live-process'&&process.platform==='win32')(`${c.mode}: ${c.id} → ${c.expected.state}/${c.expected.reason}`,async()=>{
  if(c.mode==='live-process'){
   const options=c.id==='real-unfixed'?{fixed:false}:c.id==='real-weak'?{test:"import {it,expect} from 'vitest';it('fixes value',()=>expect(true).toBe(true))"}:c.id==='real-import-error'?{test:"import {it} from 'vitest';import '../missing.js';it('fixes value',()=>{});"}:{};
   const f=regressionFixture({...options,install:true}),outside=mkdtempSync(join(tmpdir(),'regression-corpus-input-')),path=join(outside,'manifest.json'),before=git(f.root,'worktree','list','--porcelain');
   try{writeFileSync(path,JSON.stringify({...f.manifest,setupArgv:['npm','ci','--ignore-scripts','--no-audit','--no-fund']}));const result=await runRegression({cwd:f.root,manifestPath:path});expect(result.decision).toMatchObject(c.expected);expect(git(f.root,'status','--porcelain')).toBe('');expect(git(f.root,'worktree','list','--porcelain')).toBe(before);}
   finally{rmSync(f.root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
  }else{
   const selection={fullName:c.fullName??'fixes value',expectedFailureText:'expected +0 to be 1',testFiles:['test/value.test.js'],checkoutDir:'/fixture'};
   const observe=(target:'base'|'head',status:string)=>{
    const effectiveStatus=c.mutation==='missing'&&target==='base'?'passed':status;
    const raw=reporter(effectiveStatus);raw.testResults[0]!.assertionResults[0]!.fullName=c.mutation==='missing'&&target==='base'?'other':selection.fullName;
    if(target==='head'&&c.headFailure)raw.testResults[0]!.assertionResults[0]!.failureMessages=[c.headFailure];
    const result=execution(raw,effectiveStatus==='failed'?1:0);
    if(target==='base'){if(c.mutation==='malformed')result.stdout.text='{';if(c.mutation==='truncated')result.stdout.truncated=true;if(c.mutation==='aborted')result.aborted=true;if(c.mutation==='cleanup')result.cleanupFailed=true;}
    return parseVitestObservation(result,selection,target);
   };
   const decision=classifyRegressionPair({base:observe('base',c.base),head:observe('head',c.head),issues:c.issue?[c.issue]:[]});expect(decision).toMatchObject(c.expected);if(c.expected.state!=='verified')expect(decision.state).not.toBe('verified');
  }
 },120000);
}
