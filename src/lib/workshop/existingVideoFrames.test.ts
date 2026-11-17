import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveExistingVideoFrames } from './existingVideoFrames.ts';

const shot = {
  shotNo: '01-02', videoStartFramePath: '/start.png', videoEndFramePath: '/end.png',
  videoBoundaryFrameSignature: 'old-signature',
};

test('i2va reuses selected start regardless of signature, never reads or submits end', async () => {
  const checked: string[] = [];
  const result = await resolveExistingVideoFrames(shot, 'i2va', async (path) => {
    checked.push(path);
    return true;
  });
  assert.deepEqual(result, { start: '/start.png', end: undefined, refs: ['/start.png'] });
  assert.deepEqual(checked, ['/start.png']);
  assert.deepEqual(await resolveExistingVideoFrames({ ...shot, videoEndFramePath: undefined }, 'i2va', async () => true), result);
});

test('fl2va reuses the existing frame pair without changing selected paths', async () => {
  const original = { ...shot };
  assert.deepEqual(await resolveExistingVideoFrames(shot, 'fl2va', async () => true), {
    start: '/start.png', end: '/end.png', refs: ['/start.png', '/end.png'],
  });
  assert.deepEqual(shot, original);
});

test('missing required frame paths block instead of substituting or generating media', async () => {
  await assert.rejects(resolveExistingVideoFrames({ shotNo: '01-02' }, 'i2va', async () => {
    assert.fail('no path to inspect');
  }), /缺少首帧.*生成视频不会自动生图/);
  await assert.rejects(resolveExistingVideoFrames({ ...shot, videoEndFramePath: undefined }, 'fl2va', async () => true), /缺少尾帧/);
});

test('missing and inaccessible files block video submission', async () => {
  for (const task of ['i2va', 'fl2va'] as const) {
    await assert.rejects(resolveExistingVideoFrames(shot, task, async () => false), /首帧文件不存在或无法访问/);
    await assert.rejects(resolveExistingVideoFrames(shot, task, async () => { throw new Error('permission'); }), /首帧文件不存在或无法访问/);
  }
  await assert.rejects(resolveExistingVideoFrames(shot, 'fl2va', async (path) => path === '/start.png'), /尾帧文件不存在或无法访问/);
});

test('t2va and ref2va do not require or read boundary images (including batch preflight)', async () => {
  for (const task of ['t2va', 'ref2va'] as const) {
    assert.deepEqual(await resolveExistingVideoFrames({ shotNo: '01-02' }, task, async () => {
      assert.fail('must not inspect boundary images');
    }), { refs: [] });
  }
});

test('store reserves boundary generation for explicit image actions, not video submission', () => {
  const source = readFileSync(new URL('../../stores/workshopStore.ts', import.meta.url), 'utf8');
  const explicit = source.indexOf('if (options?.boundaryFramesOnly)');
  const actual = source.indexOf('const latestPreviousShot =', explicit);
  const end = source.indexOf("} else if (kind === 'video' && inheritsPrevious", actual);
  assert.ok(explicit >= 0 && actual > explicit && end > actual);
  assert.match(source.slice(explicit, actual), /await ensureBoundaryFrames\(/);
  const submission = source.slice(actual, end);
  assert.match(submission, /await resolveExistingVideoFrames\(/);
  assert.match(submission, /refs = boundary.refs/);
  assert.doesNotMatch(submission, /ensureBoundaryFrames\(|extractVideoTailFrame\(|runGeneration\(/);
});

test('batch preflights frames before submitting and no longer budgets silent image calls', () => {
  const source = readFileSync(new URL('../../components/workshop/steps/StepGenerate.tsx', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('const handleGenerateAllVideos ='), source.indexOf('\n  return (', source.indexOf('const handleGenerateAllVideos =')));
  assert.match(handler, /await resolveExistingVideoFrames\(shot, task, exists,/);
  assert.ok(handler.indexOf('if (frameErrors.length > 0)') < handler.indexOf('await store.generateShot('));
  assert.doesNotMatch(handler, /h3BoundaryTasks|estimatedSubmissions/);
});
