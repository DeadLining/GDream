import assert from 'node:assert/strict';
import test from 'node:test';
import { retryDecision, shouldRetainFailedTask } from './retryPolicy.ts';

test('recovers a failed task when a provider task id exists', () => {
  assert.equal(retryDecision({ rhTaskId: 'remote-1', submissionCommitted: true }), 'recover');
});

test('blocks resubmission when payment may have been committed without a handle', () => {
  assert.equal(retryDecision({ submissionUncertain: true }), 'blocked');
  assert.equal(retryDecision({ submissionCommitted: true }), 'blocked');
});

test('allows retry only when no submission evidence exists', () => {
  assert.equal(retryDecision({}), 'retry');
});

test('retains failed tasks that still carry recovery or payment evidence', () => {
  assert.equal(shouldRetainFailedTask({ status: 'failed', rhTaskId: 'remote-1' }), true);
  assert.equal(shouldRetainFailedTask({ status: 'failed', submissionCommitted: true }), true);
  assert.equal(shouldRetainFailedTask({ status: 'failed' }), false);
});
