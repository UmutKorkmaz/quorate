import { createHash } from 'node:crypto';
import { readBoundedProofFile } from '../portable-proof.js';
import { writeSecureWorkspaceState } from '../secure-state.js';
import type { ReleaseManifest,ReleaseReport,ReleaseState } from './types.js';
export const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function canonicalJson(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJson((value as Record<string,unknown>)[key])).join(',')+'}';return JSON.stringify(value);}
export const hashJson=(value:unknown)=>hash(canonicalJson(value));
export const shaPattern=/^[a-f0-9]{64}$/;
export const revisionPattern=/^[a-f0-9]{40,64}$/;
export const versionPattern=/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
export function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected JSON object');return value as Record<string,unknown>;}
export function readJson(path:string,maxBytes=8*1024*1024):unknown {const data=readBoundedProofFile(path);if(data.length>maxBytes)throw new Error('JSON input exceeds limit');return JSON.parse(data.toString('utf8'));}
export const timestamp=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const idPattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const packagePattern=/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export function validateReleaseManifest(value:unknown):ReleaseManifest {
 const m=record(value);
 if(m.schemaVersion!==1||typeof m.sourceRevision!=='string'||!revisionPattern.test(m.sourceRevision)||!Array.isArray(m.destinations)||m.destinations.length<1||m.destinations.length>16)throw new Error('Invalid release manifest');
 if(m.deadlineMs!==undefined&&(!Number.isInteger(m.deadlineMs)||Number(m.deadlineMs)<1||Number(m.deadlineMs)>600000))throw new Error('Invalid recovery deadline');
 const ids=new Set<string>();
 for(const value of m.destinations){const t=record(value);if(typeof t.id!=='string'||!idPattern.test(t.id)||ids.has(t.id))throw new Error('Invalid or duplicate destination');ids.add(t.id);
  if(t.submission!==undefined&&!['accepted','rejected','unknown'].includes(String(t.submission)))throw new Error('Invalid submission evidence');
  if(t.expectedSourceRevision!==undefined&&(typeof t.expectedSourceRevision!=='string'||!revisionPattern.test(t.expectedSourceRevision)))throw new Error('Invalid expected revision');
  if(t.expectedProvenanceDigest!==undefined&&(typeof t.expectedProvenanceDigest!=='string'||!shaPattern.test(t.expectedProvenanceDigest)))throw new Error('Invalid provenance digest');
  if(t.kind==='npm'){
   if(typeof t.package!=='string'||!packagePattern.test(t.package)||typeof t.version!=='string'||!versionPattern.test(t.version)||typeof t.expectedIntegrity!=='string'||!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(t.expectedIntegrity)||Buffer.from(t.expectedIntegrity.slice(7),'base64').length!==64)throw new Error('npm identity requires exact package/version/integrity');
  }else if(t.kind==='github'){
   if(typeof t.repository!=='string'||!/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/.test(t.repository)||typeof t.tag!=='string'||!/^[-A-Za-z0-9_.+/]{1,200}$/.test(t.tag)||!Number.isSafeInteger(t.assetId)||Number(t.assetId)<1||typeof t.name!=='string'||!/^[-A-Za-z0-9_.]{1,200}$/.test(t.name)||typeof t.expectedSha256!=='string'||!shaPattern.test(t.expectedSha256))throw new Error('GitHub identity requires exact immutable asset and digest');
  }else throw new Error('Unsupported destination');
 }
 return m as unknown as ReleaseManifest;
}
export function validateReleaseReport(value:unknown):ReleaseReport {
 const r=record(value),decision=record(r.decision),producer=record(r.producer);
 if(r.schemaVersion!==1||r.kind!=='release-verification'||typeof r.sourceRevision!=='string'||!revisionPattern.test(r.sourceRevision)||!shaPattern.test(String(r.manifestDigest))||!shaPattern.test(String(r.subjectDigest))||producer.id!=='quorate-local'||producer.trust!=='unattested'||!timestamp(r.createdAt)||!timestamp(r.deadlineAt)||!['verified','failed','inconclusive'].includes(String(decision.state))||typeof decision.reason!=='string'||!Array.isArray(r.destinations)||r.destinations.length<1||r.destinations.length>16||!Array.isArray(r.issues)||r.issues.some(i=>typeof i!=='string'))throw new Error('Invalid release report');
 const states:ReleaseState[]=['planned','submitted','available','verified','failed','unknown'];const ids=new Set<string>();
 for(const item of r.destinations){const d=record(item);if(typeof d.id!=='string'||!idPattern.test(d.id)||ids.has(d.id)||typeof d.identity!=='string'||typeof d.expectedDigest!=='string'||d.expectedDigest.length>200||!states.includes(d.state as ReleaseState)||!Array.isArray(d.observations)||!d.observations.length||d.observations.length>512||!Array.isArray(d.checks))throw new Error('Invalid destination report');ids.add(d.id);
  const checkIds=new Set<string>();for(const item of d.checks){const c=record(item);if(typeof c.id!=='string'||checkIds.has(c.id)||!['passed','failed','inconclusive','missing'].includes(String(c.outcome)))throw new Error('Invalid release check');checkIds.add(c.id);}
  for(const item of d.observations){const o=record(item);if(!timestamp(o.at)||!states.includes(o.state as ReleaseState)||typeof o.code!=='string'||(o.digest!==undefined&&(typeof o.digest!=='string'||o.digest.length>200))||(o.version!==undefined&&(typeof o.version!=='string'||o.version.length>100))||(o.assetId!==undefined&&!Number.isSafeInteger(o.assetId))||(o.name!==undefined&&(typeof o.name!=='string'||o.name.length>200))||(o.sourceRevision!==undefined&&!revisionPattern.test(String(o.sourceRevision)))||(o.provenanceDigest!==undefined&&!shaPattern.test(String(o.provenanceDigest))))throw new Error('Invalid observation');}
  if(record(d.observations.at(-1)).state!==d.state)throw new Error('Destination state differs from last observation');
  if(d.state==='verified'&&(!d.observations.some(o=>{const observed=record(o);return observed.state==='available'&&observed.digest===d.expectedDigest;})||!checkIds.has('identity')||!checkIds.has('digest')||(d.identity.startsWith('npm:')&&!checkIds.has('smoke'))||d.checks.some(c=>record(c).outcome!=='passed')||d.observations.some(o=>record(o).state==='failed')))throw new Error('Verified destination lacks consistent checks');
 }
 const expected=r.destinations.every(d=>record(d).state==='verified')?'verified':r.destinations.some(d=>record(d).state==='failed')?'failed':'inconclusive';
 if(decision.state!==expected)throw new Error('Decision contradicts destination states');
 return r as unknown as ReleaseReport;
}
export function readReleaseReport(path:string):ReleaseReport{return validateReleaseReport(readJson(path));}
export function publishReleaseReport(cwd:string,report:ReleaseReport):void {validateReleaseReport(report);const json=JSON.stringify(report,null,2)+'\n';writeSecureWorkspaceState(cwd,`.quorate/releases/${report.manifestDigest}.json`,json);writeSecureWorkspaceState(cwd,'.quorate/releases/latest.json',json);}
