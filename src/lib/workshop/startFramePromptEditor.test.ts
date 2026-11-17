import test from 'node:test';
import assert from 'node:assert/strict';
import { editableStartFramePrompt, startFramePromptPatch } from './startFramePromptEditor.ts';
import { buildOptimizeShotPrompt } from './workshopPrompts.ts';

test('storyboard editor shows planned first frame and falls back to legacy image text', () => {
  assert.equal(editableStartFramePrompt({}), '');
  assert.equal(editableStartFramePrompt({ imagePrompt: '旧生图描述' }), '旧生图描述');
  assert.equal(editableStartFramePrompt({ imagePrompt: '旧', plannedStartFramePrompt: '新首帧' }), '新首帧');
  assert.equal(editableStartFramePrompt({ imagePrompt: '旧', plannedStartFramePrompt: '' }), '');
  assert.deepEqual(startFramePromptPatch('新场景'), { imagePrompt: '新场景', plannedStartFramePrompt: '新场景' });
  assert.deepEqual(startFramePromptPatch(''), { imagePrompt: '', plannedStartFramePrompt: '' });
});
test('row optimization rewrites all applicable prompts and fills missing first frame for scene changes', () => {
  const prompt = buildOptimizeShotPrompt('02-01', 'i2va');
  assert.match(prompt, /shot_no:"02-01"/);
  assert.match(prompt, /videoPrompt 必须重写/);
  assert.match(prompt, /首镜、跨集或换场景/);
  assert.match(prompt, /imagePrompt 与 startFramePrompt 必须同时重写/);
  assert.match(prompt, /完全相同的中文静态画面描述/);
  assert.match(prompt, /保留实际首帧，不重新生图/);
  assert.match(prompt, /endFramePrompt 必须重写或补齐/);
  assert.match(prompt, /不自动调用生图、视频或配音生成工具/);
});
