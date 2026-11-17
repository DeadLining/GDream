import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCancellationSafePatch, cancellationPatch } from './taskCancellation.ts';

test('cancel marks a recovered task terminal even without an AbortController', () => {
 const task = { status: 'running', rhTaskId: 'remote-id', resultPaths: ['saved.mp4'] };
 const cancelled = applyCancellationSafePatch(task, cancellationPatch(123));
 assert.equal(cancelled.status, 'failed');
 assert.equal(cancelled.cancelledAt, 123);
 assert.equal(cancelled.rhTaskId, 'remote-id');
 assert.deepEqual(cancelled.resultPaths, ['saved.mp4']);
});
test('late polling and completion cannot resurrect a cancelled task', () => {
 const task = { status: 'failed', cancelledAt: 123, error: 'cancelled' };
 for (const status of ['running', 'downloading', 'succeeded', 'failed']) {
  assert.deepEqual(applyCancellationSafePatch(task, { status, progress: 'late response' }), task);
 }
});
test('explicit manual recovery can clear cancellation marker', () => {
 const next = applyCancellationSafePatch({ status: 'failed', cancelledAt: 123 }, { status: 'running', cancelledAt: undefined });
 assert.equal(next.status, 'running');
 assert.equal(next.cancelledAt, undefined);
});
