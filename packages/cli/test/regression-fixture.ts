import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export function git(cwd:string,...args:string[]):string {return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
export function regressionFixture(options:{fixed?:boolean;test?:string;install?:boolean}={}) {
 const root=mkdtempSync(join(tmpdir(),'quorate-regression-fixture-'));
 try {
 git(root,'init','-q');git(root,'config','user.email','regression@example.test');git(root,'config','user.name','Regression Fixture');
 writeFileSync(join(root,'package.json'),JSON.stringify({type:'module',private:true,devDependencies:{vitest:'4.1.11'}}));
 if(options.install)writeFileSync(join(root,'package-lock.json'),readFileSync(new URL('./fixtures/regression-lock.json',import.meta.url)));
 writeFileSync(join(root,'.gitignore'),'node_modules/\n.quorate/regressions/\n');
 mkdirSync(join(root,'test'));
 writeFileSync(join(root,'value.js'),'export const value = 0;\n');
 writeFileSync(join(root,'test/value.test.js'),"import {it,expect} from 'vitest'; import {value} from '../value.js'; it('fixes value',()=>expect(value).toBe(1));\n");
 git(root,'add','.');git(root,'commit','-qm','bug');const base=git(root,'rev-parse','HEAD');
 writeFileSync(join(root,'value.js'),options.fixed===false?'export const value = 0; // unfixed\n':'export const value = 1;\n');
 if(options.test)writeFileSync(join(root,'test/value.test.js'),options.test);
 git(root,'add','.');git(root,'commit','-qm','candidate');const head=git(root,'rev-parse','HEAD');
 return {root,base,head,manifest:{schemaVersion:1,id:'value-fix',base,head,runner:'vitest',testFiles:['test/value.test.js'],assertion:{fullName:'fixes value',expectedFailureText:'expected +0 to be 1'},runArgv:['node_modules/.bin/vitest','run','test/value.test.js','--reporter=json']}};
 }catch(error){rmSync(root,{recursive:true,force:true});throw error;}
}
