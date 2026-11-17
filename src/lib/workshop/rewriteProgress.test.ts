import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceRewriteTask, rewriteProgressRows, type WorkshopRewriteTask } from './rewriteProgress.ts';
const initial = (): WorkshopRewriteTask => ({ key: 'p:1', projectId: 'p', shotNo: '01-01', phase: 'preparing', startedAt: 1, completedPhases: [] });
test('reusing a valid timeline never claims to have executed planning', () => {
  let task = initial();
  for (const phase of ['writing', 'saving', 'done'] as const) task = advanceRewriteTask(task, phase);
  assert.equal(task.timelineMode, 'reused');
  assert.equal(rewriteProgressRows(task)[1].status, 'reused');
  assert.match(rewriteProgressRows(task)[1].label, /复用/);
  assert.ok(!task.completedPhases?.includes('planning'));
});
test('a successfully persisted plan has its own completion evidence', () => {
  let task = initial();
  for (const phase of ['planning', 'writing', 'saving', 'done'] as const) task = advanceRewriteTask(task, phase);
  assert.equal(task.timelineMode, 'planned');
  assert.ok(rewriteProgressRows(task).every(row => row.status === 'completed'));
});
test('a planning failure does not complete planning or any later phase', () => {
  const task = advanceRewriteTask(advanceRewriteTask(initial(), 'planning'), 'failed', 'invalid timeline');
  assert.deepEqual(rewriteProgressRows(task).map(row => row.status), ['completed', 'failed', 'pending', 'pending']);
  assert.equal(advanceRewriteTask(task, 'done'), task);
});
test('a saving failure preserves completed steps without claiming a save', () => {
  let task = initial();
  for (const phase of ['writing', 'saving', 'failed'] as const) task = advanceRewriteTask(task, phase);
  assert.deepEqual(rewriteProgressRows(task).map(row => row.status), ['completed', 'reused', 'completed', 'failed']);
});
