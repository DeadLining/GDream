import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { RepeatReadMemo } from './repeatReadGuard.ts';
import { WorkshopStatePager } from './workshopStatePaging.ts';
import { executeDshToolCall } from './dsh/toolRpc.ts';
import type { ToolRegistry } from './toolRegistry.ts';
import type { CoordinatorCallbacks, ToolResult } from './types.ts';

const callbacks: CoordinatorCallbacks = {
  onTextDelta() {}, onThinkingDelta() {}, onToolStart() {}, onToolEnd() {}, onComplete() {}, onError() {},
};

// Exercise the registry's guard -> tool -> record contract with real guard and
// pager, without importing the Tauri UI stores. DSH uses the real RPC adapter.
for (const route of ['direct', 'dsh'] as const) {
  test(`${route}: recovering already-read pages and expired snapshots still returns complete facts`, async () => {
    const memo = new RepeatReadMemo();
    const pager = new WorkshopStatePager();
    let source = { revision: 'r1' };
    const text = () => JSON.stringify({
      currentScriptRevision: { id: source.revision, content: '正式剧本台词。'.repeat(4500) },
      scriptReview: { revision: source.revision, status: 'passed' },
      narrativeBeats: [{ id: 'beat-1' }], shots: [],
    });
    let executions = 0;
    const registry = {
      get: () => ({ risk: 'safe' }),
      execute: async (name: string, params: Record<string, unknown>): Promise<ToolResult> => {
        const notice = memo.check(name, params, source.revision);
        if (notice) return { success: true, output: notice };
        executions++;
        try {
          const output = typeof params.output_id === 'string'
            ? pager.read(params.output_id, params.offset, source, 'project')
            : pager.start(text(), source, 'project');
          memo.record(name, params, true, source.revision);
          return { success: true, output };
        } catch (error) {
          memo.record(name, params, false, source.revision);
          return { success: false, output: '', error: String(error) };
        }
      },
    } as unknown as ToolRegistry;
    const call = (params: Record<string, unknown>) => route === 'direct'
      ? registry.execute('workshop_get_state', params)
      : executeDshToolCall({ runId: 'r', instanceId: 'i', requestId: String(executions), name: 'workshop_get_state', arguments: params }, registry, callbacks, new AbortController().signal);
    const open = { detail: 'step', section: 'breakdown' };
    const first = await call(open);
    const firstHeader = JSON.parse(first.output.split('\n')[0]);
    const second = await call(firstHeader.next_call);
    // Context was compacted here: reread the exact same first and second page.
    assert.deepEqual(await call(open), first);
    assert.deepEqual(await call(firstHeader.next_call), second);
    let result = first;
    let restored = '';
    for (let i = 0; i < 20; i++) {
      assert.equal(result.success, true);
      assert.doesNotMatch(result.output, /没有变化/);
      const [header, _instruction, ...body] = result.output.split('\n');
      restored += body.join('\n');
      const meta = JSON.parse(header);
      if (meta.complete) break;
      result = await call(meta.next_call);
    }
    assert.equal(restored, text());
    assert.equal(JSON.parse(restored).scriptReview.revision, 'r1');

    // Evict the old snapshot; reopening with IDENTICAL initial parameters must work.
    for (let i = 0; i < 8; i++) pager.start('other'.repeat(2000) + i, source, 'project');
    const expired = await call(firstHeader.next_call);
    assert.equal(expired.success, false);
    assert.match(expired.error!, /过期/);
    const fresh = await call(open);
    assert.equal(fresh.success, true);
    assert.notEqual(JSON.parse(fresh.output.split('\n')[0]).output_id, firstHeader.output_id);

    // A mutation cannot make a restored old page silently mix revisions.
    const freshHeader = JSON.parse(fresh.output.split('\n')[0]);
    source = { revision: 'r2' };
    const stale = await call(freshHeader.next_call);
    assert.equal(stale.success, false);
    assert.match(stale.error!, /数据已变化/);
    assert.match((await call(open)).output, /r2/);
  });
}

test('production registry checks before execution and records only the real result', () => {
  const source = readFileSync(new URL('./toolRegistry.ts', import.meta.url), 'utf8');
  const check = source.indexOf('this.repeatReads.check(name, params, snapshot)');
  const execute = source.indexOf('tool.execute(params, signal, context)');
  const record = source.indexOf('this.repeatReads.record(name, params, result.success');
  assert.ok(check >= 0 && execute > check && record > execute);
});


test('breakdown instructions explicitly allow page recovery and fresh reads after expiration', () => {
  const source = readFileSync(new URL('../workshop/workshopPrompts.ts', import.meta.url), 'utf8');
  assert.match(source, /允许按原 output_id\/offset 重读/);
  assert.match(source, /快照过期则重新获取同一区域/);
  assert.match(source, /不受“一次初读”限制/);
});
