import { expect, it } from "vitest";
// @ts-expect-error standalone release helper intentionally has no declaration file
import { verifyPublishedCli } from "../../../scripts/verify-published-cli.mjs";
function fixture(overrides:{metadataDelay?:number;installDelay?:number;version?:string;cleanCode?:number;unsafeCode?:number;json?:string}={}) {
 let clock=0,metadata=0,installs=0;const calls:string[][]=[];
 const deps={now:()=>clock,sleep:async(ms:number)=>{clock+=ms;},run:async(argv:string[])=>{
  calls.push(argv);
  if(argv[1]==="view")return ++metadata<=(overrides.metadataDelay??0)?{code:1,stdout:"",stderr:"E404"}:{code:0,stdout:JSON.stringify({version:"1.4.1",dist:{integrity:"sha512-fixture"}}),stderr:""};
  if(argv[1]==="install")return ++installs<=(overrides.installDelay??0)?{code:1,stdout:"",stderr:"ETIMEDOUT"}:{code:0,stdout:"",stderr:""};
  if(argv.includes("--version"))return {code:0,stdout:overrides.version??"1.4.1",stderr:""};
  if(argv.includes("--help"))return {code:0,stdout:"Quorate",stderr:""};
  const unsafe=argv.some(a=>a.endsWith("unsafe.diff"));
  return {code:unsafe?overrides.unsafeCode??1:overrides.cleanCode??0,stdout:overrides.json??JSON.stringify({findings:unsafe?[{severity:"medium"}]:[]}),stderr:""};
 }};return {deps,calls};
}
it("retries metadata and install availability without any publishing commands",async()=>{
 const f=fixture({metadataDelay:1,installDelay:1});const r=await verifyPublishedCli({version:"1.4.1",deadlineMs:50000},f.deps);
 expect(r.ok).toBe(true);expect(r.attempts).toBe(3);
 expect(f.calls.some(a=>a.includes("publish")||a.includes("tag"))).toBe(false);
 const install=f.calls.find(a=>a[1]==="install")!;expect(install).toContain("--ignore-scripts");expect(install).toContain("quorate@1.4.1");
 expect(f.calls.filter(a=>a[0]==="npm"&&a[1]==="exec")).toEqual([]);
});
it.each([{version:"1.4.0"},{cleanCode:1},{unsafeCode:0},{unsafeCode:127},{json:"invalid"}])("fails terminal behavior mismatch %j",async overrides=>{
 const f=fixture(overrides);expect((await verifyPublishedCli({version:"1.4.1"},f.deps)).ok).toBe(false);
});
it("bounds availability retries by one shared deadline",async()=>{
 const f=fixture({metadataDelay:999});const r=await verifyPublishedCli({version:"1.4.1",deadlineMs:15000},f.deps);
 expect(r.ok).toBe(false);expect(r.attempts).toBeLessThanOrEqual(2);
});
it('allows a cold installation longer than ten seconds within the shared deadline',async()=>{
 const f=fixture(),original=f.deps.run;let supplied=0;
 f.deps.run=async(argv:string[],...rest:unknown[])=>{
  if(argv[1]==='install'){supplied=(rest[0] as {timeoutMs:number}).timeoutMs;return supplied>10000?{code:0,stdout:'',stderr:''}:{code:124,timedOut:true,stdout:'',stderr:''};}
  return original(argv);
 };
 const result=await verifyPublishedCli({version:'1.4.1',deadlineMs:600000},f.deps);
 expect(result.ok).toBe(true);expect(supplied).toBeGreaterThan(10000);expect(supplied).toBeLessThanOrEqual(600000);
});
it('retries an explicit registry transport timeout only while shared budget remains',async()=>{
 const f=fixture(),original=f.deps.run;let calls=0;
 f.deps.run=async(argv:string[])=>argv[1]==='view'&&++calls===1?{code:124,timedOut:true,stdout:'',stderr:''}:original(argv);
 expect((await verifyPublishedCli({version:'1.4.1',deadlineMs:50000},f.deps)).ok).toBe(true);
 expect(calls).toBe(2);
});
it('bounds repeated install timeouts by the single shared deadline',async()=>{
 const f=fixture(),original=f.deps.run;let elapsed=0,installCalls=0;
 f.deps.now=()=>elapsed;f.deps.sleep=async(ms:number)=>{elapsed+=ms;};
 f.deps.run=async(argv:string[],...rest:unknown[])=>{
  if(argv[1]==='install'){installCalls++;elapsed+=(rest[0] as {timeoutMs:number}).timeoutMs;return {code:124,timedOut:true,stdout:'',stderr:''};}
  return original(argv);
 };
 expect((await verifyPublishedCli({version:'1.4.1',deadlineMs:300000},f.deps)).ok).toBe(false);
 expect(installCalls).toBeGreaterThan(1);expect(elapsed).toBeLessThanOrEqual(300000);
});
