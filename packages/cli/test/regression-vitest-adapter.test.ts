import { expect, it } from 'vitest';
import type { BoundedCommandResult } from '@quorate/core';
import { parseVitestObservation } from '../src/regression/vitest-adapter.js';
import { reporter, execution } from './regression-reporter-fixture.js';
import { classifyRegressionPair } from '@quorate/core';
const selection={fullName:'fixes value',expectedFailureText:'expected +0 to be 1',testFiles:['test/value.test.js'],checkoutDir:'/fixture'};
it('extracts exact expected assertion failure and head pass',()=>{
 expect(parseVitestObservation(execution(reporter()),selection,'base')).toMatchObject({execution:'complete',assertionStatus:'failed',expectedFailureMatched:true,issues:[]});
 expect(parseVitestObservation(execution(reporter('passed'),0),selection,'head')).toMatchObject({execution:'complete',assertionStatus:'passed',issues:[]});
});
it.each(['skipped','pending','todo','disabled'])('%s never executes the selected assertion',status=>{
 const r=parseVitestObservation(execution(reporter(status),0),selection,'base');expect(r.assertionStatus).toBe('skipped');
});
it('rejects count disagreements, malformed JSON and truncation',()=>{
 expect(parseVitestObservation(execution(reporter('failed',{numTotalTests:2})),selection,'base').execution).toBe('incomplete');
 expect(parseVitestObservation({...execution(null),stdout:{text:'bad',truncated:false}},selection,'base').issues[0]?.reason).toBe('invalid-output');
 expect(parseVitestObservation({...execution(reporter()),stdout:{text:'{}',truncated:true}},selection,'base').issues[0]?.reason).toBe('incomplete-output');
});
it('does not match expected text from a crash stderr or different assertion',()=>{
 const r=parseVitestObservation({...execution(reporter('passed'),1),stderr:{text:'expected +0 to be 1',truncated:false}},selection,'base');expect(r.expectedFailureMatched).toBe(false);expect(r.issues.length).toBeGreaterThan(0);
 const raw=reporter();raw.testResults[0]!.assertionResults[0]!.fullName='other';expect(parseVitestObservation(execution(raw),selection,'base').assertionStatus).toBe('missing');
});
it('duplicate identity and suite import errors cannot establish a regression',()=>{
 const raw=reporter();raw.testResults[0]!.assertionResults.push({...raw.testResults[0]!.assertionResults[0]!});raw.numTotalTests=2;raw.numFailedTests=2;
 expect(parseVitestObservation(execution(raw),selection,'base').assertionStatus).toBe('duplicate');
 const imported=reporter();imported.testResults[0]!.assertionResults=[];imported.testResults[0]!.message='Import error';imported.numTotalTests=0;imported.numFailedTests=0;
 expect(parseVitestObservation(execution(imported),selection,'base').issues.length).toBeGreaterThan(0);
});
it('swapped suite counters cannot establish verified proof',()=>{
 const base=parseVitestObservation(execution(reporter('failed',{numFailedTestSuites:0,numPassedTestSuites:1})),selection,'base');
 const head=parseVitestObservation(execution(reporter('passed',{numFailedTestSuites:1,numPassedTestSuites:0}),0),selection,'head');
 expect(base.issues.some(i=>i.reason==='invalid-output')).toBe(true);
 expect(head.issues.some(i=>i.reason==='invalid-output')).toBe(true);
 expect(classifyRegressionPair({base,head,issues:[]}).state).toBe('inconclusive');
});
it.each([
 {numTotalTestSuites:2,numFailedTestSuites:1,numPassedTestSuites:1},
 {numTotalTestSuites:2,numPendingTestSuites:1,numPassedTestSuites:1},
])('rejects phantom suite outcomes %j',counters=>{
 const result=parseVitestObservation(execution(reporter('passed',counters),0),selection,'head');
 expect(result.issues.some(i=>i.reason==='invalid-output')).toBe(true);
});
it('reconciles nested suite counts with ancestor identities and assertion failures',()=>{
 const raw=reporter('failed',{numTotalTestSuites:3,numFailedTestSuites:3});
 raw.testResults[0]!.assertionResults[0]!.ancestorTitles=['values','nested'];
 expect(parseVitestObservation(execution(raw),selection,'base').issues).toEqual([]);
 raw.numFailedTestSuites=2;raw.numPassedTestSuites=1;
 expect(parseVitestObservation(execution(raw),selection,'base').execution).toBe('incomplete');
});
