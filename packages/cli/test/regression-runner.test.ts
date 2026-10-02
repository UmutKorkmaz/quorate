import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { regressionFixture, git } from './regression-fixture.js';
import { runRegression } from '../src/regression/runner.js';
async function run(options:Parameters<typeof regressionFixture>[0]={},manifestDelta:Record<string,unknown>={},signal?:AbortSignal){
 const f=regressionFixture({...options,install:true}),outside=mkdtempSync(join(tmpdir(),'regression-selected-')),path=join(outside,'manifest.json');
 writeFileSync(path,JSON.stringify({...f.manifest,setupArgv:['npm','ci','--ignore-scripts','--no-audit','--no-fund'],...manifestDelta}));
 const before=git(f.root,'worktree','list','--porcelain');
 try{const r=await runRegression({cwd:f.root,manifestPath:path,signal});expect(git(f.root,'worktree','list','--porcelain')).toBe(before);expect(git(f.root,'status','--porcelain')).toBe('');return r;}
 finally{rmSync(f.root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
}
it.skipIf(process.platform==='win32')('reproduces BASE failure and verifies HEAD fix using actual installed Vitest',async()=>{
 const r=await run();expect(r.decision).toMatchObject({state:'verified',reason:'reproduced-and-fixed'});expect(r.executions.filter(e=>e.phase!=='setup').map(e=>e.runnerVersion)).toEqual(['4.1.11','4.1.11']);
},120000);
it.skipIf(process.platform==='win32')('verifies actual nested Vitest suites with consistent ancestor totals',async()=>{
 const r=await run({test:"import {describe,it,expect} from 'vitest';import {value} from '../value.js';describe('values',()=>describe('nested',()=>it('fixes value',()=>expect(value).toBe(1))));"},{assertion:{fullName:'values nested fixes value',expectedFailureText:'expected +0 to be 1'}});
 expect(r.decision).toMatchObject({state:'verified',reason:'reproduced-and-fixed'});
},120000);
it.skipIf(process.platform==='win32')('an unfixed bug is contradicted',async()=>{expect((await run({fixed:false})).decision).toMatchObject({state:'contradicted',reason:'not-fixed'});},120000);
it.skipIf(process.platform==='win32')('an ineffective test never verifies',async()=>{expect((await run({test:"import {it,expect} from 'vitest'; it('fixes value',()=>expect(true).toBe(true));"})).decision.reason).toBe('not-reproduced');},120000);
it.skipIf(process.platform==='win32')('test import failure is inconclusive',async()=>{expect((await run({test:"import {it,expect} from 'vitest'; import '../missing.js'; it('fixes value',()=>expect(true).toBe(true));"})).decision.state).toBe('inconclusive');},120000);
it.skipIf(process.platform==='win32')('production mutation prevents verification and secret output is redacted',async()=>{
 const fake='sk-abcdefghijklmnopqrstuvwxyz123456';
 const r=await run({test:`import {it,expect} from 'vitest';import {writeFileSync} from 'node:fs';import {value} from '../value.js';it('fixes value',()=>{writeFileSync('value.js','changed');console.error('token=${fake}');expect(value).toBe(1)});`});
 expect(r.decision.state).toBe('inconclusive');expect(r.decision.issues.some(i=>i.reason==='input-mutated')).toBe(true);expect(JSON.stringify(r)).not.toContain(fake);
},120000);

it.skipIf(process.platform==='win32')('setup output truncation is inconclusive before executing assertions',async()=>{const r=await run({}, {maxOutputBytes:1});expect(r.decision.reason).toBe('incomplete-output');expect(r.executions.every(e=>e.phase==='setup')).toBe(true);},120000);
it.skipIf(process.platform==='win32')('cancellation removes owned checkouts and never verifies',async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),200);try{const r=await run({}, {},controller.signal);expect(r.decision.state).toBe('inconclusive');expect(r.decision.issues.some(i=>i.reason==='cancelled')).toBe(true);}finally{clearTimeout(timer);}},120000);
it('Windows execution preflight refuses before checkout or setup, retaining pure evidence inspection',async()=>{
 const f=regressionFixture(),outside=mkdtempSync(join(tmpdir(),'regression-windows-preflight-')),path=join(outside,'manifest.json'),original=process.platform;
 try{writeFileSync(path,JSON.stringify(f.manifest));const before=git(f.root,'worktree','list','--porcelain');
 Object.defineProperty(process,'platform',{value:'win32'});const pending=runRegression({cwd:f.root,manifestPath:path});Object.defineProperty(process,'platform',{value:original});
 const result=await pending;expect(result.decision).toMatchObject({state:'inconclusive',reason:'unsupported-platform'});expect(result.executions).toEqual([]);expect(git(f.root,'worktree','list','--porcelain')).toBe(before);expect(git(f.root,'status','--porcelain')).toBe('');
 }finally{Object.defineProperty(process,'platform',{value:original});rmSync(f.root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
