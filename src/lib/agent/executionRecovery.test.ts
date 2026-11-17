import { breakdownWorkUnits } from '../workshop/breakdownQueue.ts';
import { buildBreakdownResumePrompt } from '../workshop/breakdownIntent.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionRecovery, resolveWorkshopExecutionTask } from './executionRecovery.ts';
import { emptyWorkshopData } from '../workshop/types.ts';
import { buildAtomicResplitPrompt, buildBreakdownPrompt } from '../workshop/workshopPrompts.ts';

function setup() {
  const data = emptyWorkshopData('project');
  data.currentStep = 'breakdown';
  data.episodes = [{ no: '1', title: '', sceneList: '' }, { no: '2', title: '', sceneList: '', script: '正式对白', scriptStatus: 'draft' }];
  data.shots = [{ shotNo: '01-01', description: '已有镜头', characterIds: [] }];
  const guard = new ExecutionRecovery({ kind: 'breakdown', projectId: data.projectId });
  return { data, guard };
}

test('real UI prefix and full action prompt resolve to a typed breakdown task', () => {
  const { data } = setup();
  const input = `[工坊上下文：项目「测试」，当前步骤 breakdown。按需先调用 workshop_get_state 读取必要状态；修改工坊请使用 workshop_* 工具并确保 UI 实时联动。]\n\n${buildBreakdownPrompt()}`;
  assert.deepEqual(resolveWorkshopExecutionTask(input, data), { kind: 'breakdown', projectId: 'project' });
  for (const request of ['继续', '把剩下的补齐', '按刚才顺序继续']) assert.ok(resolveWorkshopExecutionTask(request, data));
  for (const request of ['只核对状态', '继续第二步，先不要执行', '解释一下 Beat', '请修复一批未写入的 Atomic Shot']) assert.equal(resolveWorkshopExecutionTask(request, data), undefined);
  data.currentStep = 'generate';
  assert.equal(resolveWorkshopExecutionTask('继续', data), undefined);
});

test('completed project resolves the rebuild button as an explicit resplit task regardless of the open step', () => {
  const { data } = setup();
  data.currentStep = 'prompts';
  data.steps.breakdown.status = 'done';
  data.shots.push({ shotNo: '02-01', description: '第二集镜头', characterIds: [] });
  const prompt = buildAtomicResplitPrompt('', 90, 'short-film');
  assert.deepEqual(resolveWorkshopExecutionTask(prompt, data), { kind: 'breakdown-resplit', projectId: data.projectId });
  assert.match(prompt, /\[工坊任务:breakdown-resplit\]/);
});

test('resplit does not finish from the old done status and requires this round replace receipt', () => {
  const { data, guard } = setup();
  data.steps.breakdown.status = 'done';
  data.shots.push({ shotNo: '02-01', description: '第二集镜头', characterIds: [] });
  const resplitGuard = new ExecutionRecovery({ kind: 'breakdown-resplit', projectId: data.projectId });
  resplitGuard.observe('workshop_set_step_status', { step: 'breakdown', status: 'done' }, { success: true, output: '已保存' });
  const early = resplitGuard.decide({ data, text: '已重排' });
  assert.equal(early.kind, 'continue');
  if (early.kind === 'continue') assert.match(early.prompt, /旧.*done.*不能作为本轮结束依据|旧.*done/);
  resplitGuard.observe('workshop_set_shots', {
    mode: 'replace', confirmRebuild: true,
    shots: [{ shotNo: '01-01', description: '重排后的完整镜头' }, { shotNo: '02-01', description: '第二集镜头' }],
  }, { success: true, output: '已替换' });
  resplitGuard.observe('workshop_set_step_status', { step: 'breakdown', status: 'done' }, { success: true, output: '已保存' });
  assert.equal(resplitGuard.decide({ data, text: '' }).kind, 'complete');
  void guard;
});

test('zero tool calls and empty final both recover toward execution, not a final apology', () => {
  for (const text of ['', '本轮尚未调用工坊工具，后续需要继续']) {
    const { data, guard } = setup();
    const decision = guard.decide({ data, text });
    assert.equal(decision.kind, 'continue');
    if (decision.kind === 'continue') assert.match(decision.prompt, /第2集正文片段1/);
    assert.equal(guard.decide({ data, text }).kind, 'stop');
  }
});

test('unchanged reads do not grant new retries; actual saved content advances the checkpoint', () => {
  const { data, guard } = setup();
  guard.decide({ data, text: '准备写入' });
  guard.observe('workshop_get_state', { section: 'breakdown' }, { success: true, output: '{}' });
  assert.equal(guard.decide({ data, text: '又读了一遍' }).kind, 'stop');
  data.episodes[1].script = '保存的新版正文';
  assert.equal(guard.decide({ data, text: '正文已保存' }).kind, 'continue');
});

test('step done requires both saved shots and a successful completion receipt', () => {
  const { data, guard } = setup();
  data.shots.push({ shotNo: '02-01', description: '镜头', characterIds: [] });
  data.steps.breakdown.status = 'done';
  assert.equal(guard.decide({ data, text: '已完成' }).kind, 'continue');
  guard.observe('workshop_set_step_status', { step: 'breakdown', status: 'done' }, { success: true, output: '已保存' });
  const result = guard.decide({ data, text: '' });
  assert.equal(result.kind, 'complete');
});

test('consecutive empty counter resets after a valid tool result', () => {
  const guard = new ExecutionRecovery();
  assert.equal(guard.decide({ text: '' }).kind, 'continue');
  guard.observe('workshop_get_state', {}, { success: true, output: '{}' });
  assert.equal(guard.decide({ text: '' }).kind, 'continue');
  assert.equal(guard.decide({ text: '' }).kind, 'stop');
});

test('truncation aliases recover without classifying thinking-only output as a final answer', () => {
  for (const finishReason of ['length', 'max_tokens', 'max_output_tokens']) {
    const guard = new ExecutionRecovery();
    const decision = guard.decide({ text: '', finishReason });
    assert.equal(decision.kind, 'continue');
    if (decision.kind === 'continue') assert.match(decision.prompt, /长度限制截断/);
  }
});

test('pending upstream snapshot cursor survives when scoped screenplay is not ready', () => {
  const { guard, data } = setup();
  data.episodes[1].script = ''; 
  guard.observe('workshop_get_state', { section: 'breakdown' }, { success: true, output: '{"output_id":"ws-state-1","complete":false,"next_call":{"output_id":"ws-state-1","offset":8000}}\n正文' });
  assert.match(guard.checkpoint(data), /"offset":8000/);
  guard.observe('workshop_get_state', { output_id: 'ws-state-1', offset: 8000 }, { success: true, output: '{"output_id":"ws-state-1","complete":true,"next_call":null}\n末页' });
  assert.doesNotMatch(guard.checkpoint(data), /先沿原快照续页/);
});

test('paid dispatch, refusal, project switch, and cancellation never trigger unsafe continuation', () => {
  let { guard, data } = setup();
  guard.dispatched('workshop_generate');
  assert.equal(guard.decide({ data, text: '' }).kind, 'stop');
  ({ guard, data } = setup());
  guard.observe('write_file', {}, { success: false, output: '', error: '用户拒绝执行' });
  assert.equal(guard.decide({ data, text: '继续' }).kind, 'stop');
  ({ guard, data } = setup());
  assert.equal(guard.decide({ data: { ...data, projectId: 'other' }, text: '' }).kind, 'stop');
  ({ guard, data } = setup());
  guard.cancelTask();
  assert.equal(guard.decide({ data, text: '按新指令回答' }).kind, 'pass');
});

test('new guidance clears a refused task, but never forgets a paid dispatch', () => {
  const { guard, data } = setup();
  guard.observe('write_file', {}, { success: false, output: '', error: '用户拒绝执行' });
  guard.cancelTask();
  assert.equal(guard.decide({ data, text: '改为解释，不执行操作' }).kind, 'pass');
  guard.dispatched('workshop_generate');
  guard.cancelTask();
  assert.equal(guard.decide({ data, text: '' }).kind, 'stop');
});

test('an expired page does not keep instructing the model to reuse the same dead cursor', () => {
  const { guard, data } = setup();
  guard.observe('workshop_get_state', { section: 'breakdown' }, { success: true, output: '{"output_id":"ws-state-1","complete":false,"next_call":{"output_id":"ws-state-1","offset":8000}}\n正文' });
  guard.observe('workshop_get_state', { output_id: 'ws-state-1', offset: 8000 }, { success: false, output: '', error: '状态快照不存在或已过期' });
  assert.doesNotMatch(guard.checkpoint(data), /先沿原快照续页/);
});

test('failed shot payload survives history compaction and stale task ids receive current source', () => {
  const { guard, data } = setup();
  const payload = { mode: 'merge', workUnitId: 'stale', workUnitComplete: true, shots: [{ shotNo: '02-01', description: '保留完整内容' }] };
  guard.observe('workshop_set_shots', payload, { success: false, output: '', error: '正文已变化：更新 workUnitId' });
  payload.shots[0].description = 'caller mutation';
  const checkpoint = guard.checkpoint(data);
  assert.match(checkpoint, /保留完整内容/);
  assert.doesNotMatch(checkpoint, /caller mutation/);
  assert.match(checkpoint, /当前有效任务/);
  guard.observe('workshop_set_shots', {}, { success: true, output: '已保存' });
  assert.doesNotMatch(guard.checkpoint(data), /原始完整参数/);
});

test('more than eight genuine source-unit advances are not stopped by a global nudge count', () => {
  const { guard, data } = setup();
  for (let i = 0; i < 12; i++) {
    data.breakdownWork = { version: 1, receipts: { [`unit-${i}`]: { shotNos: [`02-${i}`], complete: false } } };
    assert.equal(guard.decide({ data, text: '本段已写，继续' }).kind, 'continue');
  }
  assert.equal(guard.decide({ data, text: '没有进展' }).kind, 'stop');
});

test('the exact user-facing 35-shot resume instruction activates the queue without a magic marker', () => {
  const { data } = setup();
  const request = '保留现有35条镜头。先核对它们与正文片段的对应关系，已完整覆盖的片段只补登记完成记录，不重写、不新增重复镜头；确实未覆盖的部分才继续拆解。不要仅因完成记录缺失就重新生成，也不要生成任何媒体。';
  assert.deepEqual(resolveWorkshopExecutionTask(request, data), { kind: 'breakdown', projectId: data.projectId });
  assert.deepEqual(resolveWorkshopExecutionTask(`[工坊上下文：项目「测试」，当前步骤 breakdown。]\n\n${request}`, data), { kind: 'breakdown', projectId: data.projectId });
  for (const inspection of ['只核对正文片段和镜头是否已登记完成，不修改', '为什么正文片段和镜头要登记完成？', '先不要执行，补登记正文片段的镜头记录怎么做']) {
    assert.equal(resolveWorkshopExecutionTask(inspection, data), undefined);
  }
  data.currentStep = 'prompts';
  assert.equal(resolveWorkshopExecutionTask(request, data), undefined);
});

test('scoped reconciliation pagination continues even when episode script is already available', () => {
  const { data, guard } = setup();
  guard.observe('workshop_get_state', { section: 'breakdown-work' }, { success: true, output: '{"output_id":"ws-state-scoped","complete":false,"next_call":{"output_id":"ws-state-scoped","offset":8000}}\npage' });
  assert.match(guard.checkpoint(data), /"offset":8000/);
  guard.observe('workshop_get_state', { output_id: 'ws-state-scoped', offset: 8000 }, { success: true, output: '{"output_id":"ws-state-scoped","complete":true}\nlast page' });
  assert.match(guard.checkpoint(data), /正文片段1/);
  assert.doesNotMatch(guard.checkpoint(data), /先沿原快照续页/);
});

test('dedicated reconciliation button explicitly starts the same breakdown queue', () => {
  const { data } = setup();
  const prompt = buildBreakdownResumePrompt();
  assert.deepEqual(resolveWorkshopExecutionTask(prompt, data), { kind: 'breakdown', projectId: data.projectId });
  assert.match(prompt, /不重写、不新增重复镜头/);
});

test('completion dialogue failure gets one targeted repair phase after an earlier no-write continuation', () => {
  const { data, guard } = setup();
  data.episodes[1].script = '朱元璋：“退车，先保人！”';
  data.shots.push({ shotNo: '02-01', episode: '2', description: '退车救人', characterIds: [] });
  const unit = breakdownWorkUnits(data).find((item) => item.episode === '2')!;
  assert.equal(guard.decide({ data, text: '先核对' }).kind, 'continue');
  const params = { workUnitId: unit.id, shotNos: ['02-01'] };
  guard.observe('workshop_complete_breakdown_unit', params, { success: false, output: '', error: '本段原文对白尚未登记，不能仅凭画面描述登记拆完' });
  const repair = guard.decide({ data, text: '尚未写入' });
  assert.equal(repair.kind, 'continue');
  if (repair.kind === 'continue') {
    assert.match(repair.prompt, /先修复漏对白/);
    assert.match(repair.prompt, /退车，先保人/);
    assert.match(repair.prompt, /workshop_restore_shot_dialogue/);
  }
  guard.observe('workshop_complete_breakdown_unit', params, { success: false, output: '', error: '本段原文对白尚未登记，再次失败' });
  assert.equal(guard.decide({ data, text: '仍未写入' }).kind, 'stop');
  data.shots[1].dialogue = '朱元璋：“退车，先保人！”';
  guard.observe('workshop_restore_shot_dialogue', { shotNo: '02-01' }, { success: true, output: '已保存' });
  assert.equal(guard.decide({ data, text: '继续' }).kind, 'continue');
  guard.observe('workshop_complete_breakdown_unit', params, { success: true, output: '完成' });
  assert.doesNotMatch(guard.checkpoint(data), /当前任务：先修复漏对白/);
});
