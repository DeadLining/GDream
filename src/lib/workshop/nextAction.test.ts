import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyWorkshopData } from './types.ts';
import { getWorkshopNextAction } from './nextAction.ts';

test('guides an empty project to import a script first', () => {
  const data = emptyWorkshopData('p1');
  const next = getWorkshopNextAction(data, { sources: [] });
  assert.equal(next.step, 'script');
  assert.match(next.detail, /剧本源文件/);
  assert.equal(next.blocking, true);
});

test('guides a reviewed project to the first incomplete production step', () => {
  const data = emptyWorkshopData('p1');
  data.steps.script.status = 'done';
  data.steps.breakdown.status = 'done';
  const next = getWorkshopNextAction(data, { sources: [{ name: 'script.md', type: 'md', size: 1, uploadedAt: 1 }] });
  assert.equal(next.step, 'assets');
});
