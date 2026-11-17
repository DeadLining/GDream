/** Production web_search + registry + settings, with only Tauri IO replaced. */
import assert from 'node:assert/strict';
import { installShims } from './preload.mjs';
installShims();
window.crypto = globalThis.crypto;
window.__TAURI_METADATA__ = { __currentWindow: { label: 'main' }, __windows: [] };
const calls = [];
window.__TAURI_IPC__ = (args) => {
  const done = value => window[`_${args.callback}`]?.(value);
  if (args.__tauriModule === 'Fs' && args.message.cmd === 'exists') return done(false);
  if (args.__tauriModule === 'Http' && args.message.cmd === 'createClient') return done(1);
  if (args.cmd === 'write_text_file_private') return done(null); // isolated; never write real credentials
  if (args.__tauriModule === 'Http' && args.message.cmd === 'httpRequest') {
    const options = args.message.options; calls.push(options);
    assert.equal(options.url, 'https://mcp.tavily.com/mcp/');
    assert.equal(options.timeout, 30);
    assert.equal(options.headers.Authorization, 'Bearer fixture-tavily-only');
    const body = options.body.payload;
    const result = body.method === 'initialize' ? { protocolVersion: '2024-11-05' } : {
      content: [{ type: 'text', text: JSON.stringify({ results: [{ title: 'Product', url: 'https://example.com/product', content: 'Evidence' }], images: ['https://example.com/product.png'] }) }],
    };
    return done({ url: options.url, status: body.id ? 200 : 202, headers: {}, data: body.id ? JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) : '' });
  }
  return window[`_${args.error}`]?.('Unexpected IPC in isolated test');
};
globalThis.fetch = async () => { throw new Error('Unmocked network forbidden'); };
const { createDefaultRegistry, useSettingsStore } = await import('./.gen/harness.mjs');
const registry = createDefaultRegistry();
const tool = registry.get('web_search');
useSettingsStore.setState({ webSearchEnabled: false });
assert.equal((await tool.execute({ query: 'product' })).success, false);
assert.equal(calls.length, 0);
useSettingsStore.setState({ webSearchEnabled: true, credentials: [], credentialRefs: {}, dmxApiKey: 'do-not-use', providerApiKeys: { custom: 'do-not-use' } });
assert.equal((await tool.execute({ query: 'product' })).success, false);
assert.equal(calls.length, 0, 'must not borrow DMX or Gateway key');
useSettingsStore.setState({ credentials: [{ id: 'tavily-test', label: 'Tavily', apiKey: 'fixture-tavily-only', baseUrl: 'https://mcp.tavily.com/mcp/', createdAt: 1 }], credentialRefs: { tavily: 'tavily-test' } });
const result = await tool.execute({ query: 'product', limit: 3 });
assert.equal(result.success, true, result.error);
assert.match(result.output, /https:\/\/example.com\/product.png/);
assert.equal(calls.length, 3);
assert.equal(calls[2].body.payload.params.name, 'tavily_search');
assert.equal(calls[2].body.payload.params.arguments.include_images, true);
const cancelled = new AbortController(); cancelled.abort();
assert.equal((await tool.execute({query:'product'}, cancelled.signal)).success, false);
assert.equal(calls.length, 3);
console.log('PASS: production web_search uses official Tavily MCP, preserves image URLs, honors gating/cancellation, and never borrows model/DMX keys.');
