import { it,expect } from 'vitest';import { Command } from 'commander';
const api=await import('../../src/evidence/command.js').catch(()=>({})) as any;
it('registers explicit export and inspect inputs without changing default CLI',()=>{const p=new Command().option('--cwd <path>');api.registerEvidenceCommands?.(p);const e=p.commands.find(c=>c.name()==='evidence');expect(e?.commands.map(c=>c.name())).toEqual(['export','inspect']);expect(e?.commands.find(c=>c.name()==='inspect')?.options.map(o=>o.long)).toEqual(expect.arrayContaining(['--bundle','--policy','--json']));});
