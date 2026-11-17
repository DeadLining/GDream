import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  IMAGE_PROMPT_BUDGET,
  VIDEO_PROMPT_BUDGET,
  budgetLabel,
  planningModeLabel,
  videoBudgetText,
  videoPromptBudget,
} from './promptLengthBudget.ts';

/**
 * 这些用例锁的是**不变量**，不是「当前数值」。
 *
 * 数值本身允许调整，但要连带改 `scripts/pipeline-probe/storecheck.mjs` 的 A9/A10
 * （用真实 `tool.execute()` 验证告警确实在预算边界触发）——那才是「文案 == 阈值」的硬锁。
 * 这里保证：无论数值怎么调，模块自身的语义、排序关系与「消费方不再硬编码」不会退化。
 */

const readSource = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('每个预算区间都必须 min < max，且为有限正整数', () => {
  for (const [name, budget] of Object.entries({
    ...VIDEO_PROMPT_BUDGET,
    image: IMAGE_PROMPT_BUDGET,
  })) {
    assert.ok(Number.isInteger(budget.min) && budget.min > 0, `${name}.min 必须是正整数`);
    assert.ok(Number.isInteger(budget.max) && budget.max > 0, `${name}.max 必须是正整数`);
    assert.ok(budget.min < budget.max, `${name} 的 min 必须小于 max（当前 ${budget.min}/${budget.max}）`);
  }
});

test('single-timeline 的容量必须严格大于 atomic —— 否则区分两种模式没有意义', () => {
  const timeline = VIDEO_PROMPT_BUDGET['single-timeline'];
  const atomic = VIDEO_PROMPT_BUDGET.atomic;
  assert.ok(
    timeline.min > atomic.min && timeline.max > atomic.max,
    `single-timeline 应比 atomic 承载更多内容（timeline ${budgetLabel(timeline)} vs atomic ${budgetLabel(atomic)}）`,
  );
});

test('videoPromptBudget 按模式取值，未知模式回退到更保守的 atomic', () => {
  assert.deepEqual(videoPromptBudget('single-timeline'), VIDEO_PROMPT_BUDGET['single-timeline']);
  assert.deepEqual(videoPromptBudget('atomic'), VIDEO_PROMPT_BUDGET.atomic);
  // 未知/缺省必须回退到**更小**的区间，避免对未声明模式的镜头给出过宽的建议。
  assert.deepEqual(videoPromptBudget(undefined), VIDEO_PROMPT_BUDGET.atomic);
  assert.deepEqual(videoPromptBudget('something-else' as never), VIDEO_PROMPT_BUDGET.atomic);
});

test('budgetLabel 产出「min-max」，且与数值一致', () => {
  for (const budget of [...Object.values(VIDEO_PROMPT_BUDGET), IMAGE_PROMPT_BUDGET]) {
    assert.equal(budgetLabel(budget), `${budget.min}-${budget.max}`);
  }
});

test('planningModeLabel 覆盖两种模式，且不把未知模式说成 single-timeline', () => {
  assert.equal(planningModeLabel('single-timeline'), '单镜时间轴');
  assert.equal(planningModeLabel('atomic'), '原子镜头');
  assert.equal(planningModeLabel(undefined), '原子镜头');
});

test('videoBudgetText 同时给出两种模式的区间（工具说明面对两种模式，不能二选一）', () => {
  const text = videoBudgetText();
  assert.ok(text.includes(budgetLabel(VIDEO_PROMPT_BUDGET['single-timeline'])), '应包含 single-timeline 区间');
  assert.ok(text.includes(budgetLabel(VIDEO_PROMPT_BUDGET.atomic)), '应包含 atomic 区间');
});

test('回归锁：长度告警阈值必须从本模块派生，不得再硬编码三元表达式', () => {
  // F14 的另一面：曾经「提示词说 500-1200、代码在 1400 才报过长」，
  // 于是 1200-1400 既不满足契约也拿不到反馈（静默区）。
  // 根因是阈值写成了独立字面量。这里直接禁止那种写法回归。
  const tools = readSource('../agent/tools/workshopTools.ts');

  assert.doesNotMatch(
    tools,
    /len\s*[<>]\s*\(isTimelineShot\s*\?\s*\d+\s*:\s*\d+\)/,
    '长度告警不得再用 `(isTimelineShot ? N : M)` 形式硬编码，必须走 videoPromptBudget()',
  );
  assert.match(
    tools,
    /videoPromptBudget\(/,
    'workshopTools.ts 必须从 promptLengthBudget 取预算',
  );

  const prompts = readSource('./workshopPrompts.ts');
  assert.doesNotMatch(
    prompts,
    /建议\s*\d{3,4}-\d{3,4}\s*中文字/,
    '提示词不得再硬编码长度区间，必须走 budgetLabel()',
  );
  assert.match(prompts, /budgetLabel\(/, 'workshopPrompts.ts 必须从 promptLengthBudget 取区间文案');
});

test('回归锁：工具说明里的生图长度也必须走预算模块，不得硬编码', () => {
  // `workshop_set_prompts` 的工具说明曾写死「建议 80-220 中文字」，
  // 与 IMAGE_PROMPT_BUDGET 是同一组数字的第二份副本——正是本模块要消灭的漂移类型。
  const tools = readSource('../agent/tools/workshopTools.ts');
  assert.doesNotMatch(
    tools,
    /建议\s*\d{2,4}-\d{2,4}\s*中文字/,
    '工具说明不得硬编码长度区间，必须走 budgetLabel()',
  );
  assert.match(
    tools,
    /budgetLabel\(IMAGE_PROMPT_BUDGET\)/,
    '工具说明的生图预算必须从 IMAGE_PROMPT_BUDGET 派生',
  );
});
