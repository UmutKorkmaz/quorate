import { afterEach, expect, it, vi } from 'vitest';
import { getWorktreeFingerprint } from '../src/proof-runner.js';
afterEach(()=>vi.unstubAllEnvs());
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { readRegressionManifest, resolveRegressionInput } from '../src/regression/manifest.js';
import { regressionFixture, git } from './regression-fixture.js';
function read(value:unknown){const dir=mkdtempSync(join(tmpdir(),'regression-manifest-')),file=join(dir,'manifest.json');writeFileSync(file,JSON.stringify(value));try{return readRegressionManifest(file);}finally{rmSync(dir,{recursive:true,force:true});}}
it('canonicalizes the native temporary root and Git root to the same directory',()=>{
 const f=regressionFixture();try{
  const gitRoot=git(f.root,'rev-parse','--show-toplevel');
  expect(relative(realpathSync.native(f.root),realpathSync.native(gitRoot))).toBe('');
  expect(resolveRegressionInput(f.root,read(f.manifest)).sourceRoot).toBe(realpathSync.native(gitRoot));
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
it('normalizes budgets and resolves exact revisions with committed assets',()=>{
 const f=regressionFixture();try{const m=read(f.manifest);expect(m.timeoutMs).toBe(120000);expect(m.setupTimeoutMs).toBe(600000);expect(m.maxOutputBytes).toBe(65536);const input=resolveRegressionInput(f.root,m);expect(input.baseSha).toBe(f.base);expect(input.headSha).toBe(f.head);expect(input.issues).toEqual([]);expect(input.assets[0]?.bytes).toEqual(readFileSync(join(f.root,'test/value.test.js')));expect(input.bundleDigest).toMatch(/^[a-f0-9]{64}$/);}finally{rmSync(f.root,{recursive:true,force:true});}
});
it('accepts a normalized root spelling but still refuses a nested directory',()=>{
 const f=regressionFixture();try{
  expect(resolveRegressionInput(f.root+'/',read(f.manifest)).sourceRoot).toBeTruthy();
  expect(()=>resolveRegressionInput(join(f.root,'test'),read(f.manifest))).toThrow(/repository root/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
it.each(['file','directory'])('rejects %s case aliases against committed trees before overlay',kind=>{
 const f=regressionFixture();
 try{
  const original=kind==='file'?'test/fixtures/Data.json':'test/fixtures/Group/data.json';
  const selected=kind==='file'?'test/fixtures/data.json':'test/fixtures/group/data.json';
  mkdirSync(join(f.root,kind==='file'?'test/fixtures':'test/fixtures/Group'),{recursive:true});
  writeFileSync(join(f.root,original),'BASE PRODUCTION FIXTURE');git(f.root,'add','.');git(f.root,'commit','-qm','base fixture');const base=git(f.root,'rev-parse','HEAD');
  const from=kind==='file'?original:'test/fixtures/Group',to=kind==='file'?selected:'test/fixtures/group';
  git(f.root,'mv',from,'test/fixtures/temporary');git(f.root,'mv','test/fixtures/temporary',to);
  writeFileSync(join(f.root,selected),'HEAD TEST FIXTURE');git(f.root,'add','.');git(f.root,'commit','-qm','case-only rename');
  const input=resolveRegressionInput(f.root,read({...f.manifest,base,head:git(f.root,'rev-parse','HEAD'),supportFiles:[selected]}));
  expect(input.issues.some(i=>i.reason==='unsupported-config'&&i.detail.includes('case'))).toBe(true);
  expect(git(f.root,'status','--porcelain')).toBe('');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
it.each([{testFiles:[]},{testFiles:['../bad.test.js']},{testFiles:['/bad.test.js']},{testFiles:['a.test.js','A.test.js']},{supportFiles:['value.js']},{runArgv:['sh','-c','vitest run']},{runArgv:['node_modules/.bin/vitest','watch']},{timeoutMs:600001},{maxOutputBytes:1048577},{setupArgv:['npm','ci']},{id:'../bad'}])('rejects invalid input %j before any checkout',delta=>{
 const f=regressionFixture();try{expect(()=>read({...f.manifest,...delta})).toThrow(/invalid/i);}finally{rmSync(f.root,{recursive:true,force:true});}
});
it('refuses a dirty source and flags environment changes',()=>{
 const f=regressionFixture();try{
 writeFileSync(join(f.root,'value.js'),'dirty');expect(()=>resolveRegressionInput(f.root,read(f.manifest))).toThrow(/clean/i);
 git(f.root,'restore','value.js');writeFileSync(join(f.root,'package.json'),JSON.stringify({private:true,devDependencies:{vitest:'4.0.0'}}));git(f.root,'add','.');git(f.root,'commit','-qm','dependencies');
 const input=resolveRegressionInput(f.root,read({...f.manifest,head:git(f.root,'rev-parse','HEAD')}));expect(input.issues.map(i=>i.reason)).toContain('environment-delta');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
it('rejects Windows absolute asset names and symlink or oversized manifest files',()=>{
 const f=regressionFixture(),dir=mkdtempSync(join(tmpdir(),'regression-invalid-'));
 try{
 const file=join(dir,'manifest.json');writeFileSync(file,JSON.stringify(f.manifest));symlinkSync(file,join(dir,'link.json'));expect(()=>readRegressionManifest(join(dir,'link.json'))).toThrow(/Invalid/);
 writeFileSync(file,' '.repeat(1048577));expect(()=>readRegressionManifest(file)).toThrow(/Invalid/);
 expect(()=>read({...f.manifest,testFiles:['C:/value.test.js'],runArgv:['node_modules/.bin/vitest','run','C:/value.test.js','--reporter=json']})).toThrow(/Invalid/);
 }finally{rmSync(f.root,{recursive:true,force:true});rmSync(dir,{recursive:true,force:true});}
});
it('rejects nonancestor revisions and committed symbolic test assets',()=>{
 const f=regressionFixture();try{
 expect(()=>resolveRegressionInput(f.root,read({...f.manifest,base:f.head,head:f.base}))).toThrow(/Git query/);
 rmSync(join(f.root,'test/value.test.js'));symlinkSync('../value.js',join(f.root,'test/value.test.js'));git(f.root,'add','.');git(f.root,'commit','-qm','symlink');expect(()=>resolveRegressionInput(f.root,read({...f.manifest,head:git(f.root,'rev-parse','HEAD')}))).toThrow(/Invalid/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

it('rejects more than 100 selected tests and oversized setup argv before execution',()=>{
 const f=regressionFixture();try{
  const testFiles=Array.from({length:101},(_,i)=>`test/case-${i}.test.js`);
  expect(()=>read({...f.manifest,testFiles,runArgv:['node_modules/.bin/vitest','run',...testFiles,'--reporter=json']})).toThrow(/Invalid/);
  expect(()=>read({...f.manifest,setupArgv:['npm','ci','--ignore-scripts',...Array(102).fill('--no-audit')]})).toThrow(/Invalid/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

it('binds revisions and fingerprints to selected cwd despite inherited Git routing',()=>{
 const selected=regressionFixture(),other=regressionFixture();try{
  writeFileSync(join(other.root,'identity.txt'),'other repository');git(other.root,'add','.');git(other.root,'commit','-qm','other identity');
  const expected=getWorktreeFingerprint(selected.root);
  vi.stubEnv('GIT_DIR',join(other.root,'.git'));vi.stubEnv('GIT_WORK_TREE',selected.root);
  vi.stubEnv('GIT_INDEX_FILE',join(other.root,'.git/index'));
  vi.stubEnv('GIT_OBJECT_DIRECTORY',join(other.root,'.git/objects'));
  const input=resolveRegressionInput(selected.root,read({...selected.manifest,base:'HEAD',head:'HEAD'}));
  expect(input.baseSha).toBe(selected.head);expect(input.headSha).toBe(selected.head);
  expect(getWorktreeFingerprint(selected.root)).toEqual(expected);
 }finally{vi.unstubAllEnvs();rmSync(selected.root,{recursive:true,force:true});rmSync(other.root,{recursive:true,force:true});}
});
