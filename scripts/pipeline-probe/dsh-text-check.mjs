/** Exercise actual quickChat -> ACP lifecycle with an offline Tauri backend. */
import assert from 'node:assert/strict';
import { installShims } from './preload.mjs';
installShims();
window.crypto = globalThis.crypto;
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const listeners = new Map();
const starts = []; const stops = []; let heldStart; let mode = 'success';
let responseReason = 'end_turn';
function emit(event, payload) {
  for (const entry of listeners.values()) if (entry.event === event) window[`_${entry.handler}`]?.({ payload });
}
window.__TAURI_IPC__ = (args) => {
  const ok = value => window[`_${args.callback}`]?.(value);
  if (args.__tauriModule === 'Path') return ok('/tmp');
  if (args.__tauriModule === 'Event') {
    const m = args.message;
    if (m.cmd === 'listen') { const id = listeners.size + 1; listeners.set(id, m); return ok(id); }
    if (m.cmd === 'unlisten') { listeners.delete(m.eventId); return ok(); }
  }
  if (args.cmd === 'dsh_start') {
    starts.push(args.request);
    if (mode === 'startup-hang') { heldStart = () => ok({}); return; }
    return ok({});
  }
  if (args.cmd === 'dsh_stop') { stops.push(args.runId); return ok(); }
  if (args.cmd === 'dsh_send') {
    const msg = JSON.parse(args.message);
    ok();
    const payload = { runId: args.runId, instanceId: args.instanceId };
    if (msg.method === 'session/prompt') {
      emit('dsh-acp-line', { ...payload, line: JSON.stringify({ method: 'session/update', params: { sessionId: 'test', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'DSH 完整结果' } } } }) });
    }
    emit('dsh-acp-line', { ...payload, line: JSON.stringify({ id: msg.id, result: msg.method === 'session/new' ? { sessionId: 'test' } : { stopReason: responseReason } }) });
    return;
  }
  // Settings hydration can ask for default config. No HTTP or tools allowed.
  if (args.cmd === 'read_private_defaults') return ok(null);
  window[`_${args.error}`]?.(`Unexpected IPC: ${args.cmd}/${args.__tauriModule}`);
};
const { quickChat, useSettingsStore } = await import('./.gen/harness.mjs');
useSettingsStore.setState({ providerDefault: 'custom', providerFallbackChain: [], providerModels: { custom: 'configured-test-model' }, providerApiKeys: { custom: 'offline-test-key' }, providerBaseUrls: { custom: 'http://127.0.0.1:1/v1' }, workspaceAgentModels: { canvas: 'global', workshop: 'global', editor: 'global' } });
assert.equal(await quickChat([{ role: 'user', content: 'test' }]), 'DSH 完整结果');
assert.equal(starts.length, 1); assert.equal(stops.length, 1);
assert.equal(starts[0].model, 'configured-test-model');
assert.equal(listeners.size, 0);
responseReason = 'max_tokens';
await assert.rejects(quickChat([{ role: 'user', content: 'test' }], { continueOnTruncation: true }), /token 上限.*原内容未修改/);
assert.equal(starts.length, 2, 'no truncation replay');
mode = 'startup-hang';
await assert.rejects(quickChat([{ role: 'user', content: 'test' }], { timeoutMs: 20 }), /超时/);
assert.equal(listeners.size, 0);
const stopCount = stops.length;
heldStart();
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(stops.length, stopCount + 1, 'late spawned child is killed again');
assert.equal(listeners.size, 0);
assert.equal(new Set(starts.map(s => s.runId)).size, starts.length);
console.log('PASS: actual quickChat/ACP, configured model, isolated run IDs, timeout, late spawn cleanup, no tool/HTTP/fallback/replay');
