import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import type { BoundedCommandResult, RegressionIssue, RegressionObservation } from '@quorate/core';
import { readBoundedJson } from './manifest.js';
interface Assertion { fullName:string;status:string;failureMessages:string[]|null;ancestorTitles:string[] }
interface Suite { name:string;status:string;message:string;assertionResults:Assertion[] }
function suiteTotalsAgree(raw:Record<string,unknown>,files:Suite[]):boolean {
 // Vitest counts file suites and every nested describe. The JSON reporter only
 // exposes nested identities through assertion ancestors; extra unobservable
 // suites must remain inconclusive rather than being assumed successful.
 let total=0,failed=0;
 for(const file of files){
  const nested=new Map<string,boolean>();
  for(const assertion of file.assertionResults){
   if(file.status==='passed'&&assertion.status==='failed')return false;
   for(let depth=1;depth<=assertion.ancestorTitles.length;depth++){
    const identity=JSON.stringify(assertion.ancestorTitles.slice(0,depth));
    nested.set(identity,(nested.get(identity)??false)||assertion.status==='failed');
   }
  }
  total+=1+nested.size;
  failed+=(file.status==='failed'?1:0)+[...nested.values()].filter(Boolean).length;
 }
 return raw.numTotalTestSuites===total&&raw.numFailedTestSuites===failed
  &&raw.numPassedTestSuites===total-failed&&raw.numPendingTestSuites===0;
}
export function inspectVitestVersion(checkoutDir:string):{version:string;supported:boolean}{
 try{
  const path=join(checkoutDir,'node_modules/vitest/package.json');if(!realpathSync(path).startsWith(realpathSync(checkoutDir)+sep))return {version:'unknown',supported:false};
  const pkg=readBoundedJson(path,1048576) as {name?:unknown;version?:unknown};const version=typeof pkg.version==='string'?pkg.version:'unknown';
  return {version,supported:pkg.name==='vitest'&&/^4\.\d+\.\d+$/.test(version)};
 }catch{return {version:'unknown',supported:false};}
}
export function parseVitestObservation(result:BoundedCommandResult,selection:{fullName:string;expectedFailureText:string;testFiles:string[];checkoutDir:string},phase:'base'|'head'):RegressionObservation {
 const observation:RegressionObservation={execution:'complete',assertionStatus:'missing',expectedFailureMatched:false,exitCode:result.exitCode,issues:[]};
 const add=(reason:RegressionIssue['reason'],detail:string)=>{observation.issues.push({phase,reason,detail});observation.execution='incomplete';};
 if(result.aborted)add('cancelled','Execution was cancelled');
 if(result.timedOut)add('timeout','Execution exceeded its time budget');
 if(result.cleanupFailed)add('cleanup-failed','Process group teardown failed');
 if(result.stdout.truncated||result.stderr.truncated)add('incomplete-output','Runner output was truncated');
 if(observation.issues.length)return observation;
 let raw:Record<string,unknown>;
 try{const parsed:unknown=JSON.parse(result.stdout.text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();raw=parsed as Record<string,unknown>;}catch{add('invalid-output','Runner did not produce a complete JSON object');return observation;}
 const counts=['numFailedTests','numFailedTestSuites','numPassedTests','numPassedTestSuites','numPendingTests','numPendingTestSuites','numTodoTests','numTotalTests','numTotalTestSuites'];
 if(counts.some(k=>typeof raw[k]!=='number'||!Number.isInteger(raw[k])||(raw[k] as number)<0)||typeof raw.success!=='boolean'||!Array.isArray(raw.testResults)){add('invalid-output','Runner result structure invalid');return observation;}
 const suites=raw.testResults as Suite[];
 if(suites.some(s=>!s||typeof s.name!=='string'||!['passed','failed'].includes(s.status)||typeof s.message!=='string'||!Array.isArray(s.assertionResults)||s.assertionResults.some(a=>!a||typeof a.fullName!=='string'||!Array.isArray(a.ancestorTitles)||a.ancestorTitles.some(t=>typeof t!=='string')||!['passed','failed','skipped','pending','todo','disabled'].includes(a.status)||(a.failureMessages!==null&&(!Array.isArray(a.failureMessages)||a.failureMessages.some(f=>typeof f!=='string')))))){add('invalid-output','Suite or assertion structure invalid');return observation;}
 const assertions=suites.flatMap(s=>s.assertionResults),count=(status:string)=>assertions.filter(a=>a.status===status).length;
 const failed=count('failed'),passed=count('passed'),todo=count('todo'),pending=assertions.length-failed-passed-todo;
 if(raw.numFailedTests!==failed||raw.numPassedTests!==passed||raw.numTodoTests!==todo||raw.numPendingTests!==pending||raw.numTotalTests!==assertions.length||!suiteTotalsAgree(raw,suites))add('invalid-output','Runner totals disagree with execution results');
 const files=suites.map(s=>isAbsolute(s.name)?relative(resolve(selection.checkoutDir),resolve(s.name)).split(sep).join('/'):s.name);
 if(new Set(files).size!==files.length||files.some(f=>!selection.testFiles.includes(f)))add('invalid-output','Result contains duplicate or unselected test files');
 const matches=assertions.filter(a=>a.fullName===selection.fullName);
 if(matches.length===0)observation.assertionStatus='missing';
 else if(matches.length>1)observation.assertionStatus='duplicate';
 else {
  const selected=matches[0]!;
  observation.assertionStatus=selected.status==='passed'?'passed':selected.status==='failed'?'failed':'skipped';
  observation.expectedFailureMatched=selected.status==='failed'&&(selected.failureMessages??[]).some(message=>message.includes(selection.expectedFailureText));
 }
 if(suites.some(s=>s.status==='failed'&&!s.assertionResults.some(a=>a.status==='failed')))add('unexpected-failure','Suite failed before an assertion');
 if(assertions.some(a=>a.status==='failed'&&a.fullName!==selection.fullName))add('unexpected-failure','Another assertion failed');
 const anyFailure=failed>0||suites.some(s=>s.status==='failed');
 if(raw.success===anyFailure||result.exitCode!==(anyFailure?1:0))add('invalid-output','Runner success and process exit disagree');
 return observation;
}
