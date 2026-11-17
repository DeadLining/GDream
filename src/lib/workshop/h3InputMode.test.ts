import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { changeWorkshopH3Task, resolveWorkshopH3Task } from './h3InputMode.ts';
import { emptyWorkshopData, type WsShot } from './types.ts';

const shot: WsShot = { shotNo: '01-01', description: '动作', characterIds: [], videoModel: 'minimax-h3', universalVideoPrompt: 'Reference prompt', imagePrompt: 'image unchanged', videoPath: '/paid.mp4', storyboardFrames: [], actionTimeline: { durationSec: 5, summary: 'action', segments: [] } };
test('project input mode beats global default and projects remain independent', () => {
  assert.equal(resolveWorkshopH3Task({ h3InputMode: 'i2va' }, 'ref2va'), 'i2va');
  assert.equal(resolveWorkshopH3Task({ h3InputMode: 'ref2va' }, 'i2va'), 'ref2va');
  assert.equal(resolveWorkshopH3Task(undefined), 'ref2va');
  assert.equal(resolveWorkshopH3Task({}, 'fl2va'), 'fl2va');
});
test('switch preserves all authored assets, flags incompatible video text, not empty shots or other models', () => {
  const data = { ...emptyWorkshopData('p'), h3InputMode: 'ref2va' as const, shots: [shot, { ...shot, shotNo: '2', videoModel: 'wan-3.0' }, { ...shot, shotNo: '3', universalVideoPrompt: '' }] };
  const next = changeWorkshopH3Task(data, 'i2va', 'ref2va');
  assert.equal(next.h3InputMode, 'i2va');
  assert.equal(next.shots[0].h3VideoPromptModeStale, true);
  assert.equal(next.shots[0].h3VideoPromptTask, 'ref2va');
  for (const field of ['universalVideoPrompt', 'imagePrompt', 'videoPath', 'storyboardFrames', 'actionTimeline'] as const) assert.equal(next.shots[0][field], shot[field]);
  assert.equal(next.shots[1], data.shots[1]);
  assert.equal(next.shots[2], data.shots[2]);
  assert.equal(data.shots[0].h3VideoPromptModeStale, undefined);
  assert.equal(changeWorkshopH3Task(next, 'i2va', 'i2va'), next);
  assert.equal(changeWorkshopH3Task(next, 'ref2va', 'i2va').shots[0].h3VideoPromptModeStale, false);
});
test('legacy text captures original mode on first switch and serialized selection survives reopening', () => {
  const data = { ...emptyWorkshopData('p'), shots: [shot] };
  const next = changeWorkshopH3Task(data, 'ref2va', 'i2va');
  assert.equal(next.shots[0].h3VideoPromptTask, 'i2va');
  assert.equal(next.shots[0].h3VideoPromptModeStale, true);
  assert.equal(resolveWorkshopH3Task(JSON.parse(JSON.stringify(next)), 'i2va'), 'ref2va');
});
test('both pages share control, all workshop authoring and submission paths use project mode', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  for (const p of ['../../components/workshop/steps/StepPrompts.tsx','../../components/workshop/steps/StepGenerate.tsx']) {
    assert.match(read(p), /<H3InputModeSelect/);
    assert.match(read(p), /<H3ModeChangeNotice/);
    assert.doesNotMatch(read(p), /customVideoGenericH3Task|setCustomVideoGenericH3Task/);
  }
  for (const p of ['./rewriteShotVideo.ts', './continuationRuntime.ts', '../agent/tools/workshopTools.ts']) {
    assert.match(read(p), /getH3InputMode\(\)/);
    assert.doesNotMatch(read(p), /customVideoGenericH3Task/);
  }
  const store = read('../../stores/workshopStore.ts');
  assert.match(store, /shot.h3VideoPromptModeStale \|\|/);
  assert.match(store, /未提交视频生成/);
  const rewrite = read('./rewriteShotVideo.ts');
  assert.match(rewrite, /h3VideoPromptTask: task/);
  assert.match(rewrite, /h3VideoPromptModeStale: false/);
});
