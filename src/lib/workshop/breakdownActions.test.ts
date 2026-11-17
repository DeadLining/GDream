import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBreakdownResumePrompt } from './breakdownIntent.ts';
const source = readFileSync(new URL('../../components/workshop/steps/StepBreakdown.tsx', import.meta.url), 'utf8');
test('breakdown-only action is explicitly labelled and remains scoped', () => {
  assert.ok(source.includes('核对并补齐拆解'));
  assert.ok(!source.includes('核对已有镜头并继续'));
  assert.match(source, /dispatchWorkshopPrompt\(buildBreakdownResumePrompt\(\)\)/);
  assert.match(buildBreakdownResumePrompt(), /不要生成任何媒体/);
});
test('full workflow action dispatches the real continuation runner', () => {
  assert.match(source, /dispatchWorkshopPrompt\('【继续一键全流程】',\s*\{ continuation: true \}\)/);
  assert.ok(source.includes('仅核对拆解不会启动资产或视频生成'));
});
