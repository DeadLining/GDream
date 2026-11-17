import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRpc, tavilySearch, type TavilyPost } from './tavilyMcp.ts';
const key = 'fixture-key-not-real';
function fixture(content = 'Title: Product\nURL: https://example.com\nImages: https://example.com/photo.png') {
  const calls: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const post: TavilyPost = async (headers, body) => {
    calls.push({ headers, body });
    const result = body.method === 'initialize' ? { protocolVersion: '2024-11-05' } : { content: [{ type: 'text', text: content }] };
    return { ok: true, status: 200, headers: { 'mcp-session-id': 'session' }, data: body.id ? `event: message\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\r\n\r\n` : '' };
  };
  return { calls, post };
}
test('official MCP lifecycle preserves images, uses header-only key, no answer/vision request', async () => {
  const { calls, post } = fixture();
  const output = await tavilySearch(post, key, ' product ', 40);
  assert.match(output, /https:\/\/example.com\/photo.png/);
  assert.match(output, /read_image/);
  assert.deepEqual(calls.map(c => c.body.method), ['initialize', 'notifications/initialized', 'tools/call']);
  assert.equal(calls[0].headers.Authorization, `Bearer ${key}`);
  assert.equal(calls[2].headers['Mcp-Session-Id'], 'session');
  assert.equal(calls[2].headers['MCP-Protocol-Version'], '2024-11-05');
  assert.equal(JSON.stringify(calls.map(c => c.body)).includes(key), false);
  assert.deepEqual(calls[2].body.params, { name: 'tavily_search', arguments: { query: 'product', max_results: 20, search_depth: 'basic', topic: 'general', include_images: true, include_image_descriptions: false, include_raw_content: false } });
});
test('invalid input or missing credential performs no network', async () => {
  const { post, calls } = fixture();
  for (const [k, q, l] of [['', 'query', 1], [key, {}, 1], [key, '', 1], [key, 'x'.repeat(2001), 1], [key, 'query', NaN], [key, 'query', '3']]) {
    await assert.rejects(tavilySearch(post, k as string, q, l));
  }
  assert.equal(calls.length, 0);
});
test('JSON and SSE match response IDs, ignore notifications, reject malformed output', () => {
  assert.equal(parseRpc({ id: 2, result: {} }, 2).id, 2);
  assert.equal(parseRpc('data: {"method":"notification"}\n\ndata: {"id":2,"result":{}}\n\n', 2).id, 2);
  assert.throws(() => parseRpc('garbage', 2));
  assert.throws(() => parseRpc({ id: 3 }, 2));
});
test('HTTP/auth/quota/network errors never echo response body or key; no fallback', async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(tavilySearch(async () => { calls++; return { ok: false, status, headers: {}, data: key }; }, key, 'q', 1), { message: `Tavily HTTP ${status}` });
    assert.equal(calls, 1);
  }
  await assert.rejects(tavilySearch(async () => { throw new Error(key); }, key, 'q', 1), error => !String(error).includes(key));
});
test('tool errors and empty results fail; returned key is redacted', async () => {
  const { post } = fixture();
  await assert.rejects(tavilySearch(async (h, b) => b.method === 'tools/call' ? { ok: true, status: 200, headers: {}, data: { id: b.id, result: { isError: true, content: [{ type: 'text', text: key }] } } } : post(h,b), key, 'q', 1), /搜索失败/);
  await assert.rejects(tavilySearch(fixture('').post, key, 'q', 1), /未返回/);
  assert.equal((await tavilySearch(fixture(key).post, key, 'q', 1)).includes(key), false);
});
test('abort before dispatch and during an in-flight call stops follow-up requests', async () => {
  const controller = new AbortController(); controller.abort();
  const { post, calls } = fixture();
  await assert.rejects(tavilySearch(post, key, 'q', 1, controller.signal), /取消/);
  assert.equal(calls.length, 0);
  const active = new AbortController(); let count = 0;
  const pending = tavilySearch(async () => { count++; return new Promise(() => {}); }, key, 'q', 1, active.signal);
  active.abort();
  await assert.rejects(pending, /取消/);
  assert.equal(count, 1);
});
test('image-heavy JSON is bounded per source, retains all source titles and safe URLs', async () => {
  const raw = JSON.stringify({ answer: 'not wanted', images: ['javascript:alert(1)', 'https://user:pass@example.com/secret', ...Array(100).fill('https://example.com/photo.png')], results: [
    { title: 'first', url: 'https://example.com/1', content: 'x'.repeat(5000), images: Array.from({length: 200}, (_,i) => `https://example.com/${i}.png`) },
    { title: 'last', url: 'https://example.com/2', content: 'last source' },
  ] });
  const output = await tavilySearch(fixture(raw).post, key, 'q', 2);
  assert.match(output, /last source/);
  assert.ok(output.length < 4000);
  assert.doesNotMatch(output, /javascript:|user:pass|not wanted|199.png/);
});
