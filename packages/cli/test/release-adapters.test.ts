import { expect,it,vi } from 'vitest';
import { createNativeReleaseAdapters } from '../src/release/adapters.js';
import { createHash } from 'node:crypto';
const result=(stdout='',stderr='',exitCode=0)=>({exitCode,stdout:{text:stdout,truncated:false},stderr:{text:stderr,truncated:false},durationMs:0,timedOut:false,aborted:false,cleanupFailed:false});
const integrity='sha512-'+Buffer.alloc(64,1).toString('base64');
const npm={id:'npm',kind:'npm' as const,package:'quorate',version:'1.5.0',expectedIntegrity:integrity};
it('treats a transport timeout as retryable missing metadata',async()=>{
 const adapters=createNativeReleaseAdapters({now:Date.now,fetch,run:async()=>({...result(),timedOut:true})});expect((await adapters.observe(npm,10000)).status).toBe('missing');
});
it('reads immutable public GitHub asset bytes using fixed host GET argv',async()=>{
 const calls:string[][]=[],urls:string[]=[];const body='owned bytes';const target={id:'asset',kind:'github' as const,repository:'owner/repo',tag:'v1.5.0',assetId:123,name:'cli.tgz',expectedSha256:createHash('sha256').update(body).digest('hex')};
 const adapters=createNativeReleaseAdapters({now:Date.now,run:async(options)=>{calls.push(options.argv);return result(JSON.stringify({tag_name:target.tag,assets:[{id:123,name:'cli.tgz',browser_download_url:'https://github.com/owner/repo/releases/download/v1.5.0/cli.tgz'}]}));},fetch:(async(url)=>{urls.push(String(url));return new Response(body);}) as typeof fetch});
 const observation=await adapters.observe(target,10000);expect(observation.digest).toBe(target.expectedSha256);expect(calls).toEqual([['gh','api','--hostname','github.com','repos/owner/repo/releases/tags/v1.5.0','--method','GET']]);expect(urls).toEqual(['https://api.github.com/repos/owner/repo/releases/assets/123']);
});
it('ignores a metadata-supplied mutable download URL and requests only the immutable API asset',async()=>{
 const urls:string[]=[];const adapters=createNativeReleaseAdapters({now:Date.now,run:async()=>result(JSON.stringify({tag_name:'v1.5.0',assets:[{id:123,name:'cli.tgz',browser_download_url:'https://example.com/credential'}]})),fetch:(async(url,options)=>{urls.push(String(url));expect(options?.headers).toEqual({Accept:'application/octet-stream'});return new Response('owned bytes');}) as typeof fetch});
 expect((await adapters.observe({id:'a',kind:'github',repository:'owner/repo',tag:'v1.5.0',assetId:123,name:'cli.tgz',expectedSha256:'b'.repeat(64)},10000)).status).toBe('available');expect(urls).toEqual(['https://api.github.com/repos/owner/repo/releases/assets/123']);
});
it('cannot associate replacement bytes at a mutable URL with a deleted asset ID',async()=>{
 const target={id:'asset',kind:'github' as const,repository:'owner/repo',tag:'v1.5.0',assetId:123,name:'cli.tgz',expectedSha256:createHash('sha256').update('same bytes').digest('hex')};let reads=0;const urls:string[]=[];
 const adapters=createNativeReleaseAdapters({now:Date.now,run:async()=>{const id=++reads===1?123:456;return result(JSON.stringify({tag_name:'v1.5.0',assets:[{id,name:'cli.tgz',browser_download_url:'https://github.com/owner/repo/releases/download/v1.5.0/cli.tgz'}]}));},fetch:(async(url)=>{urls.push(String(url));return String(url).includes('/releases/assets/123')?new Response('',{status:404}):new Response('same bytes');}) as typeof fetch});
 expect((await adapters.observe(target,10000)).status).toBe('unknown');expect(urls).not.toContain('https://github.com/owner/repo/releases/download/v1.5.0/cli.tgz');
});
it('rejects an asset redirect before sending any request to a non-allowlisted host',async()=>{
 const urls:string[]=[];const adapters=createNativeReleaseAdapters({now:Date.now,run:async()=>result(JSON.stringify({tag_name:'v1.5.0',assets:[{id:123,name:'cli.tgz',browser_download_url:'https://github.com/owner/repo/releases/download/v1.5.0/cli.tgz'}]})),fetch:(async(url,options)=>{urls.push(String(url));if(options?.redirect==='follow'){urls.push('https://example.com/replace');const response=new Response('replacement');Object.defineProperty(response,'url',{value:'https://example.com/replace'});return response;}return new Response(null,{status:302,headers:{location:'https://example.com/replace'}});}) as typeof fetch});
 expect((await adapters.observe({id:'a',kind:'github',repository:'owner/repo',tag:'v1.5.0',assetId:123,name:'cli.tgz',expectedSha256:'b'.repeat(64)},10000)).status).toBe('unknown');expect(urls).toHaveLength(1);
});

it('keeps Windows native install smoke inconclusive without executing installer or creating scratch state',async()=>{
 let calls=0;
 const scratch=await import('../src/release/scratch.js');const owned=vi.spyOn(scratch,'ownedScratch');
 try{vi.stubGlobal('process',{...process,platform:'win32'});
  const adapters=createNativeReleaseAdapters({now:Date.now,fetch,run:async()=>{calls++;return result();}});
  expect(await adapters.smoke(npm,1000)).toEqual({status:'unknown',code:'native-install-unsupported-platform'});expect(calls).toBe(0);expect(owned).not.toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();owned.mockRestore();}
});
