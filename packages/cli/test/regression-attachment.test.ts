import { expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';import { join } from 'node:path';
import { prepareRegressionAttachment } from '../src/regression/attachment.js';
import { publishRegressionReport } from '../src/regression/report.js';
import { regressionFixture } from './regression-fixture.js';
import { resultFor } from './regression-report-fixture.js';
import { createDecisionRecord, createDefaultConfig, decisionInputHash, resolvePolicy } from '@quorate/core';
it('requires current verified local evidence, combines ordinary proof, and binds its summary in the receipt',()=>{
 const f=regressionFixture(),keys=realpathSync(mkdtempSync(join(tmpdir(),'regression-attachment-'))),manifest=join(keys,'manifest.json');
 try{writeFileSync(manifest,JSON.stringify(f.manifest));const result=resultFor(f.root,f.manifest),r=publishRegressionReport(f.root,result,{keyDir:keys}),path=join(f.root,'.quorate/regressions/latest.json');
 const options={cwd:f.root,reportPath:path,manifestPath:manifest,baseSha:f.base,headSha:f.head,keyDir:keys,required:true};
 const a=prepareRegressionAttachment({...options,existingProof:{name:'tests',content:'ordinary proof',truncated:false}});expect(a.gate).toBe('allow');expect(a.proof?.content).toContain(r.artifactHash);expect(a.proof?.content).toContain('ordinary proof');
 expect(Buffer.byteLength(prepareRegressionAttachment({...options,existingProof:{name:'tests',content:'é'.repeat(10000),truncated:false}}).proof!.content)).toBeLessThanOrEqual(8192);
 const config=createDefaultConfig(),request={mode:'review' as const,subject:'fixture',diff:'diff',proof:a.proof};const report={verdict:'pass',findings:[],providerResults:[],summary:'fixture',metadata:{generatedAt:'2026-10-02T10:00:01.000Z',mode:'review',subject:'fixture',providers:[],requestedProviders:[],ranProviders:[],degraded:false}} as never;
 const receipt=createDecisionRecord(request,config,report,resolvePolicy(config));expect(receipt.inputs.proofHash).toBe(decisionInputHash(a.proof!.content));
 expect(prepareRegressionAttachment({...options,headSha:'0'.repeat(40)}).gate).toBe('block');
 expect(prepareRegressionAttachment({...options,reportPath:join(keys,'missing')}).gate).toBe('block');
 expect(prepareRegressionAttachment({...options,keyDir:join(keys,'no-key')}).gate).not.toBe('allow');
 const invalid=join(keys,'unknown.json');writeFileSync(invalid,JSON.stringify({schemaVersion:99,kind:'regression'}));expect(prepareRegressionAttachment({...options,reportPath:invalid}).gate).toBe('error');
 }finally{rmSync(f.root,{recursive:true,force:true});rmSync(keys,{recursive:true,force:true});}
},15000);
it('required inconclusive blocks while optional evidence is visibly incomplete',()=>{
 const f=regressionFixture(),keys=realpathSync(mkdtempSync(join(tmpdir(),'regression-attachment-'))),manifest=join(keys,'manifest.json');
 try{writeFileSync(manifest,JSON.stringify(f.manifest));const result=resultFor(f.root,f.manifest);result.executions=[];result.decision={state:'inconclusive',reason:'setup-failed',issues:[{phase:'setup',reason:'setup-failed',detail:'No installed runner'}]};publishRegressionReport(f.root,result,{keyDir:keys});
 const options={cwd:f.root,reportPath:join(f.root,'.quorate/regressions/latest.json'),manifestPath:manifest,baseSha:f.base,headSha:f.head,keyDir:keys,required:true};
 expect(prepareRegressionAttachment(options).gate).toBe('block');const optional=prepareRegressionAttachment({...options,required:false});expect(optional.gate).toBe('allow');expect(optional.proof?.content).toContain('inconclusive');
 }finally{rmSync(f.root,{recursive:true,force:true});rmSync(keys,{recursive:true,force:true});}
});
