import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedShotSyncConsent, permitsShotSync, parseShotSyncAuthorization } from './shotSyncAuthorization.ts';
const label = '授权修改第5集旧镜头的对白和不一致动作';
test('selected consent survives original preserve-only task, scoped to episode and allowed fields', () => {
  const consent = selectedShotSyncConsent([{ options: [{ label }, { label: '取消' }] }], [{ selected: [label] }]);
  assert.ok(permitsShotSync(consent, { shotNo: '05-01' }, ['dialogue', 'sourceExcerpt', 'description']));
  assert.equal(permitsShotSync(consent, { shotNo: '04-01' }, ['dialogue']), false);
  assert.equal(permitsShotSync(consent, { shotNo: '05-01' }, ['episode']), false);
});
test('unselected text and cancelled choices never grant permission', () => {
  assert.equal(selectedShotSyncConsent([{ options: [{ label }, { label: '取消' }] }], [{ selected: ['取消'] }]), undefined);
  assert.equal(selectedShotSyncConsent([{ options: [{ label: '取消' }] }], [{ selected: [label] }]), undefined);
  assert.equal(parseShotSyncAuthorization('不允许修改第5集旧镜头对白'), undefined);
});
