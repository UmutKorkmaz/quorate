import { randomUUID } from 'node:crypto';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,lstatSync,rmSync,realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export function ownedScratch(prefix:string){
 const root=realpathSync(mkdtempSync(join(tmpdir(),prefix))),token=randomUUID(),marker=join(root,'.quorate-owner');writeFileSync(marker,token,{mode:0o600,flag:'wx'});const identity=lstatSync(root);
 const home=join(root,'home'),cwd=join(root,'repo'),temp=join(root,'tmp');for(const p of [home,cwd,temp])mkdirSync(p,{mode:0o700});
 const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:home,USERPROFILE:home,TMPDIR:temp,TMP:temp,TEMP:temp,XDG_CONFIG_HOME:join(home,'.config'),XDG_CACHE_HOME:join(home,'.cache'),npm_config_cache:join(home,'npm-cache'),npm_config_userconfig:join(home,'.npmrc'),NPM_CONFIG_USERCONFIG:join(home,'.npmrc'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(home,'.gitconfig'),GIT_CONFIG_COUNT:'0',GIT_TERMINAL_PROMPT:'0'};
 return {root,home,cwd,env,cleanup:()=>{const current=lstatSync(root);if(current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino||lstatSync(marker).isSymbolicLink()||readFileSync(marker,'utf8')!==token)throw new Error('Scratch ownership changed; cleanup refused');rmSync(root,{recursive:true,force:true});}};
}
