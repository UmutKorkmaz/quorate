import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { createDefaultConfig } from "@quorate/core";
import { createLiveSpoolSink, listLiveRuns } from "../src/live-spool.js";
import { createJsonStreamSink, isCouncilReportLine, runCouncilWithJsonStream } from "../src/json-stream.js";
import { createMonitorServer, listenMonitorServer } from "../src/monitor-server.js";
const wait=async (check:()=>boolean)=>{const end=Date.now()+6000;while(!check()){if(Date.now()>end)throw new Error("fixture deadline");await new Promise(r=>setTimeout(r,25));}};
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
it("aborted JSON review emits no authoritative final report or transform",async()=>{
  const c=new AbortController(),sink=createJsonStreamSink(),config=createDefaultConfig([]);config.councils=["maintainer"];
  const result=runCouncilWithJsonStream({mode:"review",subject:"abort",diff:"+test"},config,sink,()=>{throw new Error("transform must not run");},{signal:c.signal});
  c.abort(); await expect(result).rejects.toThrow(/abort|interrupt/i);
  expect(sink.stdout.some(isCouncilReportLine)).toBe(false);
});
it("interrupted seal overrides a provisional done verdict",()=>{
 const dir=mkdtempSync(join(tmpdir(),"quorate-seal-")),spool=createLiveSpoolSink({dir});
 try{
 spool.handleEvent({type:"council/started",councilRunId:"race",mode:"review",subject:"race",planned:[],at:new Date().toISOString()});
 spool.handleEvent({type:"verdict",councilRunId:"race",report:{verdict:"pass",summary:"ok",findings:[],providerResults:[],metadata:{degraded:false}} as never});
 spool.finish("error",{interrupted:true});expect(listLiveRuns({dir})[0]?.status).toBe("error");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it.skipIf(process.platform==="win32").each([["SIGINT",130],["SIGTERM",143]] as const)("%s tears down reviewer descendants and preserves an unrelated process",async(signal,exit)=>{
 const root=mkdtempSync(join(tmpdir(),"quorate-cancel-")),marker=join(root,"pids.json");
 const script=join(root,"slow.cjs"),config=join(root,"config.yml");
 writeFileSync(script,`const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
 writeFileSync(config,JSON.stringify({version:1,councils:["maintainer"],providers:[{id:"fixture",type:"cli",enabled:true,command:process.execPath,args:[script],inputMode:"none",roles:["maintainer"],timeoutMs:60000,killGraceMs:100}]}));
 writeFileSync(join(root,"diff.patch"),"diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+const ok = true;\n");
 const sentinel=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
 const cli=spawn(process.execPath,[resolve("packages/cli/dist/index.js"),"--cwd",root,"--config",config,"review","--diff",join(root,"diff.patch"),"--json"],{env:{...process.env,HOME:root,QUORATE_LIVE:"1"},stdio:["ignore","pipe","pipe"]});
 let stdout="",stderr="";cli.stdout.on("data",d=>stdout+=d);cli.stderr.on("data",d=>stderr+=d);
 const exited=new Promise<number|null>(r=>cli.once("exit",code=>r(code)));
 const dir=join(root,".quorate/live"),server=createMonitorServer({dir,token:"owned-cancellation",scan:()=>[]});
 let ids:number[]=[];
 try{
 await wait(()=>existsSync(marker)).catch(error=>{throw new Error(`${error.message}: ${stderr}`);});ids=JSON.parse(readFileSync(marker,"utf8"));
 const runs=listLiveRuns({dir});expect(runs).toHaveLength(1);
 const base=(await listenMonitorServer(server)).split('/?')[0];
 if(signal==='SIGINT'){
 const response=await fetch(`${base}/control?token=owned-cancellation`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"abort",runId:runs[0]!.runId})});expect(response.status).toBe(200);
 }else{cli.kill('SIGTERM');cli.kill('SIGTERM');}
 expect(await exited,stderr).toBe(exit);
 await wait(()=>ids.every(pid=>!alive(pid)));
 expect(alive(sentinel.pid!)).toBe(true);
 expect(listLiveRuns({dir})[0]?.status).toBe("error");
 expect(existsSync(join(root,".quorate/decision.json"))).toBe(false);
 expect(stdout.split("\n").some(isCouncilReportLine)).toBe(false);
 }finally{
 await server.close().catch(()=>{});cli.kill("SIGKILL");sentinel.kill("SIGKILL");for(const pid of ids){try{process.kill(pid,"SIGKILL");}catch{}}
 rmSync(root,{recursive:true,force:true});
 }
},20000);
