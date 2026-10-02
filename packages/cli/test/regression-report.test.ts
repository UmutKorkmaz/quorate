import { expect, it } from 'vitest';
import { mkdtempSync, realpathSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RegressionRunResult, RegressionObservation } from '@quorate/core';
import { normalizeRegressionManifest, resolveRegressionInput } from '../src/regression/manifest.js';
import { publishRegressionReport, verifyRegressionReport } from '../src/regression/report.js';
import { regressionFixture } from './regression-fixture.js';
import { resultFor } from './regression-report-fixture.js';
it('verifies explicit local trust and digest integrity separately, then detects tampering and stale source',()=>{
 const f=regressionFixture(),keyDir=realpathSync(mkdtempSync(join(tmpdir(),'regression-keys-')));
 try{
 const result=resultFor(f.root,f.manifest),report=publishRegressionReport(f.root,result,{keyDir}),path=join(f.root,'.quorate/regressions/latest.json');
 const options={cwd:f.root,path,baseSha:f.base,headSha:f.head,manifestDigest:result.input.manifestDigest,bundleDigest:result.input.bundleDigest,trust:{mode:'local' as const,keyDir}};
 expect(verifyRegressionReport(options)).toMatchObject({ok:true,trustMode:'local-assertion'});
 expect(verifyRegressionReport({...options,trust:{mode:'digest',expectedHash:report.artifactHash}})).toMatchObject({ok:true,trustMode:'content-only'});
 expect(verifyRegressionReport({...options,headSha:'0'.repeat(40)}).reason).toBe('stale');
 expect(verifyRegressionReport({...options,trust:{mode:'local',keyDir:join(keyDir,'missing')}}).reason).toBe('untrusted');
 writeFileSync(join(f.root,'value.js'),'dirty');expect(verifyRegressionReport(options).reason).toBe('stale');
 const data=JSON.parse(readFileSync(path,'utf8'));data.decision.state='contradicted';writeFileSync(path,JSON.stringify(data));expect(verifyRegressionReport(options).reason).toBe('tampered');
 expect(JSON.stringify(report)).not.toContain('"assets"');expect(JSON.stringify(report)).not.toContain('"sourceRoot"');
 }finally{rmSync(f.root,{recursive:true,force:true});rmSync(keyDir,{recursive:true,force:true});}
});
it('retains at most 100 immutable artifact records',()=>{
 const f=regressionFixture(),keyDir=realpathSync(mkdtempSync(join(tmpdir(),'regression-keys-')));
 try{const result=resultFor(f.root,f.manifest);for(let i=0;i<102;i++)publishRegressionReport(f.root,{...result,durationMs:i,finishedAt:i===101?'2026-10-01T10:00:00.000Z':result.finishedAt},{keyDir});expect(readdirSync(join(f.root,'.quorate/regressions/history')).filter(n=>n.endsWith('.json'))).toHaveLength(100);}
 finally{rmSync(f.root,{recursive:true,force:true});rmSync(keyDir,{recursive:true,force:true});}
},30000);
