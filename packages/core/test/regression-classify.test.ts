import { expect, it } from "vitest";
import { classifyRegressionPair } from "../src/regression/classify.js";
import type { RegressionObservation, RegressionReason } from "../src/regression/types.js";
const obs=(assertionStatus:RegressionObservation['assertionStatus'],expectedFailureMatched=false,exitCode=assertionStatus==='passed'?0:1):RegressionObservation=>({execution:'complete',assertionStatus,expectedFailureMatched,exitCode,issues:[]});
it.each([
 ['failed',true,'passed',0,'verified','reproduced-and-fixed'],
 ['passed',false,'passed',0,'contradicted','not-reproduced'],
 ['passed',false,'failed',1,'contradicted','not-reproduced'],
 ['failed',true,'failed',1,'contradicted','not-fixed'],
 ['failed',false,'passed',0,'inconclusive','unexpected-failure'],
 ['missing',false,'passed',0,'inconclusive','missing-assertion'],
 ['duplicate',false,'passed',0,'inconclusive','duplicate-assertion'],
 ['skipped',false,'passed',0,'inconclusive','skipped-assertion'],
 ['failed',true,'passed',1,'inconclusive','invalid-output'],
] as const)('classifies %s / %s / %s / %s as %s:%s',(baseStatus,matched,headStatus,headCode,state,reason)=>{
 expect(classifyRegressionPair({base:obs(baseStatus,matched),head:obs(headStatus,false,headCode),issues:[]})).toMatchObject({state,reason});
});
it.each(['setup-failed','environment-delta','timeout','cancelled','input-mutated','cleanup-failed','unsupported-runner','unsupported-platform','invalid-output','incomplete-output'] as RegressionReason[])('%s overrides apparent fail/pass',reason=>{
 const r=classifyRegressionPair({base:obs('failed',true),head:obs('passed'),issues:[{phase:'cleanup',reason,detail:'fixture'}]});
 expect(r.state).toBe('inconclusive');expect(r.reason).toBe(reason);
});
it('retains all issues and orders by execution stage',()=>{
 const r=classifyRegressionPair({base:obs('failed',true),head:obs('passed'),issues:[{phase:'cleanup',reason:'cleanup-failed',detail:'cleanup'},{phase:'setup',reason:'setup-failed',detail:'setup'}]});
 expect(r.reason).toBe('setup-failed');expect(r.issues).toHaveLength(2);
});
it('incomplete execution cannot verify',()=>{
 expect(classifyRegressionPair({base:{...obs('failed',true),execution:'incomplete'},head:obs('passed'),issues:[]})).toMatchObject({state:'inconclusive',reason:'incomplete-output'});
});
