import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData, type WsShot } from './types.ts';
import { buildImageRefBindings } from './shotRefs.ts';
import { buildProjectAssetReferencePatch, projectAssetImages } from './projectAssetReferences.ts';

function fixture() {
  const data = emptyWorkshopData('project-A');
  data.characters = [
    { id: 'girl', name: '年轻女子', personality: '', appearance: '', assetImagePath: '/girl.png' },
    { id: 'clerk', name: '店员', personality: '', appearance: '', candidates: [{ path: '/unadopted.png', source: 'generate', createdAt: 1 }] },
  ];
  data.scenes = [{ id: 'shop', name: '声音修理店', description: '', assetImagePath: '/shop.png', sceneReferenceMode: 'multi', selectedImagePaths: ['/shop.png', '/shop-side.png'] }];
  data.props = [{ id: 'recorder', name: '旧录音器', description: '', assetImagePath: '/recorder.png' }];
  data.colorPalettes = [{ id: 'night', name: '夜色', createdAt: 1, assetImagePath: '/night.png' }];
  return data;
}

test('project picker lists selected images across all asset kinds, including scene angles', () => {
  const images = projectAssetImages(fixture());
  assert.deepEqual(images.map((image) => [image.kind, image.name, image.path, image.angle]), [
    ['character', '年轻女子', '/girl.png', undefined],
    ['scene', '声音修理店', '/shop.png', undefined],
    ['scene', '声音修理店', '/shop-side.png', 2],
    ['prop', '旧录音器', '/recorder.png', undefined],
    ['colorPalette', '夜色', '/night.png', undefined],
  ]);
  assert.ok(!images.some((image) => image.path === '/unadopted.png'));
});

test('missing images and inactive scene angles stay out; duplicate paths appear once', () => {
  const data = fixture();
  data.scenes[0].sceneReferenceMode = undefined;
  data.props!.push({ id: 'copy', name: '重复图片', description: '', assetImagePath: '/girl.png' });
  assert.deepEqual(projectAssetImages(data).map((image) => image.path), ['/girl.png', '/shop.png', '/recorder.png', '/night.png']);
  assert.deepEqual(projectAssetImages(emptyWorkshopData('empty')), []);
});

test('adding project images preserves existing refs and cast, remapping both prompt syntaxes', () => {
  const data = fixture();
  data.globalColorPaletteId = 'night';
  const shot: WsShot = {
    id: 'shot-1', shotNo: '01-01', sceneId: 'shop', characterIds: ['girl'], description: '',
    extraRefImages: ['/uploaded.png'],
    imagePrompt: '参考@图片四和@图片五',
    universalVideoPrompt: 'subject_definitions: <Subject 1>: Based on <Picture 4>.\n\nsummary: Preserve <Picture 5>.',
    videoPath: '/existing-video.mp4',
  };
  const before = JSON.stringify({ data, shot });
  const patch = buildProjectAssetReferencePatch(shot, data, ['/recorder.png', '/recorder.png', '/girl.png']);
  assert.deepEqual(patch.extraRefImages, ['/uploaded.png', '/recorder.png']);
  assert.equal(patch.imagePrompt, '参考@图片四和@图片六');
  assert.match(patch.universalVideoPrompt!, /<Picture 4>/);
  assert.match(patch.universalVideoPrompt!, /Preserve <Picture 6>/);
  assert.match(patch.universalVideoPrompt!, /\n\nsummary:/);
  assert.equal(patch.promptNeedsRefresh, true);
  assert.equal(patch.referenceRevision, 1);
  assert.equal(patch.characterIds, undefined);
  assert.equal(patch.sceneId, undefined);
  assert.equal(patch.videoPath, undefined);
  assert.equal(JSON.stringify({ data, shot }), before);
  assert.equal(buildImageRefBindings({ ...shot, ...patch }, data).filter((ref) => ref.path === '/recorder.png').length, 1);
});

test('already-bound images and repeated additions are idempotent', () => {
  const data = fixture();
  const shot: WsShot = { shotNo: '01-01', sceneId: 'shop', characterIds: ['girl'], description: '', extraRefImages: ['/recorder.png'] };
  assert.deepEqual(buildProjectAssetReferencePatch(shot, data, ['/shop.png', '/girl.png', '/recorder.png']), {});
  assert.deepEqual(buildProjectAssetReferencePatch(shot, data, []), {});
});

test('foreign, removed and unadopted paths fail before any mutation', () => {
  const data = fixture();
  const shot: WsShot = { shotNo: '01-01', sceneId: '', characterIds: [], description: '' };
  const before = JSON.stringify({ data, shot });
  for (const path of ['/project-B/image.png', '/removed.png', '/unadopted.png']) {
    assert.throws(() => buildProjectAssetReferencePatch(shot, data, ['/girl.png', path]), /当前项目资产/);
  }
  assert.equal(JSON.stringify({ data, shot }), before);
});

test('re-adding a removed assigned scene restores its scene slot without changing the scene', () => {
  const data = fixture();
  data.scenes[0].sceneReferenceMode = undefined;
  const shot: WsShot = { shotNo: '01-01', sceneId: 'shop', sceneImagePaths: [], characterIds: [], description: '' };
  const patch = buildProjectAssetReferencePatch(shot, data, ['/shop.png']);
  assert.deepEqual(patch.sceneImagePaths, ['/shop.png']);
  assert.equal(patch.sceneId, undefined);
  assert.equal(patch.extraRefImages, undefined);
  assert.equal(buildImageRefBindings({ ...shot, ...patch }, data)[0].kind, 'scene');
});
