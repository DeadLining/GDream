import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKSHOP_READ_ONLY_TOOLS,
  WorkshopWriteGuard,
  duplicateWriteNotice,
  isWorkshopMutationTool,
  stableToolParams,
} from './workshopWriteGuard.ts';

/**
 * 这些用例锁定的是 2026-09-16 端到端实测（Run H）暴露的缺陷 F15：
 * 模型被工坊门禁拒绝后照门禁给的修法改正了前置状态，再重提同一载荷，
 * 却被重复写入刹车终止整个任务。三条不变式见 workshopWriteGuard.ts 的模块注释。
 */

/** 一轮 = 登记 → 判定 → 按结果登记。与 coordinator 的调用顺序一致。 */
function round(
  guard: WorkshopWriteGuard,
  name: string,
  params: Record<string, unknown>,
  success: boolean,
): boolean {
  guard.record(name, params);
  const duplicate = guard.isDuplicate(name, params);
  guard.noteResult(name, success);
  return duplicate;
}

const PAYLOAD = { items: [{ shotNo: 'S1-01', videoPrompt: '雨夜便利店的提示词' }] };
const REFS = { shot_no: 'S1-01', add_character_ids: ['char-suwan'] };

test('只读工坊工具重复调用永不刹车（不变式 3）', () => {
  const guard = new WorkshopWriteGuard();
  for (const name of WORKSHOP_READ_ONLY_TOOLS) {
    assert.equal(round(guard, name, {}, true), false, `${name} 不应触发刹车`);
    assert.equal(round(guard, name, {}, true), false, `${name} 第二次也不应触发刹车`);
  }
  // 只读工具甚至不应进入计数表：换一个只读工具后仍是干净状态。
  assert.equal(round(guard, 'workshop_get_state', { detail: 'step' }, true), false);
});

test('非工坊工具与只读集合外的判定', () => {
  assert.equal(isWorkshopMutationTool('workshop_set_prompts'), true);
  assert.equal(isWorkshopMutationTool('workshop_update_shot_refs'), true);
  assert.equal(isWorkshopMutationTool('workshop_get_state'), false);
  assert.equal(isWorkshopMutationTool('read_file'), false);
  assert.equal(isWorkshopMutationTool('bash'), false);
  assert.match(duplicateWriteNotice('workshop_set_prompts'), /重复调用/);
});

test('状态未变时重复提交同一载荷 → 刹车', () => {
  const guard = new WorkshopWriteGuard();
  assert.equal(round(guard, 'workshop_set_prompts', PAYLOAD, false), false, '第一次不应刹车');
  assert.equal(round(guard, 'workshop_set_prompts', PAYLOAD, false), true, '第二次应刹车');
});

test('同一批次内的两条相同调用 → 刹车（不变式 1）', () => {
  const guard = new WorkshopWriteGuard();
  // 两条调用都在执行前登记，尚未有成功写入推进世代。
  guard.record('workshop_set_prompts', PAYLOAD);
  guard.record('workshop_set_prompts', PAYLOAD);
  assert.equal(guard.isDuplicate('workshop_set_prompts', PAYLOAD), true);
});

test('F15 核心：期间有一次成功的工坊写入后，同一载荷不再算重复', () => {
  const guard = new WorkshopWriteGuard();

  // 第 1 轮：门禁拒绝（失败不推进世代）
  assert.equal(round(guard, 'workshop_set_prompts', PAYLOAD, false), false);
  // 第 2 轮：什么都不改就重提 —— 仍应刹车
  assert.equal(round(guard, 'workshop_set_prompts', PAYLOAD, false), true);

  // 门禁指定的修法：补角色关联，成功
  assert.equal(round(guard, 'workshop_update_shot_refs', REFS, true), false);

  // 第 3 轮：同一载荷 —— 状态已变，不得再判为重复
  assert.equal(
    round(guard, 'workshop_set_prompts', PAYLOAD, true),
    false,
    '补关联成功后重提同一载荷必须放行',
  );
});

test('只有成功的工坊写入才推进世代；失败的相邻写入不清空计数', () => {
  const guard = new WorkshopWriteGuard();
  round(guard, 'workshop_set_prompts', PAYLOAD, false);
  // 相邻写入失败 —— 状态并未改变，因此重提仍应刹车
  assert.equal(round(guard, 'workshop_update_shot_refs', REFS, false), false);
  assert.equal(round(guard, 'workshop_set_prompts', PAYLOAD, false), true);
});

test('成功写入后，另一工具的重复计数同样被清空', () => {
  const guard = new WorkshopWriteGuard();
  round(guard, 'workshop_set_shots', { shots: [{ shotNo: 'S1-01' }] }, false);
  assert.equal(round(guard, 'workshop_set_shots', { shots: [{ shotNo: 'S1-01' }] }, false), true);
  // 另一次成功的写入推进世代 → 前面那次的计数作废
  round(guard, 'workshop_set_prompts', PAYLOAD, true);
  assert.equal(round(guard, 'workshop_set_shots', { shots: [{ shotNo: 'S1-01' }] }, false), false);
});

test('参数指纹键序无关，且对嵌套对象/数组同样成立', () => {
  const a = { items: [{ shotNo: 'S1-01', actionTimeline: { segments: [{ start: 0, end: 5 }], summary: 's' } }] };
  const b = { items: [{ actionTimeline: { summary: 's', segments: [{ end: 5, start: 0 }] }, shotNo: 'S1-01' }] };
  assert.equal(stableToolParams(a), stableToolParams(b));

  const guard = new WorkshopWriteGuard();
  guard.record('workshop_set_prompts', a);
  guard.record('workshop_set_prompts', b);
  assert.equal(guard.isDuplicate('workshop_set_prompts', b), true, '键序不同不应逃过刹车');
  assert.equal(guard.isDuplicate('workshop_set_prompts', a), true, '反向查同样命中');
});

test('参数内容不同则不互相干扰', () => {
  const guard = new WorkshopWriteGuard();
  round(guard, 'workshop_set_prompts', PAYLOAD, false);
  assert.equal(
    round(guard, 'workshop_set_prompts', { items: [{ shotNo: 'S1-02', videoPrompt: '另一镜' }] }, false),
    false,
  );
});

test('reset 清空计数与世代', () => {
  const guard = new WorkshopWriteGuard();
  round(guard, 'workshop_set_prompts', PAYLOAD, false);
  guard.reset();
  assert.equal(round(guard, 'workshop_set_prompts', PAYLOAD, false), false);
});
