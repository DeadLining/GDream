import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  RepeatReadMemo,
  REPEAT_READ_SHORT_CIRCUIT,
  isWorkshopWriteTool,
  stableToolFingerprint,
} from './repeatReadGuard.ts';

test('first read goes through, identical repeat is short-circuited', () => {
  const memo = new RepeatReadMemo();
  assert.equal(memo.check('workshop_get_production_audit', {}), null, '首次读取必须放行');
  memo.record('workshop_get_production_audit', {}, true);
  assert.ok(memo.check('workshop_get_production_audit', {}), '第二次同参数读取必须被短路');
});

test('reads with different params are never collapsed together', () => {
  const memo = new RepeatReadMemo();
  memo.record('workshop_get_production_audit', { detail: 'summary' }, true);
  assert.equal(
    memo.check('workshop_get_production_audit', { detail: 'step' }),
    null,
    '换了参数就是另一次读取，必须放行',
  );
  assert.ok(memo.check('workshop_get_production_audit', { detail: 'summary' }));
});

test('key order does not create a false miss', () => {
  const memo = new RepeatReadMemo();
  memo.record('workshop_get_production_audit', { detail: 'step', section: 'prompts' }, true);
  assert.ok(
    memo.check('workshop_get_production_audit', { section: 'prompts', detail: 'step' }),
    '参数键序不同但语义相同，必须视为同一次读取',
  );
  assert.equal(
    stableToolFingerprint('t', { a: 1, b: 2 }),
    stableToolFingerprint('t', { b: 2, a: 1 }),
  );
});

test('any write clears the memo so a post-write re-read still works', () => {
  const memo = new RepeatReadMemo();
  memo.record('workshop_get_production_audit', {}, true);
  assert.ok(memo.check('workshop_get_production_audit', {}));
  memo.record('workshop_set_shots', { shots: [] }, true);
  assert.equal(
    memo.check('workshop_get_production_audit', {}),
    null,
    '写入之后状态已经变了，必须放行真实的重新读取',
  );
});

test('a failed read is not remembered, so the model can retry', () => {
  const memo = new RepeatReadMemo();
  memo.record('workshop_get_production_audit', {}, false);
  assert.equal(memo.check('workshop_get_production_audit', {}), null, '失败的读取不该被短路');
});

test('only memoed read tools are affected', () => {
  const memo = new RepeatReadMemo();
  memo.record('workshop_read_source', {}, true);
  assert.equal(memo.check('workshop_read_source', {}), null, '未登记的只读工具不受影响');
  memo.record('workshop_get_production_audit', {}, true);
  assert.ok(memo.check('workshop_get_production_audit', {}));
});

test('reset clears the run-scoped memo', () => {
  const memo = new RepeatReadMemo();
  memo.record('workshop_get_production_audit', {}, true);
  memo.reset();
  assert.equal(memo.check('workshop_get_production_audit', {}), null);
});

test('workshop write tools are recognised, reads are not', () => {
  for (const name of [
    'workshop_set_breakdown',
    'workshop_set_shots',
    'workshop_update_shot',
    'workshop_clear_shot_audio',
    'workshop_generate',
  ]) {
    assert.equal(isWorkshopWriteTool(name), true, `${name} 应被识别为写入`);
  }
  for (const name of [
    'workshop_get_state',
    'workshop_get_shot_refs',
    'workshop_get_production_audit',
    'workshop_read_source',
    'read_file',
  ]) {
    assert.equal(isWorkshopWriteTool(name), false, `${name} 不应被识别为写入`);
  }
});

test('回归锁：判定口径与 workshopWriteGuard 同源，不得再自己维护一条正则', () => {
  // 曾经本模块用 /^workshop_(set|update|clear|generate|remove|delete)(_|$)/
  // 自判写入，漏掉了 8 个真实写入工具，导致「accept 候选视频 / upsert 资产 /
  // 恢复故事板结果 / 刷新界面」之后的复读被错误短路成「没有变化」。
  const missed = [
    'workshop_upsert_assets',
    'workshop_accept_video_candidate',
    'workshop_accept_audio_candidate',
    'workshop_add_candidate',
    'workshop_recover_storyboard_results',
    'workshop_mark_exported',
    'workshop_render_export',
    'workshop_refresh_ui',
  ];
  for (const name of missed) {
    assert.equal(isWorkshopWriteTool(name), true, `${name} 会改工坊数据，必须清空读记忆`);
  }
});

test('漏判过的写入工具会让此前的读取记忆失效', () => {
  const memo = new RepeatReadMemo();
  memo.record('workshop_get_production_audit', {}, true);
  assert.ok(memo.check('workshop_get_production_audit', {}), '写入前重复读应被短路');
  for (const name of ['workshop_upsert_assets', 'workshop_accept_video_candidate']) {
    memo.record(name, { ok: true }, true);
    assert.equal(
      memo.check('workshop_get_production_audit', {}),
      null,
      `${name} 之后状态已变，必须放行真实读取`,
    );
    memo.record('workshop_get_production_audit', {}, true);
  }
});

test('every short-circuit notice tells the model what to do instead', () => {
  for (const [name, notice] of Object.entries(REPEAT_READ_SHORT_CIRCUIT)) {
    assert.ok(notice.trim(), `${name} 的替代输出不能为空`);
    assert.match(notice, /没有变化/, `${name} 必须说明状态没有变化`);
  }
});

test('回归锁：状态快照变了，此前的读取记忆必须失效（UI 改动不走工具层）', () => {
  // 工具层之外的写入（用户在 StepAssets/StepGenerate 直接改提示词、reload 磁盘）
  // 不会经过 ToolRegistry，因此不能只靠「有没有工坊工具写入」来判断记忆是否过期。
  // 记忆必须绑定到它被记录时的那份工坊数据快照。
  const memo = new RepeatReadMemo();
  memo.record('workshop_get_production_audit', {}, true, 'snapshot-A');
  assert.ok(memo.check('workshop_get_production_audit', {}, 'snapshot-A'), '同一份快照内重复读应被短路');
  assert.equal(
    memo.check('workshop_get_production_audit', {}, 'snapshot-B'),
    null,
    '快照已变（外部写入），必须放行真实读取，不能再说「没有变化」',
  );
  // 失效之后应在新的快照上重新建立记忆。
  memo.record('workshop_get_production_audit', {}, true, 'snapshot-B');
  assert.ok(memo.check('workshop_get_production_audit', {}, 'snapshot-B'));
  assert.equal(memo.check('workshop_get_production_audit', {}, 'snapshot-C'), null);
});

test('回归锁：未提供快照时退回「只按 run 作用域」的旧行为', () => {
  const memo = new RepeatReadMemo();
  memo.record('workshop_get_production_audit', {}, true);
  assert.ok(memo.check('workshop_get_production_audit', {}), '不传快照时不受快照失效影响');
});

test('回归锁：coordinator 必须在每次 run 开始时清空读记忆', () => {
  // registry 在引擎初始化时创建一次并被所有 coordinator/会话共享，
  // 若不按 run 重置，「上一个任务读过了」会让下一个任务的第一次读取
  // 直接拿到「没有变化」，各步的前置校验因此失去依据。
  const coordinator = readSource('./dsh/DshBridge.ts');
  assert.match(
    coordinator,
    /resetRepeatReads\(\)/,
    'DshBridge.run() 必须重置注册表上的读记忆',
  );
});

const readSource = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');


test('state reads never replace data with a no-change success, including recovery of the same page', () => {
  const memo = new RepeatReadMemo();
  assert.equal(REPEAT_READ_SHORT_CIRCUIT.workshop_get_state, undefined);
  for (const params of [
    {}, { detail: 'summary' }, { detail: 'step', section: 'breakdown' },
    { output_id: 'ws-state-old', offset: 0 },
    { output_id: 'ws-state-old', offset: 8000 },
  ]) {
    for (let retry = 0; retry < 4; retry++) {
      assert.equal(memo.check('workshop_get_state', params, 'unchanged'), null);
      memo.record('workshop_get_state', params, true, 'unchanged');
    }
  }
});
