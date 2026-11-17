import test from 'node:test';
import assert from 'node:assert/strict';
import { runDshText } from './textRun.ts';

function fixture(output = '完整结果', stopReason = 'end_turn') {
  let disposed = 0;
  let calls = 0;
  return {
    get disposed() { return disposed; }, get calls() { return calls; },
    create(onText: (text: string) => void) {
      return { start: async () => {}, prompt: async () => { calls++; onText(output); return { stopReason }; }, dispose: async () => { disposed++; } };
    },
  };
}
test('DSH text returns only completed output and disposes its own session', async () => {
  const f = fixture();
  assert.equal(await runDshText(f.create, 'input'), '完整结果');
  assert.equal(f.disposed, 1); assert.equal(f.calls, 1);
});
test('empty, truncated and cancelled results cannot be applied', async () => {
  for (const [text, reason] of [['', 'end_turn'], ['partial', 'max_tokens'], ['partial', 'cancelled']]) {
    const f = fixture(text, reason);
    await assert.rejects(runDshText(f.create, 'input'));
    assert.equal(f.disposed, 1); assert.equal(f.calls, 1);
  }
});
test('reasoning-only token exhaustion is not reported as a successful empty response', async () => {
  let calls = 0;
  let disposed = 0;
  await assert.rejects(runDshText((_onText, onThinking) => ({
    start: async () => {},
    prompt: async () => { calls++; onThinking(); return { stopReason: 'max_tokens' }; },
    dispose: async () => { disposed++; },
  }), 'input'), /token 上限.*仅返回思考过程.*原内容未修改/);
  assert.equal(calls, 1);
  assert.equal(disposed, 1);
});
test('reasoning never substitutes for a completed answer', async () => {
  await assert.rejects(runDshText((_onText, onThinking) => ({
    start: async () => {},
    prompt: async () => { onThinking(); return { stopReason: 'end_turn' }; },
    dispose: async () => {},
  }), 'input'), /仅返回思考过程，没有返回正文/);
});
test('deadline settles even if transport never settles, without retries', async () => {
  let disposed = 0;
  await assert.rejects(runDshText(() => ({ start: () => new Promise(() => {}), prompt: async () => ({}), dispose: async () => { disposed++; } }), 'input', { timeoutMs: 10 }), /总时限/);
  assert.equal(disposed, 1);
});
test('abort is prompt and late output is ignored', async () => {
  const controller = new AbortController(); let emit: (text: string) => void = () => {}; let updates = 0;
  const promise = runDshText((onText) => { emit = onText; return { start: async () => {}, prompt: () => new Promise(() => {}), dispose: async () => {} }; }, 'input', { signal: controller.signal, onProgress: () => { updates++; } });
  controller.abort(); await assert.rejects(promise, /取消/);
  const before = updates; emit('late'); assert.equal(updates, before);
});
test('already aborted runs do not start a process', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runDshText(() => { throw new Error('must not start'); }, 'input', { signal: controller.signal }), /取消/);
});

test('DSH auxiliary rewrites carry actual reference images in order on the same turn', async () => {
  const mediaBlocks = [
    { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data: 'first' } },
    { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data: 'second' } },
  ];
  let calls = 0;
  const result = await runDshText((onText) => ({
    start: async () => {},
    prompt: async (input, blocks) => {
      calls++;
      assert.equal(input, 'canonical facts and dialogue');
      assert.deepEqual(blocks, mediaBlocks);
      onText('bound prompt');
      return { stopReason: 'end_turn' };
    },
    dispose: async () => {},
  }), 'canonical facts and dialogue', { mediaBlocks });
  assert.equal(result, 'bound prompt');
  assert.equal(calls, 1);
});

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('ongoing thinking survives the old three-minute deadline and can finish normally', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let think = () => {}; let emit = (_s: string) => {}; let finish: (r: {stopReason: string}) => void = () => {};
  let calls = 0; let disposed = 0;
  const run = runDshText((onText, onThinking) => {
    think = onThinking; emit = onText;
    return { start: async () => {}, prompt: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
      dispose: async () => { disposed++; } };
  }, 'input');
  await flush();
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(60_000); think(); await flush(); }
  emit('完整结果'); finish({ stopReason: 'end_turn' });
  assert.equal(await run, '完整结果');
  assert.equal(calls, 1); assert.equal(disposed, 1);
});

test('idle timeout resets on every chunk even when progress label stays the same', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let emit = (_s: string) => {}; let disposed = 0;
  const run = runDshText(onText => {
    emit = onText;
    return { start: async () => {}, prompt: () => new Promise(() => {}), dispose: async () => { disposed++; } };
  }, 'input', { idleTimeoutMs: 100, timeoutMs: 1000 });
  const rejected = assert.rejects(run, /无响应超时.*正文/);
  await flush();
  t.mock.timers.tick(80); emit('first');
  t.mock.timers.tick(80); emit('second');
  t.mock.timers.tick(80); await flush(); assert.equal(disposed, 0);
  t.mock.timers.tick(21); await rejected; assert.equal(disposed, 1);
});

test('active thinking still respects a separate total deadline without retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let think = () => {}; let calls = 0;
  const run = runDshText((_onText, onThinking) => {
    think = onThinking;
    return { start: async () => {}, prompt: () => { calls++; return new Promise(() => {}); }, dispose: async () => {} };
  }, 'input', { idleTimeoutMs: 100, timeoutMs: 250 });
  const rejected = assert.rejects(run, /总时限.*思考/);
  await flush();
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(80); think(); }
  t.mock.timers.tick(11); await rejected; assert.equal(calls, 1);
});

test('stalled connection has a distinct diagnostic and cannot prompt after timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let connected = () => {}; let calls = 0;
  const run = runDshText(() => ({
    start: () => new Promise<void>(resolve => { connected = resolve; }),
    prompt: async () => { calls++; return { stopReason: 'end_turn' }; }, dispose: async () => {},
  }), 'input', { idleTimeoutMs: 100, timeoutMs: 1000 });
  const rejected = assert.rejects(run, /无响应超时.*连接/);
  t.mock.timers.tick(101); await rejected;
  connected(); await flush(); assert.equal(calls, 0);
});
