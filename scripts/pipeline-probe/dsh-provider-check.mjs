// Offline integration: exercise the actual bridge, substituting only transports.
import assert from 'node:assert/strict';
import { installShims } from './preload.mjs';
installShims();
window.crypto = globalThis.crypto;
window.__TAURI_METADATA__ = { __currentWindow: { label: 'main' }, __windows: [] };
window.__TAURI_IPC__ = (args) => { window[`_${args.callback}`]?.(false); };
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { DshBridge, createDefaultRegistry } = await import('./.gen/harness.mjs');
for (const providerId of ['custom', 'glm', undefined]) {
  let context;
  const bridge = new DshBridge({
    createTools(_run, _instance, _registry, _callbacks, _dispatch, value) {
      context = value;
      return { async start() {}, abort() {}, dispose() {} };
    },
    createAcp(options, _instance, update) {
      assert.equal(options.model, 'configured-model');
      return {
        async start() {}, async cancel() {}, async dispose() {},
        async prompt() {
          update({ sessionId: 'probe', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OK' } } });
          return { stopReason: 'end_turn' };
        },
      };
    },
  });
  const result = await bridge.run({
    runId: 'probe', apiKey: 'unused', providerId, model: 'configured-model',
    baseUrl: 'http://localhost/v1', persona: '', workspace: '/offline', input: 'Reply OK',
    toolRegistry: createDefaultRegistry(),
    callbacks: { onTextDelta() {}, onThinkingDelta() {}, onToolStart() {}, onToolEnd() {}, onComplete() {}, onError() {} },
  });
  assert.deepEqual(context.languageModel, { providerId: providerId || 'deepseek', modelId: 'configured-model' });
  assert.equal(result.text, 'OK');
}
console.log('DSH tool context: custom, glm and legacy DeepSeek passed');
