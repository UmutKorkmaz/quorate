import { it,expect,afterEach,vi } from 'vitest';
import fs from 'node:fs';import { join } from 'node:path';import { tmpdir } from 'node:os';
import { evidenceCanonical,evidenceDigest,MAX_EVIDENCE_ARTIFACT_BYTES,MAX_EVIDENCE_BUNDLE_BYTES } from '../../../core/src/evidence/index.js';
import { exportEvidenceBundle,inspectEvidenceBundle,readEvidenceBytes } from '../../src/evidence/bundle.js';
const interception=vi.hoisted(()=>({onClose:undefined as undefined|((path:unknown)=>void),onRead:undefined as undefined|((path:unknown,count:number)=>void)}));
vi.mock('node:fs',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs')>();const descriptors=new Map<number,unknown>();return {...actual,openSync:(...args:Parameters<typeof actual.openSync>)=>{const fd=actual.openSync(...args);descriptors.set(fd,args[0]);return fd;},readSync:(...args:Parameters<typeof actual.readSync>)=>{const count=actual.readSync(...args);interception.onRead?.(descriptors.get(args[0]),count);return count;},closeSync:(fd:number)=>{const path=descriptors.get(fd);descriptors.delete(fd);actual.closeSync(fd);interception.onClose?.(path);}};});
const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(root=>fs.rmSync(root,{recursive:true,force:true})));
const fixture=()=>{const root=fs.mkdtempSync(join(tmpdir(),'quorate-evidence-review-'));roots.push(root);return root;};
const revision='a'.repeat(40),digest='b'.repeat(64);
function regression(passed:boolean){const execution=(phase:'base'|'head',ok:boolean)=>({phase,target:phase,argv:['node'],result:{exitCode:ok?0:1,timedOut:false,aborted:false,stdout:{text:'',truncated:false},stderr:{text:'',truncated:false},cleanupFailed:false,durationMs:1},fingerprint:digest,runnerVersion:'4.0.14',observation:{execution:'complete',assertionStatus:ok?'passed':'failed',expectedFailureMatched:true,exitCode:ok?0:1,issues:[]}});const body={schemaVersion:1,kind:'regression',id:'repro',baseSha:'c'.repeat(40),headSha:revision,sourceFingerprint:digest,manifestDigest:digest,bundleDigest:digest,environmentDigest:digest,nodeVersion:'v22.22.0',decision:{state:passed?'verified':'contradicted',reason:passed?'reproduced-and-fixed':'not-fixed',issues:[]},executions:[execution('base',false),execution('head',passed)],startedAt:'2026-10-11T00:00:00.000Z',finishedAt:'2026-10-11T00:00:01.000Z',durationMs:1,trustMode:'local-assertion',producer:'quorate-local'};return {...body,artifactHash:evidenceDigest(evidenceCanonical(body)),signature:digest};}
it('never derives regression outcome from replacement bytes after the pinned descriptor closes',()=>{const root=fixture(),original=JSON.stringify(regression(false)),replacement=JSON.stringify(regression(true)),hash=evidenceDigest(original),path=join(root,'bundle','artifacts',`${hash}.json`);fs.mkdirSync(join(root,'bundle','artifacts'),{recursive:true});fs.writeFileSync(path,original);const record={id:'repro',kind:'regression',schemaVersion:1,sourceRevision:revision,subjectDigest:digest,producer:{id:'quorate-local',trust:'unattested'},checks:[{id:'repro',outcome:'passed',requirements:[]}],artifact:{path:`artifacts/${hash}.json`,sha256:hash,bytes:Buffer.byteLength(original)},references:[]};fs.writeFileSync(join(root,'bundle','manifest.json'),JSON.stringify({schemaVersion:1,kind:'quorate-evidence-bundle',records:[record]}));let replaced=false;interception.onClose=filename=>{if(typeof filename==='string'&&fs.realpathSync(filename)===fs.realpathSync(path)&&!replaced){replaced=true;fs.writeFileSync(path,replacement);}};try{const result=inspectEvidenceBundle({root,bundle:'bundle',policy:{schemaVersion:1,sourceRevision:revision,requiredChecks:['repro'],acceptedDigests:[hash]}});expect(replaced).toBe(true);expect(result.state).not.toBe('verified');expect(result.records[0].integrity).toBe('invalid');}finally{interception.onClose=undefined;}});
it('rejects a serialized manifest beyond the inspection budget before publishing any bundle',()=>{const root=fixture(),requirements=Array.from({length:64},(_,i)=>`AC-${i.toString().padStart(3,'0')}${'x'.repeat(149)}`),checks=Array.from({length:256},(_,i)=>({id:`check-${i}`,outcome:'passed',requirements}));fs.writeFileSync(join(root,'check.json'),JSON.stringify({schemaVersion:1,kind:'check-observation',sourceRevision:revision,subjectDigest:digest,producer:{id:'fixture'},checks}));expect(()=>exportEvidenceBundle({root,output:'bundle',inputs:[{id:'one',path:'check.json'},{id:'two',path:'check.json'}]})).toThrow(/manifest.*limit/i);expect(fs.existsSync(join(root,'bundle'))).toBe(false);});

it('bounds actual artifact reads when many records understate the same large file size',()=>{
 const root=fixture(),content=Buffer.alloc(MAX_EVIDENCE_ARTIFACT_BYTES,32),hash=evidenceDigest(content),artifactPath=`artifacts/${hash}.json`;
 fs.mkdirSync(join(root,'bundle','artifacts'),{recursive:true});fs.writeFileSync(join(root,'bundle',artifactPath),content);
 const records=Array.from({length:256},(_,i)=>({id:`understated-${i}`,kind:'check-observation',schemaVersion:1,sourceRevision:revision,subjectDigest:digest,producer:{id:'fixture',trust:'unattested'},checks:[{id:'unit',outcome:'passed',requirements:[]}],artifact:{path:artifactPath,sha256:hash,bytes:1},references:[]}));
 fs.writeFileSync(join(root,'bundle','manifest.json'),JSON.stringify({schemaVersion:1,kind:'quorate-evidence-bundle',records}));
 let actualArtifactBytes=0,artifactReadCalls=0;
 interception.onRead=(path,count)=>{if(typeof path==='string'&&path.endsWith(`${hash}.json`)){actualArtifactBytes+=count;artifactReadCalls++;}};
 try{const result=inspectEvidenceBundle({root,bundle:'bundle',policy:{schemaVersion:1,sourceRevision:revision,requiredChecks:['unit'],acceptedDigests:[hash]}});
 expect(actualArtifactBytes).toBeLessThanOrEqual(MAX_EVIDENCE_BUNDLE_BYTES);
 expect(artifactReadCalls).toBe(0);
 expect(result.state).toBe('inconclusive');expect(result.records.every(r=>r.integrity==='invalid'&&!r.accepted)).toBe(true);
 }finally{interception.onRead=undefined;}
});

it('enforces the actual export read budget before starting the next artifact read',()=>{
 const root=fixture(),value={schemaVersion:1,kind:'check-observation',sourceRevision:revision,subjectDigest:digest,producer:{id:'fixture'},checks:[{id:'unit',outcome:'passed',requirements:[]}],padding:''};
 const empty=JSON.stringify(value);value.padding='x'.repeat(MAX_EVIDENCE_ARTIFACT_BYTES-Buffer.byteLength(empty));fs.writeFileSync(join(root,'check.json'),JSON.stringify(value));
 let actualArtifactBytes=0;interception.onRead=(path,count)=>{if(typeof path==='string'&&path.endsWith('check.json'))actualArtifactBytes+=count;};
 try{expect(()=>exportEvidenceBundle({root,output:'bundle',inputs:Array.from({length:5},(_,i)=>({id:`selected-${i}`,path:'check.json'}))})).toThrow(/bounded|byte limit/i);
 expect(actualArtifactBytes).toBeLessThanOrEqual(MAX_EVIDENCE_BUNDLE_BYTES);expect(fs.existsSync(join(root,'bundle'))).toBe(false);
 }finally{interception.onRead=undefined;}
});

it('accepts a valid bundle at the exact logical byte budget even with repeated content',()=>{
 const root=fixture(),value={schemaVersion:1,kind:'check-observation',sourceRevision:revision,subjectDigest:digest,producer:{id:'fixture'},checks:[{id:'unit',outcome:'passed',requirements:[]}],padding:''};
 value.padding='x'.repeat(MAX_EVIDENCE_ARTIFACT_BYTES-Buffer.byteLength(JSON.stringify(value)));const content=JSON.stringify(value),hash=evidenceDigest(content);fs.writeFileSync(join(root,'check.json'),content);
 exportEvidenceBundle({root,output:'bundle',inputs:Array.from({length:4},(_,i)=>({id:`selected-${i}`,path:'check.json'}))});
 let actualArtifactBytes=0;interception.onRead=(path,count)=>{if(typeof path==='string'&&path.endsWith(`${hash}.json`))actualArtifactBytes+=count;};
 try{const result=inspectEvidenceBundle({root,bundle:'bundle',policy:{schemaVersion:1,sourceRevision:revision,requiredChecks:['unit'],acceptedDigests:[hash]}});expect(actualArtifactBytes).toBe(MAX_EVIDENCE_BUNDLE_BYTES);expect(result.state).toBe('verified');}
 finally{interception.onRead=undefined;}
});

it('does not read beyond the allowance if a file grows while its descriptor is open',()=>{
 const root=fixture(),path=join(root,'growing.json');fs.writeFileSync(path,Buffer.alloc(MAX_EVIDENCE_ARTIFACT_BYTES,32));let actualBytes=0,grown=false;
 interception.onRead=(filename,count)=>{if(typeof filename==='string'&&filename.endsWith('growing.json')){actualBytes+=count;if(count>0&&!grown){grown=true;fs.appendFileSync(path,'x');}}};
 try{expect(()=>readEvidenceBytes(root,'growing.json',MAX_EVIDENCE_ARTIFACT_BYTES)).toThrow(/size changed/);expect(grown).toBe(true);expect(actualBytes).toBe(MAX_EVIDENCE_ARTIFACT_BYTES);}
 finally{interception.onRead=undefined;}
});
