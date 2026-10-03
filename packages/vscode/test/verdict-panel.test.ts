import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
vi.mock("vscode", () => ({}));
import * as panel from "../src/verdict-panel";
import type { CouncilReport } from "../src/cli";
const report: CouncilReport = { verdict:"fail",summary:"fix needed",findings:[{severity:"high",title:"Finding",body:"Details",suggestion:"Fix",file:'src/"<&.ts',line:7}],providerResults:[],metadata:{degraded:false} };
// During RED the existing builder is private; first exercise the actual panel surface.
function html() { return (panel as unknown as {buildVerdictHtml:(r:CouncilReport,n:string)=>string}).buildVerdictHtml(report,"fixture"); }
describe("verdict controls",()=>{
  it("renders declarative controls and escaped file data under a nonce policy",()=>{
    const rendered=html();
    expect(rendered).not.toMatch(/\son[a-z]+\s*=/i);
    expect(rendered).toContain("script-src 'nonce-fixture'");
    expect(rendered).toContain('data-action="toggle-detail"');
    expect(rendered).toContain('data-action="rerun"');
    expect(rendered).toContain('data-action="fix"');
    expect(rendered).toContain('src/&quot;&lt;&amp;.ts');
    expect(rendered).not.toContain("unsafe-inline");
  });
  it("toggles detail without navigating and dispatches footer and open actions",()=>{
    const script=html().match(/<script nonce="fixture">([\s\S]*?)<\/script>/)![1];
    const messages:unknown[]=[]; let listener:(event:unknown)=>void=()=>{}; let hidden=true;
    const detail={hasAttribute:()=>hidden,removeAttribute:()=>{hidden=false;},setAttribute:()=>{hidden=true;}};
    runInNewContext(script,{acquireVsCodeApi:()=>({postMessage:(msg:unknown)=>messages.push(msg)}),document:{getElementById:()=>detail,addEventListener:(_type:string,fn:typeof listener)=>{listener=fn;}}});
    const attrs:Record<string,string>={};
    const toggle={dataset:{action:"toggle-detail"},getAttribute:()=>"d-0",setAttribute:(key:string,value:string)=>{attrs[key]=value;}};
    const send=(el:unknown)=>listener({target:{closest:()=>el},stopPropagation:()=>{}});
    send(toggle); expect(hidden).toBe(false); expect(attrs['aria-expanded']).toBe('true'); expect(messages).toEqual([]);
    send({dataset:{action:"open",file:"src/a.ts",line:"7"}});
    send({dataset:{action:"rerun"}}); send({dataset:{action:"fix"}});
    expect(messages).toEqual([{type:"open",file:"src/a.ts",line:7},{type:"rerun"},{type:"fix"}]);
  });
});
