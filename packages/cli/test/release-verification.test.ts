import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyRelease } from '../src/release/runner.js';
const roots:string[]=[];
afterEach(()=>{for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
const integrity='sha512-'+Buffer.alloc(64,1).toString('base64');
function fixture(scenario:string){
 const cwd=mkdtempSync(join(tmpdir(),'quorate-release-test-'));roots.push(cwd);const manifestPath=join(cwd,'release.json');
 writeFileSync(manifestPath,JSON.stringify({schemaVersion:1,sourceRevision:'a'.repeat(40),deadlineMs:30000,destinations:[{id:'npm',kind:'npm',package:'quorate',version:'1.5.0',expectedIntegrity:integrity,submission:scenario==='rejected'?'rejected':'accepted'},{id:'asset',kind:'github',repository:'owner/repo',tag:'v1.5.0',assetId:123,name:'cli.tgz',expectedSha256:'b'.repeat(64)}]}));
 let now=0,metadata=0,smokes=0;const calls:string[]=[];
 const adapters={now:()=>now,sleep:async(ms:number)=>{now+=ms;},observe:async(target:any)=>{calls.push(`observe:${target.id}`);if(target.kind==='npm'){
  if(scenario==='metadata-delay'&&++metadata===1)return {status:'missing'};
  return {status:'available',version:scenario==='wrong-version'?'1.4.0':'1.5.0',digest:scenario==='wrong-digest'?'sha512-'+Buffer.alloc(64,2).toString('base64'):integrity};
 }if(scenario==='missing-asset'||scenario==='mixed')return {status:'missing'};return {status:'available',assetId:123,name:'cli.tgz',digest:'b'.repeat(64)};},smoke:async()=>{calls.push('smoke');if(scenario==='install-delay'&&++smokes===1)return {status:'missing'};return {status:'verified'};}};
 return {cwd,manifestPath,adapters,calls};
}
it.each([['available','verified','verified','verified'],['metadata-delay','verified','verified','verified'],['install-delay','verified','verified','verified'],['wrong-version','failed','failed','verified'],['wrong-digest','failed','failed','verified'],['missing-asset','failed','verified','failed'],['rejected','failed','failed','verified'],['mixed','failed','verified','failed']])('classifies %s with exact destination states',async(scenario,decision,npm,asset)=>{
 const f=fixture(scenario);const report=await verifyRelease(f,f.adapters);
 expect(report.decision.state).toBe(decision);expect(report.destinations.map((d:any)=>d.state)).toEqual([npm,asset]);
 expect(f.calls.some(c=>/publish|tag|create/.test(c))).toBe(false);
 expect(report.producer.trust).toBe('unattested');
});
it('retains partial verification and original deadline on rerun',async()=>{
 const f=fixture('mixed');const before=await verifyRelease(f,f.adapters);f.calls.length=0;
 const after=await verifyRelease(f,f.adapters);expect(after.deadlineAt).toBe(before.deadlineAt);expect(after.destinations[0]).toEqual(before.destinations[0]);expect(f.calls).toEqual([]);
});
it('cannot overwrite a terminal digest mismatch during recovery',async()=>{
 const f=fixture('wrong-digest');await verifyRelease(f,f.adapters);f.calls.length=0;f.adapters.observe=async()=>({status:'available',version:'1.5.0',digest:integrity});
 const report=await verifyRelease(f,f.adapters);expect(report.destinations[0].state).toBe('failed');expect(f.calls).toEqual([]);
});
it('records each availability observation and persists readable report',async()=>{
 const f=fixture('metadata-delay');const report=await verifyRelease(f,f.adapters);expect(report.destinations[0].observations.map((o:any)=>o.state)).toContain('unknown');expect(JSON.parse(readFileSync(join(f.cwd,'.quorate/releases/latest.json'),'utf8'))).toEqual(report);
});
it('rejects non-exact identities before touching an adapter',async()=>{
 const f=fixture('available');const value=JSON.parse(readFileSync(f.manifestPath,'utf8'));value.destinations[0].version='latest';writeFileSync(f.manifestPath,JSON.stringify(value));
 await expect(verifyRelease(f,f.adapters)).rejects.toThrow();expect(f.calls).toEqual([]);
});
it('keeps incomplete identity unknown instead of calling it a wrong artifact',async()=>{
 const f=fixture('available');f.adapters.observe=async()=>({status:'available'} as any);const report=await verifyRelease(f,f.adapters);expect(report.decision.state).toBe('inconclusive');expect(report.destinations.every((d:any)=>d.state==='unknown')).toBe(true);
});
it('cannot smoke after the shared deadline elapsed during metadata',async()=>{
 const f=fixture('available');let now=0;f.adapters.now=()=>now;f.adapters.observe=async()=>{now=30001;return {status:'available',version:'1.5.0',digest:integrity};};const report=await verifyRelease(f,f.adapters);expect(report.decision.state).toBe('failed');expect(f.calls).not.toContain('smoke');
});
it('retains expected and observed digests as independent observations',async()=>{
 const f=fixture('wrong-digest');const report=await verifyRelease(f,f.adapters);expect(report.destinations[0].expectedDigest).toBe(integrity);expect(report.destinations[0].observations.at(-1).digest).not.toBe(integrity);expect(report.destinations[0].observations.at(-1).version).toBe('1.5.0');
});
it('stops distribution work after cancellation while retaining unknown destinations',async()=>{
 const f=fixture('available'),controller=new AbortController();f.adapters.observe=async()=>{controller.abort();return {status:'available',version:'1.5.0',digest:integrity};};const report=await verifyRelease({...f,signal:controller.signal},f.adapters);expect(report.decision.state).toBe('inconclusive');expect(f.calls).not.toContain('smoke');
});
it('preserves recovery identity when JSON object keys are reordered',async()=>{
 const f=fixture('mixed');const first=await verifyRelease(f,f.adapters);const old=JSON.parse(readFileSync(f.manifestPath,'utf8'));writeFileSync(f.manifestPath,JSON.stringify({destinations:old.destinations,deadlineMs:old.deadlineMs,sourceRevision:old.sourceRevision,schemaVersion:old.schemaVersion}));const second=await verifyRelease(f,f.adapters);expect(second.manifestDigest).toBe(first.manifestDigest);expect(second.deadlineAt).toBe(first.deadlineAt);
});
it('rejects a successful smoke that finishes after the persisted deadline',async()=>{
 const f=fixture('available');const value=JSON.parse(readFileSync(f.manifestPath,'utf8'));value.deadlineMs=1000;value.destinations=value.destinations.slice(0,1);writeFileSync(f.manifestPath,JSON.stringify(value));let now=0;f.adapters.now=()=>now;f.adapters.smoke=async()=>{now=1001;return {status:'verified'};};
 const report=await verifyRelease(f,f.adapters);expect(report.decision.state).toBe('failed');expect(report.destinations[0].state).toBe('failed');expect(report.destinations[0].observations.at(-1).code).toBe('verification-deadline-exhausted');
 const recovered=await verifyRelease(f,f.adapters);expect(recovered).toEqual(report);
});
it('keeps a cancelled successful smoke inconclusive and retryable without extending its deadline',async()=>{
 const f=fixture('available');const value=JSON.parse(readFileSync(f.manifestPath,'utf8'));value.destinations=value.destinations.slice(0,1);writeFileSync(f.manifestPath,JSON.stringify(value));const controller=new AbortController();f.adapters.smoke=async()=>{controller.abort();return {status:'verified'};};
 const report=await verifyRelease({...f,signal:controller.signal},f.adapters);expect(report.decision.state).toBe('inconclusive');expect(report.destinations[0].state).toBe('unknown');expect(report.destinations[0].checks.find((c:any)=>c.id==='smoke').outcome).toBe('inconclusive');
 f.adapters.smoke=async()=>({status:'verified'});const recovered=await verifyRelease(f,f.adapters);expect(recovered.deadlineAt).toBe(report.deadlineAt);expect(recovered.decision.state).toBe('verified');
});
