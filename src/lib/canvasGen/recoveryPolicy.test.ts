import test from 'node:test';
import assert from 'node:assert/strict';
import { isIndefiniteRecoveryTask, recoveryFailurePolicy } from './recoveryPolicy.ts';

const h3Task = {
  kind: 'video' as const,
  engineId: 'minimax-h3',
  engineLabel: '自定义（SGLang MiniMax-H3）',
  endpoint: '/v1/videos',
};

test('keeps SGLang MiniMax-H3 recovery alive without an attempt ceiling', () => {
  assert.equal(isIndefiniteRecoveryTask(h3Task), true);
  const decision = recoveryFailurePolicy(h3Task, 300);
  assert.equal(decision.shouldFail, false);
  assert.match(decision.progress, /保留原任务 ID/);
  assert.match(decision.progress, /10 秒后继续查询/);
});

test('retains the bounded failure policy for other task types', () => {
  const imageTask = {
    kind: 'image' as const,
    engineId: 'seedream-v5-pro',
    engineLabel: 'Seedream 5 Pro',
    endpoint: '/v1/images/generations',
  };
  assert.equal(isIndefiniteRecoveryTask(imageTask), false);
  assert.equal(recoveryFailurePolicy(imageTask, 29).shouldFail, false);
  assert.equal(recoveryFailurePolicy(imageTask, 30).shouldFail, true);
});

test('stops repeated H3 not-found recovery without treating queued jobs as failed', () => {
  assert.equal(recoveryFailurePolicy(h3Task, 2, 30, 'HTTP 404').shouldFail, false);
  assert.equal(recoveryFailurePolicy(h3Task, 3, 30, 'SGLang 任务恢复查询失败：HTTP 404').shouldFail, true);
  assert.equal(recoveryFailurePolicy(h3Task, 300, 30, 'HTTP 502').shouldFail, false);
});
