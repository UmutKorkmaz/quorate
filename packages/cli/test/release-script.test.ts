import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const releaseScript=readFileSync(new URL('../../../scripts/release.sh',import.meta.url),'utf8');
describe('release helper',()=>{
 it('publishes only the self-contained public CLI package',()=>{expect(releaseScript).toContain('run npm publish --workspace quorate "${PUBLISH_ARGS[@]}"');expect(releaseScript).not.toMatch(/npm publish --workspace @quorate\/core/);});
 it('runs standalone verification only after GitHub release and npm publication',()=>{
  const tag=releaseScript.indexOf('run git tag -a'),release=releaseScript.indexOf('run gh release create'),publish=releaseScript.indexOf('run npm publish'),verify=releaseScript.indexOf('run node scripts/verify-published-cli.mjs --version "$VERSION"');
  expect(tag).toBeGreaterThan(0);expect(release).toBeGreaterThan(tag);expect(publish).toBeGreaterThan(release);expect(verify).toBeGreaterThan(publish);
 });
 it('leaves bounded registry retries to the independently tested recovery helper',()=>{const recovery=releaseScript.slice(releaseScript.indexOf('# Retry package availability'));expect(recovery).toContain('verify-published-cli.mjs');expect(recovery).not.toMatch(/npm publish|npm exec/);});
});
