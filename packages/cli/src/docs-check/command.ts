import { Command } from 'commander';
import { resolve } from 'node:path';
import { checkDocs,docsExitCode,UnsupportedDocsPlatformError } from './runner.js';
import type { CommandMetadata } from './types.js';
export function commandMetadata(program:Command):CommandMetadata[]{
 const rows:CommandMetadata[]=[];
 const visit=(command:Command,path:string[],inherited:string[])=>{
  const names=command===program?path:[...path,command.name()];
  const flags=command.options.flatMap(o=>[o.short,o.long].filter((v):v is string=>typeof v==='string'));
  const accepted=[...new Set([...flags,...inherited])];rows.push({command:names.join(' '),flags:accepted});for(const child of command.commands)visit(child,names,accepted);
 };visit(program,[],[]);return rows;
}
export function registerDocsCommands(program:Command):void {
 const docs=program.command('docs').description('Check explicitly trusted argv examples in a disposable repository and home.');
 docs.command('check').description('Execute only declared examples; documentation freshness is reported separately.')
 .requiredOption('--manifest <path>','Trusted explicit example manifest').option('--json','Print versioned JSON report')
 .action(async(options)=>{const controller=new AbortController(),interrupt=()=>controller.abort();process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);const cwd=resolve(program.optsWithGlobals().cwd??process.env.INIT_CWD??process.cwd());try{const report=await checkDocs({cwd,manifestPath:resolve(cwd,options.manifest),metadata:commandMetadata(program),signal:controller.signal});console.log(options.json?JSON.stringify(report):`${report.decision.state}: ${report.decision.reason}\nFunctional: ${report.functionalState}; freshness: ${report.freshness.state}; artifact: ${report.artifactMode}\nSaved .quorate/docs/latest.json; local producer remains unattested.`);process.exitCode=docsExitCode(report.decision.state);}catch(error){console.error(error instanceof UnsupportedDocsPlatformError?error.message:'Docs examples could not safely complete. Check the explicit manifest and selected artifact.');process.exitCode=2;}finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}});
}
