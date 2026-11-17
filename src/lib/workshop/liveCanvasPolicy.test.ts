import test from 'node:test';
import assert from 'node:assert/strict';
import { canSyncWorkshopCanvas, mergeCanvasVersions } from './liveCanvasPolicy.ts';
test('never synchronizes an unloaded or different project canvas', () => {
  assert.equal(canSyncWorkshopCanvas('a', 'a', false), true);
  assert.equal(canSyncWorkshopCanvas('a', 'b', false), false);
  assert.equal(canSyncWorkshopCanvas('a', 'a', true), false);
  assert.equal(canSyncWorkshopCanvas(undefined, null, false), false);
});
test('versions preserve old results, deduplicate retries, and retain provenance', () => {
  const first = mergeCanvasVersions([], [{ path: '/a', createdAt: 1, prompt: 'original' }], '/a');
  const next = mergeCanvasVersions(first, [{ path: '/b', createdAt: 2, prompt: 'new' }], '/b');
  assert.equal(next.length, 2);
  assert.equal(next[0].prompt, 'original');
  assert.deepEqual(mergeCanvasVersions(next, [{ path: '/b', createdAt: 2, prompt: 'new' }], '/b'), next);
});
