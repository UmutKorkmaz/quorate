import { describe,it,expect,beforeEach,afterEach } from 'vitest';
import { mkdtempSync,writeFileSync,mkdirSync,rmSync,readFileSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';import { tmpdir } from 'node:os';import { createHash } from 'node:crypto';
const api=await import('../../src/evidence/bundle.js').catch(()=>({})) as any;
// Generated once by runProof on POSIX. The local HMAC is retained as opaque
// unattested evidence; portable signer verification wraps these exact bytes.
const frozenProofBytes=readFileSync(new URL('../fixtures/evidence/legacy-proof-v1.json',import.meta.url));
const frozenProof=()=>JSON.parse(frozenProofBytes.toString('utf8')) as import('../../src/proof-runner.js').ProofArtifact;
let root:string;const rev='b'.repeat(40),subject='c'.repeat(64);const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const artifact=()=>({schemaVersion:1,kind:'check-observation',sourceRevision:rev,subjectDigest:subject,producer:{id:'fixture',trust:'trusted-signer'},checks:[{id:'unit',outcome:'passed',requirements:['AC-1']}],verified:true});
const exportIt=()=>api.exportEvidenceBundle?.({root,output:'bundle',inputs:[{id:'selected',path:'check.json'}]});
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'quorate-evidence-'));writeFileSync(join(root,'check.json'),JSON.stringify(artifact()));});afterEach(()=>rmSync(root,{recursive:true,force:true}));
describe('portable bounded evidence storage',()=>{
 it('round trips selected exact bytes, ignores embedded verified and signer claims',()=>{const b=exportIt();expect(b?.records[0].producer.trust).toBe('unattested');const p={schemaVersion:1,sourceRevision:rev,requiredChecks:['unit'],acceptedDigests:[hash(readFileSync(join(root,'check.json'),'utf8'))]};const r=api.inspectEvidenceBundle?.({root,bundle:'bundle',policy:p});expect(r?.state).toBe('verified');});
 it('reports content tampering',()=>{const b=exportIt();if(b)writeFileSync(join(root,'bundle',b.records[0].artifact.path),'{}');const r=api.inspectEvidenceBundle?.({root,bundle:'bundle',policy:{schemaVersion:1,sourceRevision:rev,requiredChecks:['unit'],acceptedDigests:[]}});expect(r?.issues.map((i:any)=>i.code)).toContain('invalid-integrity');});
 it.each(['../check.json','/tmp/check.json','a\\check.json'])('rejects unsafe path %s',(path)=>expect(()=>api.exportEvidenceBundle?.({root,output:'bundle',inputs:[{id:'x',path}]})).toThrow());
 it('rejects every symlink component',()=>{mkdirSync(join(root,'target'));writeFileSync(join(root,'target','file.json'),JSON.stringify(artifact()));symlinkSync(join(root,'target'),join(root,'link'));expect(()=>api.exportEvidenceBundle?.({root,output:'bundle',inputs:[{id:'x',path:'link/file.json'}]})).toThrow();});
 it('refuses replacement of an existing output directory',()=>{mkdirSync(join(root,'bundle'));writeFileSync(join(root,'bundle','owned-by-user'),'keep');expect(()=>exportIt()).toThrow();expect(readFileSync(join(root,'bundle','owned-by-user'),'utf8')).toBe('keep');});
 it('rejects oversized imports before creating output',()=>{writeFileSync(join(root,'check.json'),' '.repeat(4*1024*1024+1));expect(()=>exportIt()).toThrow();});
 it('rejects circular record references',()=>expect(()=>api.exportEvidenceBundle?.({root,output:'bundle',inputs:[{id:'a',path:'check.json',references:['b']},{id:'b',path:'check.json',references:['a']}]})).toThrow());
 it('rejects duplicate identifiers',()=>expect(()=>api.exportEvidenceBundle?.({root,output:'bundle',inputs:[{id:'a',path:'check.json'},{id:'a',path:'check.json'}]})).toThrow());
 it('makes unknown required schemas visible',()=>{writeFileSync(join(root,'check.json'),JSON.stringify({schemaVersion:99,kind:'future'}));exportIt();const r=api.inspectEvidenceBundle?.({root,bundle:'bundle',policy:{schemaVersion:1,sourceRevision:rev,requiredChecks:['selected'],acceptedDigests:[]}});expect(r?.issues.map((i:any)=>i.code)).toContain('unsupported-schema');expect(r?.state).toBe('inconclusive');});
 it('never lets forged manifest outcomes replace adapter results',()=>{const b=exportIt();if(b){b.records[0].checks[0].outcome='failed';writeFileSync(join(root,'bundle','manifest.json'),JSON.stringify(b));}const r=api.inspectEvidenceBundle?.({root,bundle:'bundle',policy:{schemaVersion:1,sourceRevision:rev,requiredChecks:['unit'],acceptedDigests:[]}});expect(r?.issues.map((i:any)=>i.code)).toContain('invalid-integrity');});
});
it('authenticates portable proof only against an operator-pinned signer key',async()=>{
 const {generateKeyPairSync,sign}=await import('node:crypto');
 const proof=frozenProof(),keys=generateKeyPairSync('ed25519'),payload=JSON.stringify(proof);
 const envelope={kind:'quorate-proof-attestation-v1',payload,signature:sign(null,Buffer.from('quorate-proof-attestation-v1\n'+payload),keys.privateKey).toString('base64')};writeFileSync(join(root,'check.json'),JSON.stringify(envelope));exportIt();
 const policy={schemaVersion:1,sourceRevision:proof.fingerprint.gitHead,requiredChecks:['unit'],acceptedDigests:[],requireAuthenticatedProducer:true,trustedProofKeys:[{id:'maintainer',publicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}).toString()}]};
 expect(api.inspectEvidenceBundle?.({root,bundle:'bundle',policy})?.state).toBe('verified');
 const wrong=generateKeyPairSync('ed25519');expect(api.inspectEvidenceBundle?.({root,bundle:'bundle',policy:{...policy,trustedProofKeys:[{id:'attacker',publicKeyPem:wrong.publicKey.export({type:'spki',format:'pem'}).toString()}]}})?.state).toBe('inconclusive');
});
it('round trips a frozen legacy proof without claiming HMAC authentication',()=>{
 writeFileSync(join(root,'check.json'),frozenProofBytes);const bundle=exportIt();
 expect(bundle.records[0].kind).toBe('proof');expect(bundle.records[0].producer.trust).toBe('unattested');
 expect(readFileSync(join(root,'bundle',bundle.records[0].artifact.path)).equals(frozenProofBytes)).toBe(true);
 const policy={schemaVersion:1,sourceRevision:frozenProof().fingerprint.gitHead,requiredChecks:['unit'],acceptedDigests:[hash(frozenProofBytes.toString('utf8'))],requireAuthenticatedProducer:true};
 expect(api.inspectEvidenceBundle?.({root,bundle:'bundle',policy})?.state).toBe('inconclusive');
});
it.skipIf(process.platform === 'win32')('preserves legacy proof bytes and local signature semantics through export/import',async()=>{const {runProof}=await import('../../src/proof-runner.js');const keyDir=join(root,'keys'),previous=process.env.QUORATE_PROOF_KEY_DIR;process.env.QUORATE_PROOF_KEY_DIR=keyDir;try{const result=await runProof({cwd:root,name:'native',command:[process.execPath,'-e','process.stdout.write("ok")']});const original=readFileSync(join(root,'.quorate/proofs/latest.json'));const bundle=api.exportEvidenceBundle?.({root,output:'bundle',inputs:[{id:'native',path:'.quorate/proofs/latest.json'}]});expect(bundle?.records[0].kind).toBe('proof');if(bundle)expect(readFileSync(join(root,'bundle',bundle.records[0].artifact.path)).equals(original)).toBe(true);expect(JSON.parse(original.toString()).signature).toBe(result.artifact.signature);}finally{if(previous===undefined)delete process.env.QUORATE_PROOF_KEY_DIR;else process.env.QUORATE_PROOF_KEY_DIR=previous;}});
it('rejects a forged legacy Markdown digest even if its artifact digest is recomputed',async()=>{
 const {evidenceCanonical}=await import('../../../core/src/evidence/index.js');
 const {validateProofArtifactContent}=await import('../../src/proof-runner.js');const original=frozenProof();expect(validateProofArtifactContent(original)).toBe(true);
 const {signature,artifactHash:_artifactHash,...body}=original;const forged={...body,markdownHash:'f'.repeat(64)};
 writeFileSync(join(root,'check.json'),JSON.stringify({...forged,signature,artifactHash:hash(evidenceCanonical(forged))}));expect(()=>exportIt()).toThrow();
});
