import { afterEach, expect, it,vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync,readFileSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerDocsCommands } from '../src/docs-check/command.js';
import { validateDocsManifest } from '../src/docs-check/report.js';
import * as scratchModule from '../src/release/scratch.js';
import { checkDocs } from '../src/docs-check/runner.js';
const roots:string[]=[];
const nativeIt=it.skipIf(process.platform==='win32');
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
function fixture(extra:Record<string,unknown>={}){
 const cwd=mkdtempSync(join(tmpdir(),'quorate-docs-test-'));roots.push(cwd);const manifestPath=join(cwd,'docs.json'),entrypoint=join(cwd,'fixture-cli.js');
 writeFileSync(entrypoint,`const command=process.argv[2];if(command==='blocked'){console.log(JSON.stringify({blocked:true}));process.exitCode=1;}else if(command==='secret'){console.log('api_key=secret-value');}else if(command==='corrected'){console.log('fixed');}`);
 writeFileSync(manifestPath,JSON.stringify({schemaVersion:1,sourceRevision:'a'.repeat(40),artifact:{mode:'source-candidate',entrypoint},files:[{path:'README.md',content:'# Owned demo'}],steps:[{id:'blocked',argv:['{cli}','blocked'],expectedExit:1,expectedJson:{blocked:true}},{id:'corrected',argv:['{cli}','corrected'],expectedExit:0,stdoutIncludes:['fixed']}],...extra}));return {cwd,manifestPath,metadata:[]};
}
nativeIt('runs blocked then corrected explicit argv in disposable repo/home',async()=>{
 const f=fixture();let owned='';const adapter={run:async(options:any)=>{owned=options.cwd;expect(options.env.HOME).not.toBe(process.env.HOME);expect(existsSync(join(options.cwd,'.git'))).toBe(true);return {exitCode:options.argv.includes('corrected')?0:1,stdout:{text:options.argv.includes('corrected')?'fixed':'{"blocked":true}',truncated:false},stderr:{text:'',truncated:false},durationMs:1,timedOut:false,aborted:false,cleanupFailed:false};}};
 const report=await checkDocs(f,adapter);expect(report.decision.state).toBe('verified');expect(report.checks.map((c:any)=>c.outcome)).toEqual(['passed','passed']);expect(existsSync(owned)).toBe(false);
});
nativeIt('detects renamed advertised flag independently of successful commands',async()=>{
 const f=fixture({advertisedOptions:[{command:'proof run',flags:['--old']} ]});const report=await checkDocs({...f,metadata:[{command:'proof run',flags:['--new']}]});
 expect(report.functionalState).toBe('verified');expect(report.freshness.state).toBe('stale');expect(report.decision.state).toBe('failed');
});
nativeIt('does not substitute a source entrypoint for a missing published file',async()=>{
 const f=fixture({artifact:{mode:'published-package',package:'tiny-owned',version:'1.0.0',entrypoint:'dist/index.js'},steps:[{id:'version',argv:['{cli}','--version'],expectedExit:0}]});
 const report=await checkDocs(f);expect(report.artifactMode).toBe('published-package');expect(report.decision.state).toBe('failed');expect(report.checks[0].outcome).toBe('missing');
});
it('rejects fixture traversal before commands execute',async()=>{
 const f=fixture({files:[{path:'../escape',content:'bad'}]});expect(()=>validateDocsManifest(JSON.parse(readFileSync(f.manifestPath,'utf8')))).toThrow(/fixture path/);expect(existsSync(join(f.cwd,'escape'))).toBe(false);
});
nativeIt('classifies truncation or timeout as inconclusive even if required text exists',async()=>{
 const f=fixture();const report=await checkDocs(f,{run:async()=>({exitCode:1,stdout:{text:'{"blocked":true}',truncated:true},stderr:{text:'',truncated:false},durationMs:1,timedOut:false,aborted:false,cleanupFailed:false})});expect(report.decision.state).toBe('inconclusive');
});
nativeIt('redacts output retained in the report',async()=>{
 const f=fixture({steps:[{id:'secret',argv:['{cli}','secret'],expectedExit:0}]});const report=await checkDocs(f);expect(report.checks[0].stdout.text).not.toContain('secret-value');expect(report.checks[0].stdout.text).toContain('[REDACTED]');
});
it('rejects a published-package declaration with only source commands',async()=>{
 const f=fixture({artifact:{mode:'published-package',package:'tiny-owned',version:'1.0.0',entrypoint:'dist/index.js'},steps:[{id:'unrelated',argv:['{node}','-e','console.log("success")'],expectedExit:0}]});expect(()=>validateDocsManifest(JSON.parse(readFileSync(f.manifestPath,'utf8')))).toThrow(/selected artifact/);
});
nativeIt('retains prior checks and marks runner errors inconclusive',async()=>{
 const f=fixture();let calls=0;const report=await checkDocs(f,{run:async()=>{if(++calls===2)throw new Error('secret=not-retained');return {exitCode:1,stdout:{text:'{"blocked":true}',truncated:false},stderr:{text:'',truncated:false},durationMs:1,timedOut:false,aborted:false,cleanupFailed:false};}});expect(report.checks[0].outcome).toBe('passed');expect(report.checks[1].outcome).toBe('inconclusive');expect(report.decision.state).toBe('inconclusive');
});
nativeIt('stops later examples after cancellation and passes the signal to its runner',async()=>{
 const f=fixture(),controller=new AbortController();let calls=0;const report=await checkDocs({...f,signal:controller.signal},{run:async(options:any)=>{expect(options.signal).toBe(controller.signal);calls++;controller.abort();return {exitCode:null,stdout:{text:'',truncated:false},stderr:{text:'',truncated:false},durationMs:1,timedOut:false,aborted:true,cleanupFailed:false};}});expect(calls).toBe(1);expect(report.decision.state).toBe('inconclusive');
});
nativeIt('bounds redacted output expansion and marks it incomplete',async()=>{
 const f=fixture({steps:[{id:'output',argv:['{cli}','output'],expectedExit:0}]});const report=await checkDocs(f,{run:async()=>({exitCode:0,stdout:{text:'api_key=x\n'.repeat(6000),truncated:false},stderr:{text:'',truncated:false},durationMs:1,timedOut:false,aborted:false,cleanupFailed:false})});expect(report.decision.state).toBe('inconclusive');expect(Buffer.byteLength(report.checks[0].stdout.text)).toBeLessThanOrEqual(65536);expect(report.checks[0].stdout.text).not.toContain('api_key=x');
});

it('refuses Windows native docs before scratch creation, example execution or source changes',async()=>{
 const f=fixture(),before=readFileSync(f.manifestPath),files=readdirSync(f.cwd);
 const owned=vi.spyOn(scratchModule,'ownedScratch');let examples=0;
 vi.stubGlobal('process',{...process,platform:'win32',on:process.on.bind(process),off:process.off.bind(process)});
 await expect(checkDocs(f,{run:async()=>{examples++;throw new Error('Must not run');}})).rejects.toThrow(/unsupported on Windows/);
 expect(examples).toBe(0);expect(owned).not.toHaveBeenCalled();expect(readFileSync(f.manifestPath)).toEqual(before);expect(readdirSync(f.cwd)).toEqual(files);
 const errors=vi.spyOn(console,'error').mockImplementation(()=>{}),output=vi.spyOn(console,'log').mockImplementation(()=>{});
 const program=new Command().name('quorate').option('--cwd <path>');registerDocsCommands(program);
 await program.parseAsync(['--cwd',f.cwd,'docs','check','--manifest',f.manifestPath,'--json'],{from:'user'});
 expect(process.exitCode).toBe(2);expect(errors.mock.calls.flat().join(' ')).toMatch(/unsupported on Windows/);expect(output).not.toHaveBeenCalled();expect(owned).not.toHaveBeenCalled();expect(readdirSync(f.cwd)).toEqual(files);
});

it('rejects a source candidate whose missing entrypoint is never invoked',()=>{
 const f=fixture({artifact:{mode:'source-candidate',entrypoint:'missing-cli.js'},steps:[{id:'unrelated',argv:['{node}','-e','console.log("unrelated success")'],expectedExit:0}]});
 expect(()=>validateDocsManifest(JSON.parse(readFileSync(f.manifestPath,'utf8')))).toThrow(/selected artifact/);
});
it.each(['source-candidate','published-package'])('rejects %s when the selected CLI placeholder is only command data',mode=>{
 const artifact=mode==='source-candidate'?{mode,entrypoint:'missing-cli.js'}:{mode,package:'tiny-owned',version:'1.0.0',entrypoint:'dist/index.js'};
 const f=fixture({artifact,steps:[{id:'data',argv:['{node}','-e','console.log(process.argv.slice(1))','{cli}'],expectedExit:0}]});
 expect(()=>validateDocsManifest(JSON.parse(readFileSync(f.manifestPath,'utf8')))).toThrow(/selected artifact/);
});
nativeIt('rejects an unused source artifact before scratch creation or unrelated example execution',async()=>{
 const f=fixture({artifact:{mode:'source-candidate',entrypoint:'missing-cli.js'},steps:[{id:'unrelated',argv:['{node}','-e','console.log("success")'],expectedExit:0}]});
 const owned=vi.spyOn(scratchModule,'ownedScratch');let examples=0;
 await expect(checkDocs(f,{run:async()=>{examples++;return {exitCode:0,stdout:{text:'success',truncated:false},stderr:{text:'',truncated:false},durationMs:1,timedOut:false,aborted:false,cleanupFailed:false};}})).rejects.toThrow(/selected artifact/);
 expect(owned).not.toHaveBeenCalled();expect(examples).toBe(0);expect(existsSync(join(f.cwd,'.quorate/docs/latest.json'))).toBe(false);
});
