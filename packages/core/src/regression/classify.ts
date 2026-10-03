import type { RegressionDecision, RegressionIssue, RegressionObservation, RegressionPhase } from './types.js';
const stages: RegressionPhase[] = ['preflight','setup','base','head','cleanup'];
export function classifyRegressionPair(input:{base?:RegressionObservation;head?:RegressionObservation;issues:RegressionIssue[]}):RegressionDecision {
  const issues = [...input.issues];
  for (const phase of ['base','head'] as const) {
    const observation = input[phase];
    if (!observation) { issues.push({phase,reason:'invalid-output',detail:'Missing execution observation'}); continue; }
    issues.push(...observation.issues);
    const add=(reason:RegressionIssue['reason'],detail:string)=>issues.push({phase,reason,detail});
    if(observation.execution!=='complete') add('incomplete-output','Execution did not complete');
    const status=observation.assertionStatus;
    if(status==='missing')add('missing-assertion','Selected assertion missing');
    if(status==='duplicate')add('duplicate-assertion','Selected assertion is not unique');
    if(status==='skipped')add('skipped-assertion','Selected assertion did not execute');
    if((status==='passed'&&observation.exitCode!==0)||(status==='failed'&&observation.exitCode!==1)||observation.exitCode===null) add('invalid-output','Assertion and process outcome disagree');
  }
  issues.sort((a,b)=>stages.indexOf(a.phase)-stages.indexOf(b.phase));
  if(issues.length) return {state:'inconclusive',reason:issues[0]!.reason,issues};
  const base=input.base!,head=input.head!;
  if(base.assertionStatus==='passed')return {state:'contradicted',reason:'not-reproduced',issues};
  if(!base.expectedFailureMatched)return {state:'inconclusive',reason:'unexpected-failure',issues:[{phase:'base',reason:'unexpected-failure',detail:'Selected failure does not match the expected symptom'}]};
  return head.assertionStatus==='passed'?{state:'verified',reason:'reproduced-and-fixed',issues}:{state:'contradicted',reason:'not-fixed',issues};
}
