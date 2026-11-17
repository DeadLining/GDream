import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRunFailureNotice, isAbortFailure } from './runFailureNotice.ts';

test('surfaces the reason and a recovery hint instead of staying silent', () => {
  const notice = buildRunFailureNotice('Stream idle timeout (90s without data)');
  assert.match(notice, /本轮任务未能完成/);
  assert.match(notice, /Stream idle timeout/);
  assert.match(notice, /从已保存进度继续/);
  assert.doesNotMatch(notice, /直接重发|换个模型/);
});

test('collapses multi-line transport noise into one readable reason', () => {
  const notice = buildRunFailureNotice('DeepSeek 0: line1\n   line2\n\nline3');
  assert.match(notice, /原因：DeepSeek 0: line1 line2 line3/);
  assert.equal(notice.includes('\n\n原因'), false);
});

test('still produces a usable notice when the message is empty', () => {
  const notice = buildRunFailureNotice('');
  assert.match(notice, /本轮任务未能完成/);
  assert.equal(notice.includes('原因：'), false);
});

test('recognizes user aborts so they are not reported as failures', () => {
  assert.equal(isAbortFailure('Aborted'), true);
  assert.equal(isAbortFailure('[GDream] 操作已中止。'), true);
  assert.equal(isAbortFailure('Stream idle timeout'), false);
  assert.equal(isAbortFailure(undefined), false);
});
