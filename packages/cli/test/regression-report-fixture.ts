import type { RegressionRunResult, RegressionObservation } from '@quorate/core';
import { normalizeRegressionManifest, resolveRegressionInput } from '../src/regression/manifest.js';
export function resultFor(root:string,manifest:unknown):RegressionRunResult {
 const input=resolveRegressionInput(root,normalizeRegressionManifest(manifest));
 const obs=(failed:boolean):RegressionObservation=>({execution:'complete',assertionStatus:failed?'failed':'passed',expectedFailureMatched:failed,exitCode:failed?1:0,issues:[]});
 return {input,decision:{state:'verified',reason:'reproduced-and-fixed',issues:[]},executions:(['base','head'] as const).map(target=>({phase:target,target,argv:['vitest'],result:{exitCode:target==='base'?1:0,timedOut:false,aborted:false,stdout:{text:'',truncated:false},stderr:{text:'',truncated:false},cleanupFailed:false,durationMs:1},fingerprint:'a'.repeat(64),runnerVersion:'4.1.11',observation:obs(target==='base')})),startedAt:'2026-10-02T10:00:00.000Z',finishedAt:'2026-10-02T10:00:01.000Z',durationMs:1000};
}
