import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Hidden app data needs an explicit scope even when $HOME/** is present.
const config = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
for (const [name, scope] of [
  ['asset protocol', config.tauri.allowlist.protocol.assetScope],
  ['filesystem', config.tauri.allowlist.fs.scope],
] as const) {
  test(`${name} grants the current GDream hidden data directory only`, () => {
    assert.deepEqual(scope.filter((entry: string) => entry.startsWith('$HOME/.')), ['$HOME/.gdream/**']);
  });
}
