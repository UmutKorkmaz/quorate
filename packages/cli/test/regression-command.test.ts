import { afterEach, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerRegressionCommands } from '../src/regression/command.js';
vi.mock('../src/regression/runner.js',()=>({runRegression:vi.fn()}));
vi.mock('../src/regression/report.js',()=>({publishRegressionReport:vi.fn((_:unknown,result:unknown)=>result),defaultRegressionKeyDir:()=>'/trusted/keys'}));
import { runRegression } from '../src/regression/runner.js';
afterEach(()=>{process.exitCode=0;vi.restoreAllMocks();});
it.each([['verified',0],['contradicted',1],['inconclusive',2]] as const)('run maps %s to exit %i',async(state,exit)=>{
 vi.mocked(runRegression).mockResolvedValue({decision:{state,reason:'not-fixed',issues:[]}} as never);
 const log=vi.spyOn(console,'log').mockImplementation(()=>{}),p=new Command();p.option('--cwd <path>');const proof=p.command('proof');registerRegressionCommands(proof);
 await p.parseAsync(['node','quorate','--cwd','/fixture','proof','regression','run','--manifest','manifest.json']);expect(process.exitCode).toBe(exit);expect(log).toHaveBeenCalled();
});
it('existing proof help stays separate and regression execution requires an explicit manifest',async()=>{
 const p=new Command().exitOverride(),proof=p.command('proof');proof.command('run');registerRegressionCommands(proof);expect(proof.commands.map(c=>c.name())).toEqual(['run','regression']);
 vi.spyOn(process.stderr,'write').mockImplementation(()=>true);await expect(p.parseAsync(['node','quorate','proof','regression','run'])).rejects.toThrow('required');
});
