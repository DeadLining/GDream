/** Real frontend tools with only Tauri IO substituted; no network/model/application state. */
import assert from 'node:assert/strict';
import { installShims } from './preload.mjs';
installShims();
window.crypto = globalThis.crypto;
window.__TAURI_METADATA__ = { __currentWindow: { label: 'main' }, __windows: [] };
const bytes = [...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64')];
const network = [];
window.__TAURI_IPC__ = (args) => {
  const done = (value) => window[`_${args.callback}`]?.(value);
  const fail = (value) => window[`_${args.error}`]?.(value);
  if (args.cmd === 'browser_screenshot') return done('/isolated/screenshot.png');
  if (args.cmd === 'get_file_size') return done(bytes.length);
  if (args.__tauriModule === 'Fs' && args.message.cmd === 'readFile') return done(bytes);
  if (args.__tauriModule === 'Fs' && args.message.cmd === 'exists') return done(false);
  if (args.__tauriModule === 'Http' && args.message.cmd === 'createClient') return done(1);
  if (args.__tauriModule === 'Http' && args.message.cmd === 'httpRequest') {
    const options = args.message.options;
    network.push(options);
    assert.equal(options.method, 'GET', 'tools never call a model endpoint');
    assert.equal(options.headers?.Authorization, undefined, 'no provider key sent to image site');
    if (options.url === 'https://fixture.invalid/product') return done({ url: options.url, status: 200, headers: { 'content-type': 'text/html' }, data: `<html><body><p>${'product information '.repeat(20)}</p><img src='/photo.png' alt='product'></body></html>` });
    if (options.url === 'https://fixture.invalid/photo.png') return done({ url: options.url, status: 200, headers: { 'content-type': 'image/png' }, data: bytes });
    return fail('Unexpected network destination');
  }
  // Import-time settings reads must stay isolated; all writes are forbidden.
  if (args.__tauriModule === 'Path') return done('/isolated');
  return fail(`Unexpected IPC: ${args.cmd || args.message?.cmd}`);
};
globalThis.fetch = async () => { throw new Error('Unmocked network forbidden'); };
const { createDefaultRegistry } = await import('./.gen/harness.mjs');
const registry = createDefaultRegistry();
assert.equal(registry.get('image_recognition'), undefined, 'independent recognition is no longer exposed');
const read = await registry.get('read_image').execute({ image: 'https://fixture.invalid/photo.png' });
assert.equal(read.success, true, read.error);
assert.equal(read.media[0].type, 'image');
assert.equal(read.media[0].source.type, 'base64');
const screenshot = await registry.get('browser_control').execute({ action: 'screenshot' });
assert.equal(screenshot.success, true, screenshot.error);
assert.equal(screenshot.media[0].type, 'image');
const page = await registry.get('web_fetch').execute({ url: 'https://fixture.invalid/product' });
assert.equal(page.success, true, page.error);
assert.ok(page.output.includes('https://fixture.invalid/photo.png'));
assert.equal(network.length, 2, 'web reading lists images without fetching every image or invoking vision');
console.log('PASS: read_image and browser screenshots emit native media; web_fetch returns image references; no standalone vision tool or model request.');

// Ordinary-mode fallback must not turn a rejected image into a text-only retry.
const { GLMClient } = await import('./.gen/harness.mjs');
const client = new GLMClient({ apiKey: 'unused', baseUrl: 'https://fixture.invalid', model: 'selected-model' });
let attempts = 0;
client._streamChatOnce = async function* (_messages, _tools, _signal, model, forceTextOnly, requireNativeImages) {
  attempts++;
  assert.equal(model, 'selected-model');
  assert.equal(forceTextOnly, false);
  assert.equal(requireNativeImages, true);
  throw new Error('does not support image');
};
await assert.rejects(async () => {
  for await (const _chunk of client.streamChat([{ role: 'user', content: read.media }])) { /* no output expected */ }
}, /does not support image/);
assert.equal(attempts, 1, 'unsupported images fail without a text-only replay');
console.log('PASS: ordinary-mode image rejection stays on the selected model and never drops images.');

const { registerProvider, unregisterProvider, streamWithFallback } = await import('./.gen/harness.mjs');
let otherProviderCalls = 0;
registerProvider({ id: 'native-primary-test', displayName: 'test', baseUrl: '', models: [], defaultModelId: 'selected-model',
  async *streamChat(req) { assert.equal(req.requireNativeImages, true); throw Object.assign(new Error('does not support image'), { status: 400 }); }, async chat() { return ''; } });
registerProvider({ id: 'native-other-test', displayName: 'test', baseUrl: '', models: [], defaultModelId: 'other-model',
  async *streamChat() { otherProviderCalls++; }, async chat() { return ''; } });
try {
  await assert.rejects(async () => {
    for await (const _chunk of streamWithFallback({ kind: 'fallback_chain', chain: [
      { providerId: 'native-primary-test', triggerCodes: [400] }, { providerId: 'native-other-test' },
    ] }, { messages: [{ role: 'user', content: read.media }] }, {})) { /* no output */ }
  });
  assert.equal(otherProviderCalls, 0, 'even configured failure chains cannot silently move images to another model');
} finally {
  unregisterProvider('native-primary-test'); unregisterProvider('native-other-test');
}
console.log('PASS: native image requests do not silently cross providers on failure.');
