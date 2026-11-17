import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';

// Opt-in live Gateway test. Rust production builder exports the configuration;
// no application state is written, and the only tool is a harmless echo.
const root = resolve(import.meta.dirname, '..');
const node = join(root, 'node', 'bin', 'node');
const bin = join(root, 'node_modules', '@deepseek-ai', 'dsh-acp-demo', 'lib', 'bin.js');
const apiKey = process.env.GDREAM_DSH_LLM_API_KEY?.trim();
if (!apiKey) throw new Error('GDREAM_DSH_LLM_API_KEY is required');

const model = process.env.GDREAM_SMOKE_MODEL || 'deepseek-v4.1-flash';
const baseURL = (process.env.GDREAM_SMOKE_BASE_URL || 'http://127.0.0.1:4317/openai/v1').replace(/\/$/, '');

const inputImage = process.env.GDREAM_SMOKE_IMAGE ? await readFile(process.env.GDREAM_SMOKE_IMAGE) : undefined;
const toolImage = process.env.GDREAM_SMOKE_TOOL_IMAGE ? await readFile(process.env.GDREAM_SMOKE_TOOL_IMAGE) : undefined;
const imageContent = (bytes) => ({ type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' });

// ---- fake GDream tool bridge ----
const calls = [];
const sockets = new Set();
const bridge = net.createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.setEncoding('utf8');
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.type === 'hello') {
        socket.write(`${JSON.stringify({ type: 'hello_ok' })}\n`);
        continue;
      }
      if (message.type === 'list_tools') {
        socket.write(`${JSON.stringify({
          type: 'list_tools',
          requestId: message.requestId,
          ok: true,
          result: [{
            name: 'probe_echo',
            description: 'Echo the provided text back.',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          }],
        })}\n`);
        continue;
      }
      if (message.type === 'call_tool') {
        calls.push({ name: message.name, arguments: message.arguments });
        socket.write(`${JSON.stringify({
          type: 'call_tool',
          requestId: message.requestId,
          ok: true,
          result: { content: [{ type: 'text', text: `ECHO:${message.arguments?.text ?? ''}` }, ...(toolImage ? [imageContent(toolImage)] : [])] },
        })}\n`);
      }
    }
  });
});
await new Promise((resolveListen) => bridge.listen(0, '127.0.0.1', resolveListen));
const bridgePort = bridge.address().port;

const work = await mkdtemp(join(tmpdir(), 'gdream-gateway-smoke-'));
const configPath = join(work, 'cordis.json');
await mkdir(join(work, 'home'));
// The test exporter receives no real key. Only the runtime process receives it.
const exportEnv = { ...process.env, GDREAM_SMOKE_WORK: work,
  GDREAM_SMOKE_BASE_URL: baseURL, GDREAM_SMOKE_MODEL: model,
  GDREAM_SMOKE_BRIDGE: `127.0.0.1:${bridgePort}` };
delete exportEnv.GDREAM_DSH_LLM_API_KEY;
try {
  await new Promise((resolveExport, rejectExport) => {
    const exporter = process.env.GDREAM_SMOKE_EXPORTER
      ? spawn(process.env.GDREAM_SMOKE_EXPORTER, ['dsh::tests::export_gateway_smoke_config', '--ignored', '--exact'], { env: exportEnv, stdio: 'ignore' })
      : spawn('cargo', ['test', '--manifest-path', join(root, '../src-tauri/Cargo.toml'),
        'dsh::tests::export_gateway_smoke_config', '--', '--ignored', '--exact'], { env: exportEnv, stdio: 'ignore' });
    const timer = setTimeout(() => { exporter.kill('SIGTERM'); rejectExport(new Error('Rust export timed out')); }, 180_000);
    exporter.on('error', (error) => { clearTimeout(timer); rejectExport(error); });
    exporter.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolveExport() : rejectExport(new Error(`Rust config export failed (${code})`)); });
  });
} catch (error) {
  bridge.close();
  await rm(work, { recursive: true, force: true });
  throw error;
}

const child = spawn(node, [bin, '--config', configPath], {
  cwd: work,
  env: {
    HOME: join(work, 'home'),
    DSH_HOME: join(work, 'dsh-home'),
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    GDREAM_DSH_LLM_API_KEY: apiKey,
    GDREAM_SMOKE_BASE_URL: baseURL,
    DSH_TELEMETRY_MODE: 'DISABLED',
    NODE_USE_ENV_PROXY: '1',
    ...(process.env.HTTP_PROXY ? { HTTP_PROXY: process.env.HTTP_PROXY } : {}),
    ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = '';
let stderr = '';
let stderrBuffer = '';
let reply = '';
const observerPrefix = '__GDREAM_DSH_EVENT__';
let nextId = 1;
const pending = new Map();
const observerEvents = [];

const redact = (text) => text.replaceAll(apiKey, '[REDACTED]');

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  const text = chunk;
  stderr = `${stderr}${text}`.slice(-20000);
  stderrBuffer += text;
  while (stderrBuffer.includes('\n')) {
    const newline = stderrBuffer.indexOf('\n');
    const line = stderrBuffer.slice(0, newline);
    stderrBuffer = stderrBuffer.slice(newline + 1);
    if (line.startsWith(observerPrefix)) observerEvents.push(JSON.parse(line.slice(observerPrefix.length)));
  }
});

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const newline = buffer.indexOf('\n');
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === 'session/update' && message.params?.update?.sessionUpdate === 'agent_message_chunk') reply += message.params.update.content?.text || '';
    if (typeof message.id !== 'number' || message.method) continue;
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message || 'ACP request failed'));
    else waiter.resolve(message.result);
  }
});

child.on('exit', (code, signal) => {
  for (const waiter of pending.values()) waiter.reject(new Error(`ACP exited (${code ?? signal})`));
  pending.clear();
});

function request(method, params, timeoutMs = 90_000) {
  const id = nextId++;
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectPromise(new Error(`ACP timeout: ${method}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
      reject: (error) => { clearTimeout(timer); rejectPromise(error); },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

const promptText = process.env.SMOKE_PROMPT
  || 'Call the probe_echo tool with text "hello", then reply with exactly the tool result.';

try {
  const initialized = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'gdream-host-smoke', version: '1.0.0' },
  });
  // Give the composition a moment: if anything unwinds asynchronously after
  // initialize, session/new is where it surfaces.
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
  const session = await request('session/new', { cwd: work, mcpServers: [] });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  const prompt = await request('session/prompt', {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: promptText }, ...(inputImage ? [imageContent(inputImage)] : [])],
  });
  assert.equal(prompt?.stopReason, 'end_turn');
  for (const expected of (process.env.GDREAM_SMOKE_EXPECT || '').split(',').filter(Boolean)) assert.ok(reply.includes(expected), `image evidence missing from model response: ${reply}`);
  assert.ok(calls.some((call) => call.name === 'probe_echo' && call.arguments?.text === 'hello'), 'real echo dispatch');
  assert.ok(reply.includes('ECHO:hello'), 'tool result returned to model');
  assert.ok(observerEvents.some((event) => event.sessionUpdate === 'tool_call'), 'tool observer');
  assert.ok(observerEvents.some((event) => event.sessionUpdate === 'usage_update'), 'usage observer');
  process.stdout.write(`${JSON.stringify({
    ok: true, configSource: 'Rust build_dsh_config', model, nativeInput: Boolean(inputImage), nativeToolImage: Boolean(toolImage), reply, toolCalls: calls.length,
    agent: initialized?.agentInfo?.name,
    session: Boolean(session?.sessionId),
    stopReason: prompt?.stopReason,
    observerEventCount: observerEvents.length,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: redact(error instanceof Error ? error.message : String(error)),
    diagnostics: redact(stderr).slice(-6000),
  })}\n`);
  process.exitCode = 1;
} finally {
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.kill('SIGTERM');
  const killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
  if (child.exitCode === null && child.signalCode === null) await exited;
  clearTimeout(killTimer);
  for (const socket of sockets) socket.destroy();
  bridge.close();
  await rm(work, { recursive: true, force: true });
}
