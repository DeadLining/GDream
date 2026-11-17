import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueVideoGeneration } from './videoGenerationQueue.ts';

test('video jobs run strictly in submission order', async () => {
  const events: string[] = [];
  const { promise } = enqueueVideoGeneration(Promise.resolve(), [
    async () => { events.push('start-1'); await new Promise(r => setTimeout(r, 5)); events.push('end-1'); },
    async () => { events.push('start-2'); events.push('end-2'); },
  ]);
  await promise;
  assert.deepEqual(events, ['start-1', 'end-1', 'start-2', 'end-2']);
});

test('a later batch waits for an earlier video batch', async () => {
  const events: string[] = [];
  const first = enqueueVideoGeneration(Promise.resolve(), [async () => { events.push('first'); }]);
  const second = enqueueVideoGeneration(first.promise, [async () => { events.push('second'); }]);
  await second.promise;
  assert.deepEqual(events, ['first', 'second']);
});
