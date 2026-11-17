import test from 'node:test';
import assert from 'node:assert/strict';
import { RepeatedToolFailureGuard } from './repeatedToolFailure.ts';
const fail = { success: false, output: '', error: '缺少结构化字段：characters' };
test('same error stops after one repair attempt even with intervening reads', () => {
  const guard = new RepeatedToolFailureGuard();
  assert.equal(guard.observe('workshop_set_breakdown', fail), undefined);
  guard.observe('workshop_get_state', { success: true, output: 'ok' });
  assert.match(guard.observe('workshop_set_breakdown', fail)!, /重复失败/);
});
test('success for the same tool resets its failures; runs are isolated', () => {
  const guard = new RepeatedToolFailureGuard();
  guard.observe('workshop_set_breakdown', fail);
  guard.observe('workshop_set_breakdown', { success: true, output: 'ok' });
  assert.equal(guard.observe('workshop_set_breakdown', fail), undefined);
  assert.equal(new RepeatedToolFailureGuard().observe('workshop_set_breakdown', fail), undefined);
});
test('different errors have separate repair budgets and blank failures still stop', () => {
  const guard = new RepeatedToolFailureGuard();
  guard.observe('x', fail);
  assert.equal(guard.observe('x', { ...fail, error: 'another error' }), undefined);
  assert.equal(guard.observe('y', { success: false, output: '' }), undefined);
  assert.ok(guard.observe('y', { success: false, output: '' }));
});
