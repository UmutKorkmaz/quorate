import { describe, it, expect } from 'vitest';
const api = await import('../../src/evidence/index.js').catch(() => ({})) as any;
const sha='a'.repeat(64), rev='b'.repeat(40);
const observation=()=>({id:'test',kind:'check-observation',schemaVersion:1,sourceRevision:rev,subjectDigest:sha,producer:{id:'someone',trust:'unattested'},checks:[{id:'unit',outcome:'passed',requirements:['AC-1']}],artifact:{path:`artifacts/${sha}.json`,sha256:sha,bytes:20},references:[],integrity:'valid',accepted:false});
const policy=()=>({schemaVersion:1,sourceRevision:rev,requiredChecks:['unit'],acceptedDigests:[sha],requireAuthenticatedProducer:false});
describe('evidence decisions',()=>{
 it('accepts exact operator-pinned statements while retaining unattested producer identity',()=>{const r=api.inspectEvidence?.([observation()],policy());expect(r?.state).toBe('verified');expect(r?.records[0].producer.trust).toBe('unattested');});
 it('rejects caller claimed verification without operator trust',()=>{const r=api.inspectEvidence?.([{...observation(),accepted:true,verified:true}],{...policy(),acceptedDigests:[]});expect(r?.issues.map((i:any)=>i.code)).toContain('untrusted-producer');expect(r?.state).toBe('inconclusive');});
 it('separates stale revision from missing required checks',()=>{const r=api.inspectEvidence?.([{...observation(),sourceRevision:'c'.repeat(40)}],{...policy(),requiredChecks:['unit','other']});expect(r?.issues.map((i:any)=>i.code)).toEqual(expect.arrayContaining(['wrong-revision','missing-check']));expect(r?.state).toBe('missing');});
 it('contradictory evidence wins over passing duplicate observations',()=>{const r=api.inspectEvidence?.([observation(),{...observation(),id:'second',checks:[{id:'unit',outcome:'failed',requirements:[]}]}],policy());expect(r?.state).toBe('contradicted');});
 it('digest acceptance does not satisfy authenticated producer policy',()=>{const r=api.inspectEvidence?.([observation()],{...policy(),requireAuthenticatedProducer:true});expect(r?.state).toBe('inconclusive');});
 it('unsupported required evidence is visible',()=>{const r=api.inspectEvidence?.([{...observation(),integrity:'unsupported',checks:[{id:'unit',outcome:'inconclusive',requirements:[]}]}],policy());expect(r?.state).toBe('inconclusive');expect(r?.issues.map((i:any)=>i.code)).toContain('unsupported-schema');});
});
it('returns unknown exit status for missing evidence while contradictions remain hard failures',()=>{expect(api.evidenceExitCode?.('verified')).toBe(0);expect(api.evidenceExitCode?.('contradicted')).toBe(1);expect(api.evidenceExitCode?.('missing')).toBe(2);expect(api.evidenceExitCode?.('inconclusive')).toBe(2);});
