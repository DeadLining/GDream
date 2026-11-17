import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoReviewTask } from './videoReviewTask.ts';
test('batch review requires native visual evidence, preserves gates and forbids regeneration', () => {
  const prompt = buildVideoReviewTask(['01-01','01-02']);
  for (const text of ['01-01、01-02', 'read_image', 'expected_fingerprint', 'not-reviewed', '不自动重生成', '不绕过门禁']) assert.ok(prompt.includes(text));
});
