import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPortfolioEvents } from './portfolioEvents.ts';
import type { AigcProject } from './projectStore.ts';
import { emptyWorkshopData, type WorkshopData } from '../workshop/types.ts';

const project = (id: string, name: string, createdAt: number, updatedAt = createdAt): AigcProject => ({
  id, name, slug: id, createdAt, updatedAt, status: 'draft', videoEngine: 'dreamina', sources: [],
  stats: { shots: 0, scenes: 0, assets: 0, videosCompleted: 0 },
});

const workshop = (changelog: WorkshopData['changelog']): WorkshopData => ({
  ...emptyWorkshopData('p1'),
  changelog,
});

test('builds a newest-first cross-project activity stream from existing sources', () => {
  const events = buildPortfolioEvents(
    [project('p1', '一', 10), project('p2', '二', 30)],
    { p1: workshop([{ at: 20, step: 'script', summary: '导入剧本' }]) },
  );
  assert.deepEqual(events.map((event) => [event.projectId, event.label, event.detail]), [
    ['p2', '项目创建', '二'], ['p1', '剧本', '导入剧本'], ['p1', '项目创建', '一'],
  ]);
});

test('limits events without mutating input order', () => {
  const projects = [project('p1', '一', 1)];
  const events = buildPortfolioEvents(projects, { p1: workshop([
    { at: 2, step: 'script', summary: 'a' }, { at: 3, step: 'breakdown', summary: 'b' },
  ]) }, 2);
  assert.equal(events.length, 2);
  assert.equal(projects.length, 1);
});
