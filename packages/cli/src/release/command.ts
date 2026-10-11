import { Command } from 'commander';
import { resolve } from 'node:path';
import { verifyRelease,releaseExitCode } from './runner.js';
import { readReleaseReport } from './report.js';
export function registerReleaseCommands(program:Command):void {
 const release=program.command('release').description('Verify exact distributed artifacts and recover verification; never publish.');
 const cwd=()=>resolve(program.optsWithGlobals().cwd??process.env.INIT_CWD??process.cwd());
 const failure=()=>{console.error('Release evidence could not be safely read or verified. Check the explicit manifest/report.');process.exitCode=2;};
 release.command('verify').description('Read trusted exact identities and verify destinations within a persisted deadline.')
 .requiredOption('--manifest <path>','Trusted explicit release manifest').option('--json','Print versioned JSON report')
 .action(async(options)=>{const controller=new AbortController(),interrupt=()=>controller.abort();process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);try{const report=await verifyRelease({cwd:cwd(),manifestPath:resolve(cwd(),options.manifest),signal:controller.signal});console.log(options.json?JSON.stringify(report):`${report.decision.state}: ${report.decision.reason}\nSaved .quorate/releases/latest.json; local producer remains unattested.`);process.exitCode=releaseExitCode(report.decision.state);}catch{failure();}finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}});
 release.command('status').description('Validate and inspect a prior report without contacting providers or executing commands.')
 .requiredOption('--report <path>','Explicit saved report').option('--json','Print versioned JSON report')
 .action(options=>{try{const report=readReleaseReport(resolve(cwd(),options.report));console.log(options.json?JSON.stringify(report):`${report.decision.state}: ${report.decision.reason}\nDeadline: ${report.deadlineAt}; local producer remains unattested.`);process.exitCode=releaseExitCode(report.decision.state);}catch{failure();}});
}
