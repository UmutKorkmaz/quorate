import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashJson,readJson,validateReleaseManifest,readReleaseReport,publishReleaseReport } from './report.js';
import { createNativeReleaseAdapters } from './adapters.js';
import type { ReleaseAdapters,ReleaseDestination,ReleaseReport,ReleaseState,ReleaseTarget,ArtifactObservation } from './types.js';
const terminal=(d:ReleaseDestination)=>d.state==='verified'||d.state==='failed';
const targetDigest=(t:ReleaseTarget)=>t.kind==='npm'?t.expectedIntegrity:t.expectedSha256;
export const targetIdentity=(t:ReleaseTarget)=>t.kind==='npm'?`npm:${t.package}@${t.version}`:`github:${t.repository}:${t.tag}:${t.assetId}:${t.name}`;
export function releaseExitCode(state:ReleaseReport['decision']['state']):number{return state==='verified'?0:state==='failed'?1:2;}
export async function verifyRelease(options:{cwd:string;manifestPath:string;signal?:AbortSignal},suppliedAdapters?:ReleaseAdapters):Promise<ReleaseReport>{
 const adapters=suppliedAdapters??createNativeReleaseAdapters(undefined,options.signal);
 const manifest=validateReleaseManifest(readJson(options.manifestPath,65536)),manifestDigest=hashJson(manifest);
 const path=join(options.cwd,'.quorate/releases',`${manifestDigest}.json`),previous=existsSync(path)?readReleaseReport(path):undefined;
 const now=adapters.now(),report:ReleaseReport=previous??{schemaVersion:1,kind:'release-verification',sourceRevision:manifest.sourceRevision,manifestDigest,subjectDigest:hashJson(manifest.destinations),producer:{id:'quorate-local',trust:'unattested'},createdAt:new Date(now).toISOString(),deadlineAt:new Date(now+(manifest.deadlineMs??600000)).toISOString(),decision:{state:'inconclusive',reason:'Verification pending'},issues:[],destinations:manifest.destinations.map(t=>({id:t.id,identity:targetIdentity(t),expectedDigest:targetDigest(t),state:'planned',observations:[{at:new Date(now).toISOString(),state:'planned',code:'manifest-selected'}],checks:[]}))};
 if(report.manifestDigest!==manifestDigest||report.subjectDigest!==hashJson(manifest.destinations)||report.sourceRevision!==manifest.sourceRevision||report.destinations.some((d,i)=>d.identity!==targetIdentity(manifest.destinations[i])||d.expectedDigest!==targetDigest(manifest.destinations[i])))throw new Error('Recovery report identity mismatch');
 const deadline=Date.parse(report.deadlineAt);if(deadline-Date.parse(report.createdAt)>(manifest.deadlineMs??600000))throw new Error('Recovery deadline was extended');
 const save=()=>{report.decision=report.destinations.every(d=>d.state==='verified')?{state:'verified',reason:'All exact artifacts and required journeys verified'}:report.destinations.some(d=>d.state==='failed')?{state:'failed',reason:'At least one destination failed or required evidence is missing'}:{state:'inconclusive',reason:'Destination evidence remains inconclusive'};publishReleaseReport(options.cwd,report);};
 const transition=(d:ReleaseDestination,state:ReleaseState,code:string,o?:ArtifactObservation)=>{d.state=state;d.observations.push({at:new Date(adapters.now()).toISOString(),state,code,...(o?.digest?{digest:o.digest}:{}),...(o?.version?{version:o.version}:{}),...(o?.assetId?{assetId:o.assetId}:{}),...(o?.name?{name:o.name}:{}),...(o?.sourceRevision?{sourceRevision:o.sourceRevision}:{}),...(o?.provenanceDigest?{provenanceDigest:o.provenanceDigest}:{})});save();};
 const check=(d:ReleaseDestination,id:string,outcome:'passed'|'failed'|'inconclusive'|'missing')=>{const old=d.checks.find(c=>c.id===id);if(old)old.outcome=outcome;else d.checks.push({id,outcome});};
 save();
 for(let i=0;i<manifest.destinations.length;i++){
  const target=manifest.destinations[i],d=report.destinations[i];if(d.state==='verified'||d.state==='failed')continue;
  if(options.signal?.aborted){check(d,'availability','inconclusive');transition(d,'unknown','verification-interrupted');continue;}
  if(target.submission==='rejected'){check(d,'submission','failed');transition(d,'failed','submission-rejected');continue;}
  if(target.submission==='accepted'&&!d.observations.some(o=>o.state==='submitted'))transition(d,'submitted','submission-accepted');
  let attempts=0;
  while(!terminal(d)&&attempts++<64){
   if(options.signal?.aborted){check(d,'availability','inconclusive');transition(d,'unknown','verification-interrupted');break;}
   const remaining=deadline-adapters.now();if(remaining<=0){check(d,'availability','missing');transition(d,'failed','availability-deadline-exhausted');break;}
   let observed:ArtifactObservation;try{observed=await adapters.observe(target,remaining);}catch{observed={status:'unknown',code:'observation-error'};}
   if(options.signal?.aborted){check(d,'availability','inconclusive');transition(d,'unknown','verification-interrupted');break;}
   if(observed.status==='failed'){check(d,'identity','failed');transition(d,'failed',observed.code??'artifact-rejected');break;}
   if(observed.status==='available'){
    if(deadline<=adapters.now()){check(d,'availability','missing');transition(d,'failed','availability-deadline-exhausted');break;}
    const complete=typeof observed.digest==='string'&&(target.kind==='npm'?typeof observed.version==='string':Number.isSafeInteger(observed.assetId)&&typeof observed.name==='string');
    if(!complete){check(d,'identity','inconclusive');transition(d,'unknown','ambiguous-artifact-identity');break;}
    const identityMatches=target.kind==='npm'?observed.version===target.version:observed.assetId===target.assetId&&observed.name===target.name;
    const digest=target.kind==='npm'?target.expectedIntegrity:target.expectedSha256;
    if(!identityMatches||observed.digest!==digest){check(d,!identityMatches?'identity':'digest','failed');transition(d,'failed',!identityMatches?'wrong-identity':'wrong-digest',observed);break;}
    check(d,'identity','passed');check(d,'digest','passed');transition(d,'available','exact-artifact-available',observed);
    let unavailable=false;
    for(const [id,expected,actual] of [['source',target.expectedSourceRevision,observed.sourceRevision],['provenance',target.expectedProvenanceDigest,observed.provenanceDigest]] as const){
     if(expected===undefined)continue;
     if(actual===undefined){check(d,id,'inconclusive');unavailable=true;}
     else if(expected!==actual){check(d,id,'failed');transition(d,'failed',`${id}-mismatch`,observed);break;}
     else check(d,id,'passed');
    }
    if(terminal(d))break;
    if(unavailable){transition(d,'unknown','required-source-or-provenance-unavailable',observed);break;}
    if(target.kind==='npm'){
     let smoke;try{smoke=await adapters.smoke(target,Math.max(1,deadline-adapters.now()));}catch{smoke={status:'unknown' as const};}
     if(options.signal?.aborted){check(d,'smoke','inconclusive');transition(d,'unknown','verification-interrupted');break;}
     if(deadline<=adapters.now()){check(d,'smoke','missing');transition(d,'failed','verification-deadline-exhausted');break;}
     if(smoke.status==='failed'){check(d,'smoke','failed');transition(d,'failed',smoke.code??'install-journey-failed');break;}
     if(smoke.status!=='verified'){check(d,'smoke',smoke.status==='missing'?'missing':'inconclusive');transition(d,'unknown',smoke.code??'install-unavailable');}
     else{check(d,'smoke','passed');d.checks=d.checks.filter(c=>c.id!=='availability');transition(d,'verified','installed-journey-verified');break;}
    }else{d.checks=d.checks.filter(c=>c.id!=='availability');transition(d,'verified','asset-bytes-verified');break;}
   }else{transition(d,'unknown',observed.code??(observed.status==='missing'?'artifact-unavailable':'ambiguous-observation'));if(observed.status==='unknown')break;}
   const remainingAfter=deadline-adapters.now();if(remainingAfter>0)await adapters.sleep(Math.min(10000,remainingAfter));
  }
  if(attempts>64&&!terminal(d)){check(d,'availability','inconclusive');transition(d,'unknown','attempt-limit');}
 }
 save();return report;
}
