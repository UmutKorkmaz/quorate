import { expect,it } from 'vitest';
import { posix,win32 } from 'node:path';
import { isPathWithinPackage } from '../src/release/package-path.js';

it('rejects a sibling Windows package entrypoint after canonical resolution',()=>{
 const root=String.raw`C:\scratch\node_modules\quorate`;
 const sibling=String.raw`C:\scratch\node_modules\other\cli.js`;
 expect(win32.relative(root,sibling)).toBe(String.raw`..\other\cli.js`);
 expect(isPathWithinPackage(root,sibling,win32)).toBe(false);
});
it('rejects a sibling Windows UNC package entrypoint',()=>{
 expect(isPathWithinPackage(String.raw`\\host\share\quorate`,String.raw`\\host\share\other\cli.js`,win32)).toBe(false);
});
it('rejects a Windows package entrypoint on a different drive',()=>{
 expect(isPathWithinPackage(String.raw`C:\scratch\quorate`,String.raw`D:\other\cli.js`,win32)).toBe(false);
});
it('accepts a contained Windows entrypoint with normalized case and separators',()=>{
 expect(isPathWithinPackage(String.raw`C:\scratch\node_modules\quorate`,'c:/scratch/node_modules/quorate/dist/index.js',win32)).toBe(true);
});
it('preserves POSIX containment and rejects sibling package names with a shared prefix',()=>{
 expect(isPathWithinPackage('/scratch/node_modules/quorate','/scratch/node_modules/quorate/dist/index.js',posix)).toBe(true);
 expect(isPathWithinPackage('/scratch/node_modules/quorate','/scratch/node_modules/other/cli.js',posix)).toBe(false);
 expect(isPathWithinPackage('/scratch/node_modules/quorate','/scratch/node_modules/quorate-other/cli.js',posix)).toBe(false);
});
it('preserves a literal backslash in a POSIX filename',()=>{
 expect(isPathWithinPackage('/scratch/quorate',String.raw`/scratch/quorate/..\literal.js`,posix)).toBe(true);
});
