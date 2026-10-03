import { expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { regressionFixture, git } from './regression-fixture.js';
import { normalizeRegressionManifest, resolveRegressionInput } from '../src/regression/manifest.js';
import { createRegressionCheckouts } from '../src/regression/checkouts.js';
it.skipIf(process.platform==='win32')('overlays identical HEAD tests without changing BASE production or the source checkout',async()=>{
 const f=regressionFixture();try{
 const before=git(f.root,'worktree','list','--porcelain');const input=resolveRegressionInput(f.root,normalizeRegressionManifest(f.manifest));
 const c=await createRegressionCheckouts(input);
 expect(git(c.baseDir,'rev-parse','HEAD')).toBe(f.base);expect(git(c.headDir,'rev-parse','HEAD')).toBe(f.head);
 expect(readFileSync(join(c.baseDir,'value.js'),'utf8')).toBe('export const value = 0;\n');
 expect(readFileSync(join(c.baseDir,'test/value.test.js'))).toEqual(readFileSync(join(c.headDir,'test/value.test.js')));
 const original=await c.captureProductionDigests();writeFileSync(join(c.baseDir,'value.js'),'changed');expect((await c.captureProductionDigests()).base).not.toBe(original.base);
 expect(await c.cleanup()).toEqual([]);expect(git(f.root,'worktree','list','--porcelain')).toBe(before);expect(git(f.root,'status','--porcelain')).toBe('');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
it('refuses a case-only support overlay before creating worktrees or changing BASE bytes',async()=>{
 const f=regressionFixture();let checkout:Awaited<ReturnType<typeof createRegressionCheckouts>>|undefined;
 try{
  mkdirSync(join(f.root,'test/fixtures'),{recursive:true});writeFileSync(join(f.root,'test/fixtures/Data.json'),'BASE PRODUCTION FIXTURE');
  git(f.root,'add','.');git(f.root,'commit','-qm','base fixture');const base=git(f.root,'rev-parse','HEAD');
  git(f.root,'mv','test/fixtures/Data.json','test/fixtures/temporary');git(f.root,'mv','test/fixtures/temporary','test/fixtures/data.json');
  writeFileSync(join(f.root,'test/fixtures/data.json'),'HEAD TEST FIXTURE');git(f.root,'add','.');git(f.root,'commit','-qm','case alias');
  const before=git(f.root,'worktree','list','--porcelain');
  const input=resolveRegressionInput(f.root,normalizeRegressionManifest({...f.manifest,base,head:git(f.root,'rev-parse','HEAD'),supportFiles:['test/fixtures/data.json']}));
  let refused=false;try{checkout=await createRegressionCheckouts(input);}catch{refused=true;}
  expect(refused).toBe(true);expect(git(f.root,'worktree','list','--porcelain')).toBe(before);
  expect(git(f.root,'show',base+':test/fixtures/Data.json')).toBe('BASE PRODUCTION FIXTURE');
 }finally{if(checkout)await checkout.cleanup();rmSync(f.root,{recursive:true,force:true});}
});
it.skipIf(process.platform==='win32')('refuses cleanup when ownership marker has been swapped',async()=>{
 const f=regressionFixture();let c:Awaited<ReturnType<typeof createRegressionCheckouts>>|undefined;
 try{c=await createRegressionCheckouts(resolveRegressionInput(f.root,normalizeRegressionManifest(f.manifest)));const path=join(c.tempRoot,'owner.json'),raw=readFileSync(path);writeFileSync(path,'{}');expect((await c.cleanup())[0]?.reason).toBe('cleanup-failed');expect(readFileSync(join(c.baseDir,'value.js'),'utf8')).toContain('value');writeFileSync(path,raw);expect(await c.cleanup()).toEqual([]);}
 finally{if(c)await c.cleanup();rmSync(f.root,{recursive:true,force:true});}
});
it.skipIf(process.platform==='win32')('refuses swapped identical ownership marker and symbolic git metadata, preserving unrelated worktrees',async()=>{
 const f=regressionFixture();let c:Awaited<ReturnType<typeof createRegressionCheckouts>>|undefined;
 const unrelated=mkdtempSync(join(tmpdir(),'regression-unrelated-'));rmSync(unrelated,{recursive:true});
 try{
 git(f.root,'worktree','add','--detach',unrelated,f.base);c=await createRegressionCheckouts(resolveRegressionInput(f.root,normalizeRegressionManifest(f.manifest)));
 const marker=join(c.tempRoot,'owner.json'),old=join(c.tempRoot,'owner-old.json');renameSync(marker,old);writeFileSync(marker,readFileSync(old));expect((await c.cleanup())[0]?.reason).toBe('cleanup-failed');rmSync(marker);renameSync(old,marker);
 const gitPath=join(c.baseDir,'.git'),backup=join(c.tempRoot,'git-file');renameSync(gitPath,backup);symlinkSync(backup,gitPath);expect((await c.cleanup())[0]?.reason).toBe('cleanup-failed');rmSync(gitPath);renameSync(backup,gitPath);
 expect(await c.cleanup()).toEqual([]);expect(readFileSync(join(unrelated,'value.js'),'utf8')).toContain('value = 0');expect(git(unrelated,'status','--porcelain')).toBe('');
 }finally{if(c)await c.cleanup();git(f.root,'worktree','remove','--force',unrelated);rmSync(f.root,{recursive:true,force:true});}
});
