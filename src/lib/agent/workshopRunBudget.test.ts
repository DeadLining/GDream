import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWorkshopBreakdownRun,
  isWorkshopPromptRewriteRun,
  resolveWorkshopRunBudget,
} from './workshopRunBudget.ts';

test('prompt rewrite keeps its per-shot budget', () => {
  const budget = resolveWorkshopRunBudget({
    userInput: '请对当前工坊项目重写全部 videoPrompt 与 imagePrompt 提示词',
    defaultMaxTurns: 30,
    shotCount: 12,
  });

  assert.equal(budget.kind, 'prompt-rewrite');
  assert.equal(budget.maxTurns, 60);
});

test('breakdown repair gets a budget above the chat default and scales with workload', () => {
  const small = resolveWorkshopRunBudget({
    userInput: '请对当前工坊项目执行剧本拆解（第②步）：',
    defaultMaxTurns: 30,
    sceneCount: 10,
    beatCount: 4,
    shotCount: 0,
  });
  const large = resolveWorkshopRunBudget({
    userInput: '请对当前工坊项目执行剧本拆解（第②步）：',
    defaultMaxTurns: 30,
    sceneCount: 40,
    beatCount: 90,
    shotCount: 60,
  });

  assert.equal(small.kind, 'breakdown');
  assert.ok(small.maxTurns > 30);
  assert.ok(large.maxTurns >= small.maxTurns);
  assert.ok(large.maxTurns <= 512);
});

test('breakdown budget never drops below the configured default', () => {
  const budget = resolveWorkshopRunBudget({
    userInput: '请对当前工坊项目执行剧本拆解（第②步）：',
    defaultMaxTurns: 48,
    sceneCount: 1,
  });

  assert.equal(budget.kind, 'breakdown');
  assert.equal(budget.maxTurns, 48);
});

test('atomic resplit counts as a breakdown-class run', () => {
  assert.ok(isWorkshopBreakdownRun('请把当前工坊已有的过度细碎分镜，按“单镜详细时间轴”重新重排为更少但更完整的可生成镜头。'));
  assert.equal(isWorkshopPromptRewriteRun('请把当前工坊已有的过度细碎分镜，按“单镜详细时间轴”重新重排为更少但更完整的可生成镜头。'), false);
});

test('rejected-batch repair prompt gets the full breakdown budget, not the default', () => {
  // Regression: the “针对错误修复并重提” button emitted a repair prompt that
  // was not recognised as a breakdown run, so it silently fell back to the
  // 30-turn default and was killed with “调用步骤过多” before finishing.
  const viaButtonPhrase = resolveWorkshopRunBudget({
    userInput: '请修复一批未写入的 Atomic Shot（第②步拆解）。',
    defaultMaxTurns: 30,
    shotCount: 9,
    sceneCount: 10,
    beatCount: 28,
  });
  assert.equal(viaButtonPhrase.kind, 'breakdown');
  assert.ok(viaButtonPhrase.maxTurns > 30);

  // Path-only prompt (unknown workload) must still be classified as breakdown
  // so its budget can scale with the project, not silently use the chat default.
  const viaPersistedPath = resolveWorkshopRunBudget({
    userInput: '先读取该项目 breakdown/rejected-shots/ 中最近一份 JSON，再做最小字段修复。',
    defaultMaxTurns: 30,
    shotCount: 9,
  });
  assert.equal(viaPersistedPath.kind, 'breakdown');
  assert.ok(viaPersistedPath.maxTurns > 30);
});

test('plain chat keeps the configured default budget', () => {
  const budget = resolveWorkshopRunBudget({
    userInput: '帮我看看工坊里这个分镜为什么审核不通过',
    defaultMaxTurns: 30,
    shotCount: 12,
  });

  assert.equal(budget.kind, 'default');
  assert.equal(budget.maxTurns, 30);
});

 test('typed breakdown continuation budgets source windows and episodes, not only existing shots', () => {
  const budget = resolveWorkshopRunBudget({ userInput: '[工坊任务:breakdown]\n继续', defaultMaxTurns: 30, episodeScriptCount: 5, sourceChars: 30000 });
  assert.equal(budget.kind, 'breakdown');
  assert.ok(budget.maxTurns > 72);
});

test('the suggested legacy-shot reconciliation request does not get the 30-turn chat budget', () => {
  const request = '保留现有35条镜头。先核对它们与正文片段的对应关系，已完整覆盖的片段只补登记完成记录，不重写、不新增重复镜头；确实未覆盖的部分才继续拆解。不要仅因完成记录缺失就重新生成，也不要生成任何媒体。';
  const budget = resolveWorkshopRunBudget({ userInput: request, defaultMaxTurns: 30, shotCount: 35, episodeScriptCount: 5, sourceChars: 20000 });
  assert.equal(budget.kind, 'breakdown');
  assert.ok(budget.maxTurns > 30);
});

test('receipt-only authorization must not silently expand into a full decomposition task', () => {
  const budget = resolveWorkshopRunBudget({ userInput: '只补登记已有镜头与正文片段的完成记录，不新增镜头', defaultMaxTurns: 30 });
  assert.equal(budget.kind, 'default');
});
