import { expect,it } from 'vitest';
import { Command } from 'commander';
import { registerReleaseCommands } from '../src/release/command.js';
import { registerDocsCommands,commandMetadata } from '../src/docs-check/command.js';
it('registers explicit verification-only CLI commands and generated option metadata',()=>{
 const p=new Command().name('quorate').option('--cwd <path>');registerReleaseCommands(p);registerDocsCommands(p);
 expect(commandMetadata(p)).toContainEqual({command:'release verify',flags:['--manifest','--json','--cwd']});
 expect(commandMetadata(p)).toContainEqual({command:'release status',flags:['--report','--json','--cwd']});
 expect(commandMetadata(p)).toContainEqual({command:'docs check',flags:['--manifest','--json','--cwd']});
 expect(p.commands.find(c=>c.name()==='release')!.commands.map(c=>c.name())).toEqual(['verify','status']);
});
it('includes inherited global options in generated command metadata',()=>{
 const p=new Command().name('quorate').option('--cwd <path>');registerDocsCommands(p);expect(commandMetadata(p).find(c=>c.command==='docs check')!.flags).toContain('--cwd');
});
