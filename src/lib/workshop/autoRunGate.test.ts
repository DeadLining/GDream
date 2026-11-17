import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldGateRemainingSteps,
  buildGateNotice,
  selectGatedCancellations,
  applyGateToQueue,
} from './autoRunGate.ts';

test('a gated step that ends in error cancels the rest of the chain', () => {
  assert.equal(shouldGateRemainingSteps(true, '请求错误：fetch failed'), true);
});

test('a gated step that succeeds lets the chain continue', () => {
  assert.equal(shouldGateRemainingSteps(true, null), false);
  assert.equal(shouldGateRemainingSteps(true, undefined), false);
});

test('manual queued prompts are never gated', () => {
  // 用户自己排的几条 prompt 不该因为前一条失败就被取消。
  assert.equal(shouldGateRemainingSteps(undefined, '出错了'), false);
  assert.equal(shouldGateRemainingSteps(false, '出错了'), false);
});

test('a blank error string is not treated as a failure', () => {
  assert.equal(shouldGateRemainingSteps(true, ''), false);
  assert.equal(shouldGateRemainingSteps(true, '   '), false);
});

test('the notice names the failure and the number of cancelled steps', () => {
  const notice = buildGateNotice('请求错误：模型流式响应首包超时（120 秒无数据）', 3);
  assert.match(notice, /后续 3 个步骤已取消/);
  assert.match(notice, /首包超时/);
  assert.match(notice, /点「继续一键全流程」/);
});

test('the notice still explains itself when nothing was left to cancel', () => {
  const notice = buildGateNotice('出错了', 0);
  assert.match(notice, /没有后续步骤需要取消/);
  assert.match(notice, /出错了/);
});

test('the notice never leaks an empty reason', () => {
  const notice = buildGateNotice('   ', 2);
  assert.match(notice, /未知错误/);
  assert.doesNotMatch(notice, /失败原因：\s*$/m);
});

test('门控只取消排队中的后继步骤，不动正在执行的那一条', () => {
  const queue = [
    { id: 'head', status: 'running' },
    { id: 'step2', status: 'queued' },
    { id: 'step3', status: 'queued' },
  ] as const;
  assert.deepEqual(
    selectGatedCancellations(queue, 'head').map((q) => q.id),
    ['step2', 'step3'],
  );
});

test('门控不把「刚失败的那条」算进取消数量', () => {
  // 原实现把计数塞进 setQueue 的 updater（副作用），React 延后求值时
  // 计数会退化成 0，提示与实际取消数量不符。
  const queue = [{ id: 'head', status: 'running' }, { id: 'a', status: 'queued' }] as const;
  assert.equal(selectGatedCancellations(queue, 'head').length, 1);
  assert.deepEqual(selectGatedCancellations([], 'head'), []);
});

test('没有后继步骤时取消集合为空，提示仍会说明「没有后续步骤」', () => {
  const queue = [{ id: 'head', status: 'running' }] as const;
  assert.deepEqual(selectGatedCancellations(queue, 'head'), []);
  assert.match(buildGateNotice('boom', 0), /没有后续步骤需要取消/);
});

test('applyGateToQueue 保留执行中条目、清掉排队条目与失败条目', () => {
  const queue = [
    { id: 'other-running', status: 'running' },
    { id: 'head', status: 'running' },
    { id: 'queued-1', status: 'queued' },
  ] as const;
  assert.deepEqual(
    applyGateToQueue(queue, 'head').map((q) => q.id),
    ['other-running'],
  );
});
