import { Command } from 'commander';
import { resolve } from 'node:path';
import { runRegression } from './runner.js';
import { readRegressionManifest, resolveRegressionInput, gitRead } from './manifest.js';
import { defaultRegressionKeyDir, publishRegressionReport, readRegressionReport, verifyRegressionReport } from './report.js';
export const regressionExitCode=(state:'verified'|'contradicted'|'inconclusive')=>state==='verified'?0:state==='contradicted'?1:2;
export function registerRegressionCommands(proof:Command):void {
 const regression=proof.command('regression').description('Reproduce one selected Vitest assertion on BASE and verify its fix on HEAD.');
 const cwd=()=>resolve(proof.optsWithGlobals().cwd??process.env.INIT_CWD??process.cwd());
 const failure=()=>{console.error('Regression proof could not safely complete. Check explicit inputs and local trust configuration.');process.exitCode=2;};
 regression.command('run').description('Execute an explicit manifest in disposable checkouts; installs only its declared setup.')
 .requiredOption('--manifest <path>','Explicit regression manifest').option('--key-dir <path>','Trusted local signing key directory').option('--json','Print the report JSON')
 .action(async(options)=>{
  const controller=new AbortController(),interrupt=()=>controller.abort();process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  try{const result=await runRegression({cwd:cwd(),manifestPath:resolve(cwd(),options.manifest),signal:controller.signal});const report=publishRegressionReport(cwd(),result,{keyDir:options.keyDir});console.log(options.json?JSON.stringify(report):`${report.decision.state}: ${report.decision.reason}\nSaved .quorate/regressions/latest.json (local assertion).`);process.exitCode=regressionExitCode(report.decision.state);}
  catch{failure();}finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}
 });
 regression.command('show').description('Inspect a report without executing or installing anything; inspection does not verify trust.')
 .option('--report <path>','Report path','.quorate/regressions/latest.json').option('--json','Print raw report JSON')
 .action((options)=>{try{const report=readRegressionReport(resolve(cwd(),options.report));console.log(options.json?JSON.stringify(report):`${report.decision.state}: ${report.decision.reason}\nArtifact: ${report.artifactHash}\nUnverified inspection; run regression verify with explicit revisions and trust.`);}catch{failure();}});
 regression.command('verify').description('Check explicit report integrity, trust and revision identities without executing tests.')
 .requiredOption('--report <path>','Explicit report').requiredOption('--manifest <path>','Expected manifest and selected assets').requiredOption('--base <ref>','Expected base revision').requiredOption('--head <ref>','Expected head revision')
 .option('--key-dir <path>','Explicit trusted local key directory').option('--expected-hash <sha256>','Content integrity only; does not attest execution').option('--json','Print verification JSON')
 .action((options)=>{try{
  if(options.keyDir&&options.expectedHash)throw new Error('Choose one trust mode');
  const input=resolveRegressionInput(cwd(),readRegressionManifest(resolve(cwd(),options.manifest)));
  const sha=(ref:string)=>gitRead(cwd(),['rev-parse','--verify','--end-of-options',`${ref}^{commit}`]).toString().trim();
  const result=verifyRegressionReport({cwd:cwd(),path:resolve(cwd(),options.report),baseSha:sha(options.base),headSha:sha(options.head),manifestDigest:input.manifestDigest,bundleDigest:input.bundleDigest,trust:options.expectedHash?{mode:'digest',expectedHash:options.expectedHash}:{mode:'local',keyDir:options.keyDir??defaultRegressionKeyDir()}});
  console.log(options.json?JSON.stringify(result):`${result.reason}; trust: ${result.trustMode}. Integrity verification does not run tests.`);process.exitCode=result.ok?0:result.reason==='missing'||result.reason==='stale'?1:2;
 }catch{failure();}});
}
