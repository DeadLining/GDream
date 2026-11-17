import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutoRunPrompt, buildAutoRunSteps, buildShotPromptsPrompt, shotPromptTemplateRule, WORKSHOP_TOOL_DISCIPLINE } from './workshopPrompts.ts';

test('auto-run dispatches the pipeline one stage at a time', () => {
  const steps = buildAutoRunSteps();
  assert.deepEqual(
    steps.map((step) => step.id),
    ['breakdown', 'assets', 'prompts', 'generate'],
  );
  for (const [index, step] of steps.entries()) {
    assert.ok(step.label.trim(), `${step.id} needs a queue label`);
    assert.match(step.prompt, new RegExp(`第 ${index + 1}/4 步`));
    assert.ok(step.prompt.includes(WORKSHOP_TOOL_DISCIPLINE), `${step.id} must carry the tool discipline`);
  }
});

test('every auto-run step refuses to run when the previous stage never landed', () => {
  const [breakdown, assets, prompts, generate] = buildAutoRunSteps();
  assert.match(breakdown.prompt, /若项目没有剧本源文件/);
  assert.match(assets.prompt, /characters 与 scenes 都为空/);
  assert.match(prompts.prompt, /若 shots 为空/);
  assert.match(generate.prompt, /若 shots 为空或提示词为空/);
});

test('auto-run steps ban exploratory tools instead of letting the model wander', () => {
  for (const step of buildAutoRunSteps()) {
    assert.match(step.prompt, /禁止用 bash、project_get_paths/);
    assert.match(step.prompt, /只在对话里输出文本等于没做/);
  }
});

test('tool discipline still allows reading the script source it explicitly asks for', () => {
  // workshop_read_source 只返回绝对路径，正文必须用 read_file 读。
  // 若纪律段把 read_file 一并禁掉，第②步会在「读不到剧本」上死循环。
  const [breakdown] = buildAutoRunSteps();
  assert.doesNotMatch(WORKSHOP_TOOL_DISCIPLINE, /grep_search、list_directory、read_file、write_file/);
  assert.match(WORKSHOP_TOOL_DISCIPLINE, /拿到路径后用 read_file 读正文/);
  assert.match(WORKSHOP_TOOL_DISCIPLINE, /每个源文件只读一次/);
  assert.match(breakdown.prompt, /拿到路径后用 read_file 读正文/);
});

test('auto-run steps stay self-contained and keep the shared contracts', () => {
  const styleSection = '\n## 风格关键词（所有提示词统一携带）\n赛博朋克';
  const [breakdown, assets, prompts, generate] = buildAutoRunSteps(styleSection);
  assert.match(breakdown.prompt, /赛博朋克/);
  assert.match(assets.prompt, /赛博朋克/);
  assert.match(prompts.prompt, /触发→发酵→释放/);
  assert.match(prompts.prompt, /integrated_multimodal_description/);
  assert.match(generate.prompt, /workshop_generate/);
});

test('asset and prompt steps never trigger paid generation on their own', () => {
  const [breakdown, assets, prompts] = buildAutoRunSteps();
  assert.match(assets.prompt, /本步不要调用 workshop_generate/);
  assert.match(prompts.prompt, /本步不要调用 workshop_generate/);
  assert.match(breakdown.prompt, /不要生成任何图片或视频/);
});

test('legacy single-turn auto-run prompt stays available for scripted baselines', () => {
  const prompt = buildAutoRunPrompt();
  assert.match(prompt, /第②步 拆解/);
  assert.match(prompt, /第⑤步 生成/);
});

test('the prompts step always carries a concrete template rule, never a vague pointer', () => {
  // 「非 H3 视频提示词继续遵循当前模板」对模型没有信息量，必须把规则本身带下去。
  const [, , prompts] = buildAutoRunSteps();
  assert.match(prompts.prompt, /当前项目选择【经典版】/);
  assert.doesNotMatch(prompts.prompt, /当前项目选择【新版】/);
});

test('choosing the universal template swaps the rule in the prompts step', () => {
  const [, , prompts] = buildAutoRunSteps('', { videoPromptTemplate: 'universal' });
  assert.match(prompts.prompt, /当前项目选择【新版】/);
  assert.match(prompts.prompt, /【素材身份】/);
  assert.match(prompts.prompt, /【时间戳动作与机位】/);
  assert.doesNotMatch(prompts.prompt, /当前项目选择【经典版】/);
});

test('the H3 task rule only appears when a project actually has H3 shots', () => {
  const [, , withoutH3] = buildAutoRunSteps();
  assert.doesNotMatch(withoutH3.prompt, /当前 H3 任务/);
  assert.doesNotMatch(withoutH3.prompt, /## Complete Base Mode Guide/);

  const [, , withH3] = buildAutoRunSteps('', { h3Task: 'ref2va' });
  assert.match(withH3.prompt, /当前 H3 任务：ref2va/);
  assert.match(withH3.prompt, /subject_definitions/);
  assert.match(withH3.prompt, /# H3 Prompt Writing/);
  assert.match(withH3.prompt, /## Full-Reference Mode/);
  assert.match(withH3.prompt, /Complete Reference Mode Guide/);
});

test('the template rule has a single source of truth', () => {
  // buildShotPromptsPrompt 与一键全流程必须说同一句话，不能各写一份而漂移。
  for (const template of ['legacy', 'universal'] as const) {
    const rule = shotPromptTemplateRule(template);
    assert.ok(buildShotPromptsPrompt('', template).includes(rule), `${template} 规则应被第④步采用`);
    const [, , prompts] = buildAutoRunSteps('', { videoPromptTemplate: template });
    assert.ok(prompts.prompt.includes(rule), `${template} 规则应被一键全流程采用`);
  }
});
