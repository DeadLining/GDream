/** Offline regression: context/history remains independent of DSH execution state. */
import assert from 'node:assert/strict';
import { installShims } from './preload.mjs';
installShims();
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { AgentCoordinator, createDefaultRegistry } = await import('./.gen/harness.mjs');
function fixture() {
  const adapter = new AgentCoordinator({
    glmClient: { config: { model: 'glm-5.1' } },
    toolRegistry: createDefaultRegistry(), cwd: '/offline',
  });
  let finish;
  adapter.contextManager = {
    updateMaxTokens() {}, resetUsage() {}, estimateMessages: () => 2_000_000,
    microcompact: (messages) => messages, hardClamp: (messages) => messages,
    compact: () => new Promise((resolve) => { finish = resolve; }),
  };
  return { adapter, resolve: () => finish([{ role: 'assistant', content: 'STALE' }]) };
}
for (const operation of ['restore', 'compact']) {
  const f = fixture();
  const pending = operation === 'restore'
    ? f.adapter.restoreMessages([{ role: 'user', content: 'old history' }])
    : f.adapter.compactNow();
  f.adapter.recordHarnessTurn('new request', 'DSH result');
  f.resolve();
  await pending;
  assert.ok(f.adapter.getMessages().some((m) => m.content === 'DSH result'));
  assert.ok(!f.adapter.getMessages().some((m) => m.content === 'STALE'));
  for (const method of ['run', 'abort', 'getIsRunning', 'getAbortController', 'getCurrentCallbacks']) {
    assert.equal(method in f.adapter, false);
  }
}
const f = fixture();
const pending = f.adapter.restoreMessages([{ role: 'user', content: 'old history' }]);
f.adapter.clear();
f.resolve();
await pending;
assert.ok(f.adapter.getMessages().every((m) => m.role === 'system'));
console.log('PASS DSH context: no legacy execution APIs; stale compaction cannot overwrite new turns or cleared history');
