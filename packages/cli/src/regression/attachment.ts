import { decisionInputHash, type CouncilRequest } from '@quorate/core';
import { readRegressionManifest, resolveRegressionInput } from './manifest.js';
import { verifyRegressionReport } from './report.js';
import { redactProofText } from '../proof-runner.js';
export function prepareRegressionAttachment(options:{cwd:string;reportPath:string;baseSha:string;headSha:string;manifestPath:string;keyDir:string;required:boolean;existingProof?:CouncilRequest['proof']}):{proof?:CouncilRequest['proof'];gate:'allow'|'block'|'error';detail:string} {
 try{
  if(!/^[a-f0-9]{40}$/.test(options.baseSha)||!/^[a-f0-9]{40}$/.test(options.headSha))return {gate:'error',detail:'Regression attachment requires unambiguous Git base/head revisions.'};
  const input=resolveRegressionInput(options.cwd,readRegressionManifest(options.manifestPath));
  const verification=verifyRegressionReport({cwd:options.cwd,path:options.reportPath,baseSha:options.baseSha,headSha:options.headSha,manifestDigest:input.manifestDigest,bundleDigest:input.bundleDigest,trust:{mode:'local',keyDir:options.keyDir}});
  if(['tampered','untrusted','unsupported'].includes(verification.reason))return {gate:'error',detail:`Regression evidence rejected: ${verification.reason}.`};
  const current=verification.ok&&input.baseSha===options.baseSha&&input.headSha===options.headSha&&input.issues.length===0;
  const report=verification.report;
  const accepted=current&&report?.decision.state==='verified';
  const evidence={kind:'regression',trust:'local-assertion',current,accepted,verification:verification.reason,artifactHash:report?.artifactHash??null,baseSha:options.baseSha,headSha:options.headSha,manifestDigest:input.manifestDigest,bundleDigest:input.bundleDigest,outcome:report?.decision??null,limitations:'Locally signed assertion; no hosted execution attestation. Only the selected test and supported standalone environment were checked.'};
  const ordinary=options.existingProof?{name:redactProofText(options.existingProof.name).slice(0,200),content:redactProofText(options.existingProof.content),truncated:options.existingProof.truncated}:undefined;
  let content=JSON.stringify({regression:evidence,ordinary}),truncated=ordinary?.truncated??false;
  if(Buffer.byteLength(content)>8192){truncated=true;content=JSON.stringify({regression:{...evidence,outcome:report?{state:report.decision.state,reason:report.decision.reason}:null},ordinary:options.existingProof?{name:ordinary?.name,contentHash:decisionInputHash(options.existingProof.content),omitted:true,truncated:true}:undefined});}
  if(Buffer.byteLength(content)>8192)return {gate:'error',detail:'Regression evidence identity exceeds the review summary budget.'};
  return {proof:{name:'Verification evidence',content,truncated},gate:options.required&&!accepted?'block':'allow',detail:accepted?'Regression proof is current and verified locally.':`Regression evidence is incomplete: ${current?report?.decision.state:verification.reason==='verified'?'input mismatch':verification.reason}.`};
 }catch{return {gate:'error',detail:'Regression attachment has invalid or unsupported explicit inputs.'};}
}
