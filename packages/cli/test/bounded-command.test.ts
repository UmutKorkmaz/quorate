import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeBoundedCommand } from '../src/bounded-command.js';
const base={cwd:process.cwd(),timeoutMs:5000,maxOutputBytes:64};
it.skipIf(process.platform==='win32')('executes literal argv without a shell',async()=>{
 const r=await executeBoundedCommand({...base,argv:[process.execPath,'-e','process.stdout.write(process.argv[1])','literal;$(echo wrong)']});
 expect(r.exitCode).toBe(0);expect(r.stdout.text).toBe('literal;$(echo wrong)');expect(r.cleanupFailed).toBe(false);
});
it('pre-aborted signal never spawns',async()=>{
 const c=new AbortController();c.abort();const r=await executeBoundedCommand({...base,argv:['missing-executable'],signal:c.signal});expect(r.aborted).toBe(true);expect(r.exitCode).toBeNull();
});
it.skipIf(process.platform==='win32')('bounds multibyte bytes without broken UTF8',async()=>{
 const r=await executeBoundedCommand({...base,maxOutputBytes:7,argv:[process.execPath,'-e',"process.stdout.write('😃😃😃')"]});
 expect(r.stdout.truncated).toBe(true);expect(Buffer.byteLength(r.stdout.text)).toBeLessThanOrEqual(7);expect(r.stdout.text).toBe('😃');
});
it.skipIf(process.platform==='win32')('times out a TERM-resistant command',async()=>{
 const r=await executeBoundedCommand({...base,timeoutMs:150,argv:[process.execPath,'-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"]});expect(r.timedOut).toBe(true);expect(r.exitCode).not.toBe(0);expect(r.cleanupFailed).toBe(false);
},10000);
it.skipIf(process.platform==='win32')('cancels owned descendants and preserves a sentinel',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bounded-command-')),file=join(dir,'pids'),controller=new AbortController();
 const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 const script=`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});process.on('SIGTERM',()=>{});const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(file+'.tmp')},JSON.stringify([process.pid,c.pid]));fs.renameSync(${JSON.stringify(file+'.tmp')},${JSON.stringify(file)});setInterval(()=>{},1000);`;
 let ids:number[]=[];
 try{
  const promise=executeBoundedCommand({...base,argv:[process.execPath,'-e',script],signal:controller.signal});
  const deadline = Date.now() + 3000;
  while (!existsSync(file)) {
    if (Date.now() > deadline) throw new Error('marker');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  ids=JSON.parse(readFileSync(file,'utf8'));controller.abort();const result=await promise;
  expect(result.aborted).toBe(true);expect(result.cleanupFailed).toBe(false);
  for(const pid of ids)expect(()=>process.kill(pid,0)).toThrow();
  expect(()=>process.kill(sentinel.pid!,0)).not.toThrow();controller.abort();
 }finally{sentinel.kill('SIGKILL');for(const pid of ids){try{process.kill(pid,'SIGKILL');}catch{}}rmSync(dir,{recursive:true,force:true});}
},10000);
