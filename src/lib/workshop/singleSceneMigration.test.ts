import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSingleSceneReferences } from './singleSceneMigration.ts';
import type { WorkshopData } from './types.ts';
test('legacy two views migrate to the chosen primary and related shots only', () => {
  const data = { scenes: [{ id: 's', assetImagePath: 'b', selectedImagePaths: ['a', 'b'], sceneReferenceMode: 'multi', candidates: [{ path: 'a' }, { path: 'b' }] }], shots: [{ sceneId: 's', sceneImagePaths: ['a', 'b'], videoPath: 'keep.mp4' }, { sceneId: 'other', sceneImagePaths: ['x'] }] } as unknown as WorkshopData;
  assert.equal(migrateSingleSceneReferences(data), true);
  assert.deepEqual(data.scenes[0].selectedImagePaths, ['b']);
  assert.deepEqual(data.scenes[0].candidates?.map((c) => c.path), ['b']);
  assert.deepEqual(data.shots[0].sceneImagePaths, ['b']);
  assert.equal(data.shots[0].videoPath, 'keep.mp4');
  assert.deepEqual(data.shots[1].sceneImagePaths, ['x']);
  assert.equal(migrateSingleSceneReferences(data), false);
});
