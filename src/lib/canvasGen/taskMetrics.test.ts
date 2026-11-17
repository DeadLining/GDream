import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCanvasTasks } from './taskMetrics.ts';

test('summarizes global queue and recoverable task state', () => {
  const tasks = [
    { id: '1', projectId: 'p1', status: 'queued' as const, rhTaskId: undefined },
    { id: '2', projectId: 'p1', status: 'running' as const, rhTaskId: 'remote-2' },
    { id: '3', projectId: 'p2', status: 'failed' as const, rhTaskId: 'remote-3' },
    { id: '4', status: 'succeeded' as const, rhTaskId: undefined },
  ] as Parameters<typeof summarizeCanvasTasks>[0];
  const metrics = summarizeCanvasTasks(tasks);
  assert.equal(metrics.total, 4);
  assert.equal(metrics.queued, 1);
  assert.equal(metrics.active, 1);
  assert.equal(metrics.failed, 1);
  assert.equal(metrics.succeeded, 1);
  assert.equal(metrics.recoverable, 2);
  assert.deepEqual(metrics.byProject, { p1: 2, p2: 1, unbound: 1 });
});
