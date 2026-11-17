import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBreakdownPrompt, buildAutoRunSteps, WORKSHOP_TOOL_DISCIPLINE } from './workshopPrompts.ts';

test('breakdown prompt carries the tool discipline on its own', () => {
  // 实测（2026-09-15）中这条路径不带纪律段时，模型会先花两轮用
  // project_get_paths / bash 去摸工程目录，再开始读剧本。纪律段必须随提示词下发，
  // 不能只拼在一键全流程的四步里。
  const prompt = buildBreakdownPrompt();
  assert.ok(prompt.includes(WORKSHOP_TOOL_DISCIPLINE), 'buildBreakdownPrompt 必须自带纪律段');
  assert.equal(
    prompt.split(WORKSHOP_TOOL_DISCIPLINE).length - 1,
    1,
    '纪律段只能出现一次',
  );
});

test('discipline sits at the tail, after the style section', () => {
  // 尾部指令服从度：风格段在前，纪律段必须留在最后。
  const prompt = buildBreakdownPrompt('\n## 风格关键词（所有提示词统一携带）\n赛博朋克');
  assert.match(prompt, /赛博朋克/);
  assert.ok(
    prompt.indexOf('赛博朋克') < prompt.indexOf(WORKSHOP_TOOL_DISCIPLINE),
    '风格段必须在纪律段之前',
  );
  assert.ok(prompt.trimEnd().endsWith(WORKSHOP_TOOL_DISCIPLINE.trimEnd()), '纪律段必须收尾');
});

test('breakdown prompt keeps its own body intact', () => {
  const prompt = buildBreakdownPrompt();
  assert.match(prompt, /执行剧本拆解（第②步）/);
  assert.match(prompt, /workshop_set_script_review/);
  assert.match(prompt, /workshop_set_breakdown/);
  assert.match(prompt, /workshop_set_bibles/);
  assert.match(prompt, /workshop_set_shots/);
  assert.match(prompt, /sourceEvidence/);
  assert.match(prompt, /3-12 条/);
});

test('breakdown prompt establishes world layers before framing and camera work', () => {
  const prompt = buildBreakdownPrompt();

  assert.match(prompt, /每镜必须先填写 spatialStaging/);
  assert.match(prompt, /layers:\[\{ subject, layer, support, relativeTo\? \}\], viewpoint, relation/);
  assert.match(prompt, /ground\/elevated\/aerial\/upper-architecture\/water-surface\/underwater\/other/);
  assert.match(prompt, /所在世界层、支撑条件、相对另一主体的上下位置/);
  assert.match(prompt, /镜头升降只是观众视点/);
  assert.match(prompt, /不得改变支撑面或让主体跨层/);
  assert.match(prompt, /落地、起飞、坠落、飞升、攀爬、跳下或从一处支撑面转移到另一处/);
});

test('breakdown no longer requests planning review or a repair loop', () => {
  const prompt = buildBreakdownPrompt();
  assert.doesNotMatch(prompt, /planningReview|这次复读是契约要求的质检/);
  assert.match(prompt, /不运行镜头质量验收/);
});

test('auto-run step 1 does not duplicate the discipline it now inherits', () => {
  const [breakdown] = buildAutoRunSteps();
  assert.equal(
    breakdown.prompt.split(WORKSHOP_TOOL_DISCIPLINE).length - 1,
    1,
    '第 1 步通过 buildBreakdownPrompt 继承纪律段，不能再自己拼一次',
  );
  assert.match(breakdown.prompt, /第 1\/4 步：剧本拆解/);
  assert.match(breakdown.prompt, /若项目没有剧本源文件/);
});
