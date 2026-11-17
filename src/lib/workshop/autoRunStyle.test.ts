import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssetPromptsPrompt,
  buildAutoRunSteps,
  buildBreakdownPrompt,
  buildShotPromptsPrompt,
} from './workshopPrompts.ts';

const STYLE = '## 风格关键词\n电影感写实，柔和布光，胶片质感';

/**
 * 回归：风格设置必须真正进入「会写提示词」的每一步。
 *
 * 事故背景：`buildAutoRunSteps` 的第 4 步（分镜提示词）漏传了 styleSection，
 * 导致用户在一键全流程里设了风格却完全没生效——手动重写分镜时却正常，
 * 因此极难从 UI 察觉。此后任何新增提示词步骤都必须显式带上 styleSection。
 */
test('一键全流程的每个提示词步骤都注入风格', () => {
  const steps = buildAutoRunSteps(STYLE, { videoPromptTemplate: 'universal' });
  const byLabel = new Map(steps.map((s) => [s.label, s.prompt]));

  const promptsStep = [...byLabel.entries()].find(([label]) => label.includes('分镜提示词'));
  assert.ok(promptsStep, '应存在「分镜提示词」步骤');
  assert.ok(
    promptsStep[1].includes('电影感写实'),
    '分镜提示词步骤必须注入风格，否则一键全流程会静默丢失风格',
  );

  const breakdownStep = [...byLabel.entries()].find(([label]) => label.includes('拆解'));
  assert.ok(breakdownStep?.[1].includes('电影感写实'), '拆解步骤必须注入风格');

  const assetsStep = [...byLabel.entries()].find(([label]) => label.includes('资产'));
  assert.ok(assetsStep?.[1].includes('电影感写实'), '资产步骤必须注入风格');
});

test('手动路径：拆解 / 资产 / 分镜提示词都注入风格', () => {
  assert.ok(buildBreakdownPrompt(STYLE).includes('电影感写实'));
  assert.ok(buildAssetPromptsPrompt(STYLE).includes('电影感写实'));
  assert.ok(buildShotPromptsPrompt(STYLE, 'legacy').includes('电影感写实'));
  assert.ok(buildShotPromptsPrompt(STYLE, 'universal').includes('电影感写实'));
});

test('H3 任务分支同样注入风格', () => {
  const h3 = buildShotPromptsPrompt(STYLE, 'universal', 'fl2va');
  assert.ok(h3.includes('电影感写实'), 'H3 fl2va 分支必须注入风格');
});

test('未设置风格时不产生空风格段落残留', () => {
  const steps = buildAutoRunSteps('', { videoPromptTemplate: 'universal' });
  for (const s of steps) {
    assert.doesNotMatch(s.prompt, /undefined|null/, `${s.label} 不应出现占位符残留`);
  }
});
