import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Unix Tauri scopes require literal leading dots: $HOME/** does not grant
// access to persisted asset paths under the old hidden data directory.
const config = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
for (const [name, scope] of [
  ['asset protocol', config.tauri.allowlist.protocol.assetScope],
  ['filesystem', config.tauri.allowlist.fs.scope],
] as const) {
  test(`${name} retains explicit access to both data directories after rename`, () => {
    assert.ok(scope.includes('$HOME/.kunpeng/**'));
    assert.ok(scope.includes('$HOME/.gdream/**'));
  });
}
