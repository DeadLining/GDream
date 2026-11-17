import test from 'node:test';
import assert from 'node:assert/strict';
import { missingPersistedShotResult } from './missingShotRecovery.ts';

test('missing unsaved shots are a pre-write recoverable error with an actionable submission path', () => {
  const result = missingPersistedShotResult('02-02');
  assert.equal(result.success, false);
  assert.equal(result.recoverable, true);
  assert.equal(result.terminal, undefined);
  assert.match(result.error!, /02-02.*不在当前已保存/);
  assert.match(result.error!, /本次未做任何修改/);
  assert.match(result.error!, /原始 shots.*workshop_set_shots/);
  assert.match(result.error!, /若不是失败批次修复/);
});
