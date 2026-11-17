import assert from 'node:assert/strict';
import test from 'node:test';
import { filterAigcProjects, searchAigcProjects, summarizeAigcProjects } from './portfolioStats.ts';

test('summarizes the cross-project production portfolio from the project index', () => {
  const stats = summarizeAigcProjects([
    { id: 'p1', name: '一', slug: 'one', createdAt: 1, updatedAt: 2, status: 'video-generating', videoEngine: 'dreamina', sources: [], stats: { shots: 8, scenes: 2, assets: 4, videosCompleted: 3 } },
    { id: 'p2', name: '二', slug: 'two', createdAt: 1, updatedAt: 2, status: 'completed', videoEngine: 'rhtv', sources: [], stats: { shots: 5, scenes: 1, assets: 2, videosCompleted: 5 } },
  ]);
  assert.deepEqual(stats, {
    projectCount: 2,
    shotCount: 13,
    completedVideoCount: 8,
    activeProjectCount: 1,
    statusCounts: { 'video-generating': 1, completed: 1 },
  });
});

test('searches projects by name, slug, or id without changing the source list', () => {
  const projects = [
    { id: 'p1', name: '星火', slug: 'star-fire', createdAt: 1, updatedAt: 2, status: 'draft' as const, videoEngine: 'dreamina' as const, sources: [], stats: { shots: 0, scenes: 0, assets: 0, videosCompleted: 0 } },
    { id: 'p2', name: '夜航', slug: 'night-flight', createdAt: 1, updatedAt: 2, status: 'completed' as const, videoEngine: 'rhtv' as const, sources: [], stats: { shots: 0, scenes: 0, assets: 0, videosCompleted: 0 } },
  ];
  assert.deepEqual(searchAigcProjects(projects, 'STAR'), [projects[0]]);
  assert.deepEqual(searchAigcProjects(projects, 'p2'), [projects[1]]);
  assert.equal(searchAigcProjects(projects, '  ').length, 2);
  assert.equal(projects.length, 2);
  assert.deepEqual(filterAigcProjects(projects, '', 'completed'), [projects[1]]);
  assert.deepEqual(filterAigcProjects(projects, 'night', 'completed'), [projects[1]]);
});
