import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { WsShot } from './types.ts';
import { acceptedVideoTailPath, inheritedStartFramePatch, selectVideoStartFrame } from './inheritedVideoFrame.ts';
import { resolveExistingVideoFrames } from './existingVideoFrames.ts';
import { buildFirstFrameInputPresentation } from './shotInputPresentation.ts';

const previous: WsShot = {
  shotNo: '01-01', description: '前镜', characterIds: [], sceneId: 'scene-1', episode: '01',
  videoPath: '/accepted.mp4', videoStartFramePath: '/previous-start.png', videoEndFramePath: '/planned-end.png',
  acceptedVideoTail: { videoPath: '/accepted.mp4', framePath: '/captured-tail.png', extractionId: 'a' },
};
const shot: WsShot = { shotNo: '01-02', description: '承接镜', characterIds: [], sceneId: 'scene-1', episode: '01', continuityMode: 'inherit' };

test('i2va immediately submits only the accepted previous video tail, no boundary-image generation', async () => {
  const checked: string[] = [];
  const frames = await resolveExistingVideoFrames(shot, 'i2va', async (path) => { checked.push(path); return true; }, previous);
  assert.deepEqual(frames, { start: '/captured-tail.png', end: undefined, refs: ['/captured-tail.png'] });
  assert.deepEqual(checked, ['/captured-tail.png']);
  assert.notEqual(frames.start, previous.videoStartFramePath);
  const patch = inheritedStartFramePatch(shot, previous, 'i2va');
  assert.equal(patch?.videoStartFramePath, '/captured-tail.png');
  assert.equal(patch?.videoEndFramePath, undefined);
  assert.equal(patch?.videoStartFrameInheritance?.videoPath, '/accepted.mp4');
});

test('explicitly selected next-shot first image is never overwritten', async () => {
  const manual = { ...shot, videoStartFramePath: '/my-start.png' };
  assert.deepEqual(selectVideoStartFrame(manual, previous, 'i2va'), { path: '/my-start.png', inherited: false });
  assert.equal(inheritedStartFramePatch(manual, previous, 'i2va'), undefined);
  assert.deepEqual((await resolveExistingVideoFrames(manual, 'i2va', async () => true, previous)).refs, ['/my-start.png']);
});

test('editorial flags do not block same-scene inheritance; changed scenes and episodes do', () => {
  for (const continuityMode of ['scene-cut', 'time-jump', 'montage'] as const) {
    assert.equal(selectVideoStartFrame({ ...shot, continuityMode }, previous, 'i2va').path, '/captured-tail.png');
  }
  assert.equal(selectVideoStartFrame({ ...shot, sceneId: 'scene-2' }, previous, 'i2va').path, undefined);
  assert.equal(selectVideoStartFrame({ ...shot, episode: '02', continuityMode: undefined }, previous, 'i2va').path, undefined);
  assert.equal(selectVideoStartFrame({ ...shot, continuityMode: undefined }, previous, 'i2va').path, '/captured-tail.png');
});

test('candidate-only videos and planned end frames are not accepted-video tails', () => {
  assert.equal(acceptedVideoTailPath({ ...previous, videoPath: undefined }), undefined);
  assert.equal(acceptedVideoTailPath({ ...previous, acceptedVideoTail: undefined }), undefined);
  assert.equal(acceptedVideoTailPath({ ...previous, videoPath: '/other.mp4' }), undefined);
  assert.equal(selectVideoStartFrame(shot, undefined, 'i2va').path, undefined);
});

test('legacy FFmpeg tail captures work without regenerating images or accepting the video again', async () => {
  const legacy = { ...previous, acceptedVideoTail: undefined, videoEndFramePath: '/shots/01-01-video-tail-1789730769770.png' };
  assert.equal(selectVideoStartFrame(shot, legacy, 'i2va').path, legacy.videoEndFramePath);
  assert.equal((await resolveExistingVideoFrames(shot, 'i2va', async () => true, legacy)).start, legacy.videoEndFramePath);
});

test('pending recapture blocks stale auto-bound frame; completed recapture follows the new accepted video', async () => {
  const bound = { ...shot, ...inheritedStartFramePatch(shot, previous, 'i2va') };
  const pending = { ...previous, videoPath: '/new.mp4', acceptedVideoTail: { videoPath: '/new.mp4', extractionId: 'b' } };
  assert.equal(selectVideoStartFrame(bound, pending, 'i2va').path, undefined);
  await assert.rejects(resolveExistingVideoFrames(bound, 'i2va', async () => true, pending), /尾帧尚未就绪.*无需生成首尾帧/);
  const finished = { ...pending, acceptedVideoTail: { ...pending.acceptedVideoTail, framePath: '/new-tail.png' } };
  assert.equal(selectVideoStartFrame(bound, finished, 'i2va').path, '/new-tail.png');
  assert.equal(inheritedStartFramePatch(bound, finished, 'i2va')?.videoStartFramePath, '/new-tail.png');
  const manuallyReplaced = { ...bound, videoStartFramePath: '/custom.png' };
  assert.equal(selectVideoStartFrame(manuallyReplaced, finished, 'i2va').path, '/custom.png');
  assert.equal(selectVideoStartFrame(bound, undefined, 'i2va').path, undefined);
});

test('missing capture files report a screenshot problem, never request paid image generation', async () => {
  await assert.rejects(resolveExistingVideoFrames(shot, 'i2va', async () => false, previous), /重新采用上一镜视频以提取尾帧.*无需重新生图/);
});

test('FL2VA still needs a selected pair, reference and text modes do not auto-bind', async () => {
  for (const mode of ['fl2va', 'ref2va', 't2va'] as const) {
    assert.equal(inheritedStartFramePatch(shot, previous, mode), undefined);
  }
  await assert.rejects(resolveExistingVideoFrames(shot, 'fl2va', async () => true, previous), /缺少首帧/);
});

test('UI presentation tells users they can directly generate video from the inherited tail', () => {
  const context = { characters: [], scenes: [], props: [] };
  const result = buildFirstFrameInputPresentation(shot, previous, context, 'i2va');
  assert.equal(result.previousTail, '/captured-tail.png');
  assert.match(result.continuityMessage, /首帧直接使用.*尾帧截图.*可直接生成视频/);
});

test('accept handler isolates async capture by project and acceptance token before binding next start', () => {
  const source = readFileSync(new URL('../../stores/workshopStore.ts', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('  selectVideoCandidate: (shotNo, path,'), source.indexOf('  cancelShot: (shotNo)'));
  assert.match(handler, /current\?\.projectId === data.projectId/);
  assert.match(handler, /extractionId === tailExtractionId/);
  assert.match(handler, /inheritedStartFramePatch\(nextShot, acceptedShot,/);
  assert.match(handler, /nextShot.genStatus !== 'queued' && nextShot.genStatus !== 'generating'/);
  assert.doesNotMatch(handler, /runGeneration\(|ensureBoundaryFrames\(/);
});

test('single-shot UI uses the same resolved start as batch and submission; inherited frame overwrite needs confirmation', () => {
  const source = readFileSync(new URL('../../components/workshop/steps/StepGenerate.tsx', import.meta.url), 'utf8');
  assert.match(source, /h3Settings.task === 'i2va' && !effectiveStartFrame/);
  assert.match(source, /const startSelection = selectVideoStartFrame\(shot, previousShot, h3Settings.task\)/);
  assert.match(source, /selected.inherited && boundaryFrameRole !== 'end'/);
  assert.match(source, /确认替换承接首帧/);
  assert.ok(source.split("{h3Settings.task === 'fl2va' && (").length >= 3, 'i2va hides both pair generation and end generation buttons');
  assert.match(source, /h3Settings.task !== 'ref2va' && h3Settings.task !== 't2va'/);
});

test('i2va default inheritance also works when legacy continuityMode is absent', () => {
  const previous = { shotNo: '01-01', episode: '1', sceneId: 'room', videoPath: '/accepted.mp4', acceptedVideoTail: { videoPath: '/accepted.mp4', framePath: '/tail.png', extractionId: 'test-tail' } };
  const next = { shotNo: '01-02', episode: '01', sceneId: 'room', continuityMode: undefined, videoStartFramePath: undefined };
  assert.equal(selectVideoStartFrame(next, previous, 'i2va').path, '/tail.png');
  assert.equal(inheritedStartFramePatch(next, previous, 'i2va')?.videoStartFrameInheritance?.shotNo, '01-01');
});

test('same continuity policy drives UI and submission frame selection', () => {
  const previous = { shotNo: '01-01', episode: '1', sceneId: 'room', videoPath: '/accepted.mp4', acceptedVideoTail: { videoPath: '/accepted.mp4', framePath: '/tail.png', extractionId: 'tail' } };
  const next = { shotNo: '01-02', episode: '1', sceneId: 'room', continuityMode: undefined, videoStartFramePath: undefined };
  assert.equal(selectVideoStartFrame(next, previous, 'i2va').path, '/tail.png');
  assert.equal(selectVideoStartFrame({ ...next, continuityMode: 'scene-cut' }, previous, 'i2va').path, '/tail.png');
});


test('changed scene invalidates already persisted automatic frames in UI and submission', async () => {
  const bound = { ...shot, ...inheritedStartFramePatch(shot, previous, 'i2va') };
  const next = { ...bound, sceneId: 'granary' }; // Even a stale inherit flag cannot bypass a scene change.
  const presentation = buildFirstFrameInputPresentation(next, previous, { characters: [], scenes: [], props: [] }, 'i2va');
  assert.equal(presentation.previousTail, undefined);
  assert.match(presentation.continuityMessage, /生成新首帧/);
  assert.equal(inheritedStartFramePatch(next, previous, 'i2va'), undefined);
  for (const task of ['i2va', 'fl2va'] as const) {
    assert.equal(selectVideoStartFrame(next, previous, task).path, undefined);
    await assert.rejects(resolveExistingVideoFrames(next, task, async () => true, previous), /缺少首帧/);
  }
  const independent = { ...next, videoStartFramePath: '/new-scene.png' };
  assert.equal(selectVideoStartFrame(independent, previous, 'i2va').path, '/new-scene.png');
  assert.deepEqual((await resolveExistingVideoFrames(independent, 'i2va', async () => true, previous)).refs, ['/new-scene.png']);
});

 test('different scene image overrides require a new start even in the same episode and scene', () => {
  const source = { ...previous, sceneImagePaths: ['/room-a.png'] };
  assert.equal(selectVideoStartFrame({ ...shot, sceneImagePaths: ['/room-b.png'] }, source, 'i2va').path, undefined);
  assert.equal(selectVideoStartFrame({ ...shot, sceneImagePaths: ['/room-a.png'], continuityMode: 'montage' }, source, 'i2va').path, '/captured-tail.png');
});

test('ref2va stays optional by default but honors an explicit per-shot first-frame choice', () => {
  const previous = { shotNo: '01-01', episode: '1', sceneId: 'room', videoPath: '/accepted.mp4', acceptedVideoTail: { videoPath: '/accepted.mp4', framePath: '/tail.png', extractionId: 'test' } };
  const shot = { shotNo: '01-02', episode: '1', sceneId: 'room' };
  assert.equal(inheritedStartFramePatch(shot, previous, 'ref2va'), undefined);
  assert.deepEqual(
    selectVideoStartFrame({ ...shot, usePreviousTailAsFirstFrame: true }, previous, 'ref2va'),
    { path: '/tail.png', inherited: true },
  );
  assert.equal(inheritedStartFramePatch({ ...shot, usePreviousTailAsFirstFrame: true }, previous, 'ref2va'), undefined);
});
