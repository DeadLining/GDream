/** Tool-free ACP turns against a local SSE fixture, never a paid provider. */
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const work = await mkdtemp(join(tmpdir(), 'gdream-text-wire-'));
let scenario;
let requests = 0;
const gateway = http.createServer(async (req, res) => {
  for await (const _chunk of req) { /* Drain the request without logging it. */ }
  requests++;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const base = { id: 'text-fixture', object: 'chat.completion.chunk', created: 1, model: 'text-fixture' };
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  send({ role: 'assistant', reasoning_content: 'fixture reasoning' });
  if (scenario.text) {
    send({ content: scenario.text.slice(0, 7) });
    await new Promise((done) => setTimeout(done, 20));
    send({ content: scenario.text.slice(7) });
  }
  send({}, scenario.finish);
  res.end('data: [DONE]\n\n');
});
const sockets = new Set();
let toolCalls = 0;
const bridge = net.createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.setEncoding('utf8');
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const at = buffer.indexOf('\n');
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.type === 'hello') socket.write(`${JSON.stringify({ type: 'hello_ok' })}\n`);
      if (message.type === 'list_tools') socket.write(`${JSON.stringify({ type: 'list_tools', requestId: message.requestId, ok: true, result: [] })}\n`);
      if (message.type === 'call_tool') toolCalls++;
    }
  });
});
let child;
try {
  await new Promise((done) => gateway.listen(0, '127.0.0.1', done));
  await new Promise((done) => bridge.listen(0, '127.0.0.1', done));
  const config = [
    { id: 'llm', name: join(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), config: { providers: { fixture: {
      displayName: 'fixture', apiKeyEnv: 'GDREAM_TEST_KEY', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${gateway.address().port}/v1`, defaultContextWindow: 100000, defaultMaxTokens: 16000,
      models: [{ id: 'text-fixture', name: 'text-fixture', input: ['text'], contextWindow: 100000, maxTokens: 16000 }],
    } } } },
    { id: 'acp', name: join(root, 'gdream-acp-host.mjs'), config: {
      provider: 'fixture', model: 'text-fixture', persona: 'Return only the requested text.',
      workspaceContext: false, skills: { enabled: false }, toolBash: false, toolJobs: false, goals: false,
      persistenceRoot: join(work, 'sessions'), packChunks: true, persistenceCompression: 'none',
      mcp: { transport: 'stdio', serverName: 'gdream', command: join(root, 'node/bin/node'),
        args: [join(root, 'gdream-mcp-server.mjs')], cwd: work,
        env: { GDREAM_TOOL_BRIDGE_ADDR: `127.0.0.1:${bridge.address().port}`, GDREAM_TOOL_BRIDGE_TOKEN: 'fixture', GDREAM_DSH_RUN_ID: 'fixture', GDREAM_DSH_INSTANCE_ID: 'fixture' },
        failOnStartupError: true, reconnect: { enabled: false } },
    } },
  ];
  const path = join(work, 'cordis.json');
  await writeFile(path, JSON.stringify(config));
  child = spawn(join(root, 'node/bin/node'), [join(root, 'node_modules/@deepseek-ai/dsh-acp-demo/lib/bin.js'), '--config', path], {
    cwd: work, env: { HOME: work, PATH: process.env.PATH, GDREAM_TEST_KEY: 'local-fixture-only', DSH_TELEMETRY_MODE: 'DISABLED' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = ''; let text = ''; let next = 1;
  const pending = new Map();
  child.stderr.resume();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const at = buffer.indexOf('\n'); const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method === 'session/update' && message.params.update.sessionUpdate === 'agent_message_chunk') text += message.params.update.content?.text ?? '';
      if (!message.method && pending.has(message.id)) {
        const waiter = pending.get(message.id); pending.delete(message.id); clearTimeout(waiter.timer);
        message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
      }
    }
  });
  child.on('exit', () => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Fixture ACP exited')); }
    pending.clear();
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  await request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  for (const test of [
    { name: 'completed', text: 'complete prompt '.repeat(1000), finish: 'stop', expected: 'end_turn' },
    { name: 'reasoning-only limit', text: '', finish: 'length', expected: 'max_tokens' },
    { name: 'partial limit', text: 'unfinished prompt', finish: 'length', expected: 'max_tokens' },
    { name: 'genuinely empty', text: '', finish: 'stop', expected: 'end_turn' },
  ]) {
    scenario = test; text = '';
    const before = requests;
    const session = await request('session/new', { cwd: work, mcpServers: [] });
    const result = await request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Rewrite this shot.' }] });
    assert.equal(result.stopReason, test.expected, test.name);
    assert.equal(text, test.text, `${test.name}: all text delivered before completion, reasoning excluded`);
    assert.equal(requests - before, 1, `${test.name}: no replay`);
    console.log(`PASS: ${test.name}`);
  }
  assert.equal(toolCalls, 0);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((done) => child.once('exit', done));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited; clearTimeout(timer);
  }
  for (const socket of sockets) socket.destroy();
  gateway.closeAllConnections();
  await Promise.all([new Promise((done) => gateway.close(done)), new Promise((done) => bridge.close(done))]);
  await rm(work, { recursive: true, force: true });
}
