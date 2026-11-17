import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanvasTask } from '../../stores/canvasTaskStore';
import type { WsShot } from './types';
import { restoreShotGenerationState, shotGenerationTask } from './shotGenerationState.ts';

const shot = (extra: Partial<WsShot> = {}): WsShot => ({
  id: 'shot-A', shotNo: '01-01', sceneId: '', characterIds: [], description: '', ...extra,
});
const task = (extra: Partial<CanvasTask> = {}): CanvasTask => ({
  id: 'task-A', projectId: 'project-A', workshopShotNo: '01-01', workshopShotKind: 'video',
  nodeId: '', kind: 'video', engineId: 'h3', engineLabel: 'H3', endpoint: 'test', prompt: '',
  status: 'running', progress: 'SGLang queued · 进度 0', resultPaths: [], resultUrls: [], createdAt: 1,
  ...extra,
});

test('registered task restores progress and ownership after project reopen', () => {
  const original = Object.freeze(shot({ genStatus: 'generating', genTaskId: 'task-A' }));
  const restored = restoreShotGenerationState(original, 'project-A', [task()]);
  assert.equal(restored.genStatus, 'generating');
  assert.equal(restored.genTaskId, 'task-A');
  assert.equal(restored.genProgress, 'SGLang queued · 进度 0');
  assert.equal(original.genProgress, undefined);
});

for (const status of ['queued', 'uploading', 'running', 'downloading'] as const) {
  test(`lost task link is restored from the latest ${status} task`, () => {
    const restored = restoreShotGenerationState(shot({ genStatus: 'idle' }), 'project-A', [task({ status })]);
    assert.equal(restored.genTaskId, 'task-A');
    assert.equal(restored.genStatus, status === 'queued' ? 'queued' : 'generating');
  });
}

test('matching shot numbers in other projects and storyboard cells cannot claim a shot', () => {
  const pending = shot({ genStatus: 'generating', genTaskId: 'task-A' });
  for (const foreign of [task({ projectId: 'project-B' }), task({ workshopStoryboardFrameId: 'panel-A' }), task({ projectId: undefined })]) {
    const restored = restoreShotGenerationState(pending, 'project-A', [foreign]);
    assert.equal(restored.genStatus, 'idle');
    assert.equal(restored.genTaskId, undefined);
  }
});

test('explicit ownership is preserved instead of attaching a different attempt', () => {
  const old = task();
  const newer = task({ id: 'task-B', createdAt: 2 });
  assert.equal(shotGenerationTask(shot({ genTaskId: 'task-A' }), 'project-A', [old, newer]), old);
  assert.equal(shotGenerationTask(shot({ genTaskId: 'missing' }), 'project-A', [newer]), undefined);
});

test('newer finished or failed attempts do not resurrect an older running task', () => {
  for (const status of ['succeeded', 'failed'] as const) {
    const current = shot({ genStatus: 'done' });
    const restored = restoreShotGenerationState(current, 'project-A', [task(), task({ id: 'new', status, createdAt: 2 })]);
    assert.equal(restored, current);
  }
});

test('failed owned task restores its error, even when an old image exists', () => {
  const restored = restoreShotGenerationState(shot({ genStatus: 'generating', genTaskId: 'task-A', imagePath: '/old.png' }), 'project-A', [task({ status: 'failed', error: 'provider failed' })]);
  assert.equal(restored.genStatus, 'failed');
  assert.equal(restored.genError, 'provider failed');
});

test('completed owned task retains its handle until recovery writes the candidate', () => {
  const restored = restoreShotGenerationState(shot({ genStatus: 'generating', genTaskId: 'task-A' }), 'project-A', [task({ status: 'succeeded', resultPaths: ['/result.mp4'] })]);
  assert.equal(restored.genStatus, 'generating');
  assert.equal(restored.genTaskId, 'task-A');
  assert.match(restored.genProgress!, /恢复结果/);
  assert.equal(restored.videoPath, undefined);
  assert.equal(restored.videoCandidates, undefined);
});

test('cancelled tasks without an owner do not reappear, orphan spinners still clear', () => {
  const cancelled = shot({ genStatus: 'idle' });
  assert.equal(restoreShotGenerationState(cancelled, 'project-A', [task({ status: 'failed', error: '用户已取消' })]), cancelled);
  const restored = restoreShotGenerationState(shot({ genStatus: 'queued', genTaskId: 'missing', genProgress: 'old' }), 'project-A', []);
  assert.equal(restored.genStatus, 'idle');
  assert.equal(restored.genProgress, undefined);
  assert.equal(restored.genTaskId, undefined);
});

test('boundary frame tasks are restored but audio and free canvas tasks are excluded', () => {
  const boundary = task({ kind: 'image', workshopShotKind: 'image', workshopShotFrameRole: 'video-start' });
  assert.equal(shotGenerationTask(shot(), 'project-A', [boundary]), boundary);
  assert.equal(shotGenerationTask(shot(), 'project-A', [task({ workshopShotKind: undefined })]), undefined);
});
