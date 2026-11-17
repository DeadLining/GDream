import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRetryStreamFailure } from './streamRetry.ts';

test('retries a transport idle timeout that produced no output', () => {
  const err = { message: 'DeepSeek 0: Stream idle timeout (90s without data)', status: 0 };
  assert.equal(shouldRetryStreamFailure(err, false, false), true);
});

test('retries a network error with no status', () => {
  assert.equal(shouldRetryStreamFailure({ message: 'Network error: connection reset' }, false, false), true);
});

test('never retries once the turn already produced output', () => {
  const err = { message: 'Stream idle timeout', status: 0 };
  assert.equal(shouldRetryStreamFailure(err, true, false), false);
});

test('never retries after the user aborted', () => {
  const err = { message: 'Stream idle timeout', status: 0 };
  assert.equal(shouldRetryStreamFailure(err, false, true), false);
  assert.equal(shouldRetryStreamFailure({ name: 'AbortError', message: 'Aborted' }, false, false), false);
});

test('does not retry a business error that would simply repeat', () => {
  const err = { message: 'context_length_exceeded: prompt is too long', status: 400 };
  assert.equal(shouldRetryStreamFailure(err, false, false), false);
});

test('retries upstream pressure statuses', () => {
  assert.equal(shouldRetryStreamFailure({ status: 503, message: 'bad gateway' }, false, false), true);
  assert.equal(shouldRetryStreamFailure({ status: 429, message: 'rate limited' }, false, false), true);
});
