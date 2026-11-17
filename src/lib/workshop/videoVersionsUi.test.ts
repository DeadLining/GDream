import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../components/workshop/steps/StepGenerate.tsx', import.meta.url), 'utf8');
test('version list includes adopted candidates and labels the current version without allowing re-adoption', () => {
  assert.match(source, /全部版本/);
  assert.match(source, /allVideoCandidates\.map/);
  assert.match(source, /const isAdopted = candidate\.path === shot\.videoPath/);
  assert.match(source, /disabled=\{isAdopted \|\| !candidateQualityPassed\}/);
  assert.match(source, /isAdopted \? '已采用' : '采用'/);
  assert.doesNotMatch(source, /其他版本 · 采用后替换当前版本/);
});
