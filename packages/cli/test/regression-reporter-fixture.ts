import type { BoundedCommandResult } from '@quorate/core';
export function reporter(status='failed',extra:Record<string,unknown>={}) {
 const failed=status==='failed',passed=status==='passed';
 return {numFailedTests:failed?1:0,numFailedTestSuites:failed?1:0,numPassedTests:passed?1:0,numPassedTestSuites:failed?0:1,numPendingTests:!passed&&!failed&&status!=='todo'?1:0,numPendingTestSuites:0,numTodoTests:status==='todo'?1:0,numTotalTests:1,numTotalTestSuites:1,startTime:0,success:!failed,testResults:[{message:'',name:'/fixture/test/value.test.js',status:failed?'failed':'passed',startTime:0,endTime:1,assertionResults:[{ancestorTitles:[],fullName:'fixes value',status,title:'fixes value',meta:{},duration:1,failureMessages:failed?['expected +0 to be 1']:[],location:null,tags:[]}]}],snapshot:{},...extra};
}
export function execution(json:unknown,exitCode=1):BoundedCommandResult{return {exitCode,timedOut:false,aborted:false,stdout:{text:JSON.stringify(json),truncated:false},stderr:{text:'',truncated:false},cleanupFailed:false,durationMs:1};}
