import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFirstFrameInputPresentation } from './shotInputPresentation.ts';
import type { WsShot } from './types.ts';

const scene = { id: 'scene-1', assetImagePath: '/scene.png', name: '训练室' };
const character = { id: 'lu_chen', assetImagePath: '/lu.png', name: '陆沉' };
const prop = { id: 'wrist', assetImagePath: '/wrist.png', name: '护腕' };
const context = { scenes: [scene], characters: [character], props: [prop] };
const shot = (patch: Partial<WsShot> = {}): WsShot => ({
  shotNo: '01-02', description: '动作', characterIds: ['lu_chen'], sceneId: 'scene-1', propIds: ['wrist'],
  continuityMode: 'inherit', ...patch,
});

test('first-frame presentation keeps scene/character/prop assets visible and shows the accepted previous tail', () => {
  const result = buildFirstFrameInputPresentation(shot(), {
    ...shot({ shotNo: '01-01', continuityMode: 'scene-cut', videoPath: '/accepted.mp4', videoEndFramePath: '/tail.png' }),
  }, context);
  assert.deepEqual(result.assets.map((item) => item.path), ['/scene.png', '/lu.png', '/wrist.png']);
  assert.equal(result.previousTail, '/tail.png');
  assert.match(result.continuityMessage, /01-01 已采用视频的尾帧/);
});

test('different scenes do not inherit a previous tail', () => {
  const result = buildFirstFrameInputPresentation(shot({ continuityMode: 'scene-cut', sceneId: 'other-scene' }), {
    ...shot({ shotNo: '01-01', videoEndFramePath: '/tail.png' }),
  }, context);
  assert.equal(result.previousTail, undefined);
  assert.match(result.continuityMessage, /集号或场景不同/);
});
