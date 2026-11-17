import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeProjectSessions } from './projectSessionPolicy.ts';
import type { Session } from '@/types';

const session = (id: string, patch: Partial<Session> = {}): Session => ({
  id,
  title: '广告任务上下文',
  agentId: 'main',
  projectId: 'project-1',
  createdAt: Number(id),
  updatedAt: Number(id),
  messageCount: 0,
  ...patch,
});

test('项目会话列表只保留一个主会话，并优先保留有消息的记录', () => {
  const result = dedupeProjectSessions([
    session('1', { messageCount: 0, updatedAt: 100 }),
    session('2', { messageCount: 4, updatedAt: 90 }),
    session('3', { messageCount: 2, updatedAt: 200 }),
  ], 'project-1');
  assert.deepEqual(result.map((item) => item.id), ['2']);
});

test('不同项目的会话不会被清理', () => {
  const other = session('4', { projectId: 'project-2' });
  const result = dedupeProjectSessions([session('1'), other], 'project-1');
  assert.deepEqual(result.map((item) => item.id), ['1']);
});

test('历史入口保留同项目全部有内容的会话，只隐藏空壳', async () => {
  const { projectSessionHistory } = await import('./projectSessionPolicy.ts');
  assert.deepEqual(projectSessionHistory([
    session('1'), session('2', { messageCount: 49 }), session('3', { messageCount: 7 }),
    session('4', { projectId: 'other', messageCount: 100 }),
  ], 'project-1').map(s => s.id), ['3', '2']);
});
