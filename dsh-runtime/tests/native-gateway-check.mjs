/** Provider-free wire test of production Rust config + ACP + MCP + pi-ai. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const work = await mkdtemp(join(tmpdir(), 'gdream-native-wire-'));
const input = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#ff0000' } }).png().toBuffer();
const output = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#0000ff' } }).jpeg().toBuffer();
await writeFile(join(work, 'input.png'), input);
await writeFile(join(work, 'output.png'), output);
const requests = [];
const server = http.createServer(async (req, res) => {
  let data = '';
  for await (const chunk of req) data += chunk;
  try {
    const body = JSON.parse(data);
    requests.push({ path: req.url, body });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const delta = requests.length === 1
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-image-probe', type: 'function', function: { name: 'mcp__gdream__probe_echo', arguments: '{"text":"hello"}' } }] }
      : { role: 'assistant', content: 'ECHO:hello' };
    const chunk = { id: `response-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: 'native-wire-test' };
    res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch { res.writeHead(500); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, 'gateway-smoke.mjs')], {
      env: { ...process.env, GDREAM_DSH_LLM_API_KEY: 'isolated-test-key',
        GDREAM_SMOKE_MODEL: 'native-wire-test', GDREAM_SMOKE_BASE_URL: `http://127.0.0.1:${server.address().port}/openai/v1`,
        GDREAM_SMOKE_IMAGE: join(work, 'input.png'), GDREAM_SMOKE_TOOL_IMAGE: join(work, 'output.png'),
        GDREAM_SMOKE_EXPECT: '', SMOKE_PROMPT: 'Call probe_echo with text hello then reply ECHO:hello.' },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Native smoke failed (${code})`)));
  });
  assert.equal(requests.length, 2, 'one model handles input and tool result; no separate vision request');
  for (const request of requests) {
    assert.equal(request.path, '/openai/v1/chat/completions');
    assert.equal(request.body.model, 'native-wire-test');
  }
  const imageURLs = (body) => body.messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((block) => block.type === 'image_url').map((block) => block.image_url.url) : []);
  assert.ok(imageURLs(requests[0].body).includes(`data:image/png;base64,${input.toString('base64')}`), 'native user image arrives on wire');
  if (!imageURLs(requests[1].body).includes(`data:image/jpeg;base64,${output.toString('base64')}`)) console.error(JSON.stringify(requests[1].body.messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : (m.content || []).map((b) => ({ type: b.type, text: b.text })) })), null, 2));
  assert.ok(imageURLs(requests[1].body).includes(`data:image/jpeg;base64,${output.toString('base64')}`), 'MCP image survives native tool result projection');
  console.log('PASS: native ACP input + native MCP output reach the same selected model as image_url blocks.');
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(work, { recursive: true, force: true });
}
