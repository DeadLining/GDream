import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendQualityLearningGuidance,
  emptyQualityLearning,
  removeQualityLearningRule,
  removeQualityPromptExample,
  updateQualityLearning,
} from './qualityLearning.ts';
import type { QualityReviewReport } from './qualityReview.ts';

function report(overrides: Partial<QualityReviewReport> = {}): QualityReviewReport {
  return {
    kind: 'boundary-frames',
    passed: false,
    score: 60,
    summary: '未通过',
    issues: [{ code: 'character-scale', severity: 'error', message: '人物尺度跳变' }],
    reviewedAt: 10,
    model: 'qwen3.8-27b',
    attempt: 1,
    ...overrides,
  };
}

test('accumulates recurring issue rules without duplicating categories', () => {
  const first = updateQualityLearning({ report: report(), prompt: '提示词', shotNo: '01' });
  const second = updateQualityLearning({ current: first, report: report({ reviewedAt: 20 }), prompt: '提示词', shotNo: '02' });
  assert.equal(second.avoidanceRules.length, 1);
  assert.equal(second.avoidanceRules[0].code, 'character-scale');
  assert.equal(second.avoidanceRules[0].occurrences, 2);
  assert.match(second.avoidanceRules[0].rule, /人物尺度/);
});

test('stores and deduplicates high score prompts only after passing review', () => {
  const passed = report({ passed: true, score: 96, issues: [], reviewedAt: 30 });
  const first = updateQualityLearning({ report: passed, prompt: '高分完整提示词', shotNo: '01' });
  const second = updateQualityLearning({ current: first, report: { ...passed, reviewedAt: 40 }, prompt: '高分完整提示词', shotNo: '02' });
  assert.equal(second.highScorePrompts.length, 1);
  assert.equal(second.highScorePrompts[0].shotNo, '02');
  assert.equal(second.highScorePrompts[0].score, 96);
});

test('injects learned rules once without copying unrelated high score plots', () => {
  const learned = updateQualityLearning({ report: report(), prompt: '另一镜剧情', shotNo: '01' });
  const once = appendQualityLearningGuidance('当前镜提示词', learned);
  const twice = appendQualityLearningGuidance(once, learned);
  assert.match(twice, /项目历史质量规则/);
  assert.match(twice, /人物尺度/);
  assert.doesNotMatch(twice, /另一镜剧情/);
  assert.equal((twice.match(/项目历史质量规则】/g) ?? []).length, 1);
});

test('removes one avoidance rule without changing prompt examples', () => {
  const current = updateQualityLearning({
    report: report({
      issues: [
        { code: 'character-scale', severity: 'error', message: '人物尺度跳变' },
        { code: 'character-position', severity: 'error', message: '空间关系跳变' },
      ],
    }),
    prompt: '提示词',
    shotNo: '01',
  });
  const next = removeQualityLearningRule(current, 'character-scale', 50);
  assert.deepEqual(next?.avoidanceRules.map((rule) => rule.code), ['character-position']);
  assert.deepEqual(next?.highScorePrompts, current.highScorePrompts);
  assert.equal(next?.updatedAt, 50);
});

test('removes one high score prompt and ignores unknown ids', () => {
  const current = updateQualityLearning({
    report: report({ passed: true, score: 96, issues: [], reviewedAt: 30 }),
    prompt: '高分完整提示词',
    shotNo: '01',
  });
  assert.equal(removeQualityPromptExample(current, 'missing', 40), current);
  const next = removeQualityPromptExample(current, current.highScorePrompts[0].id, 40);
  assert.equal(next?.highScorePrompts.length, 0);
  assert.equal(next?.updatedAt, 40);
});

test('resets quality learning to an empty state', () => {
  assert.deepEqual(emptyQualityLearning(123), {
    highScorePrompts: [],
    avoidanceRules: [],
    updatedAt: 123,
  });
});
