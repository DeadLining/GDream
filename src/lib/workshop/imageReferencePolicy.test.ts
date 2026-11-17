import test from 'node:test';
import assert from 'node:assert/strict';
import {
  imageReferenceLimitForEngine,
  imageReferenceIndexMap,
  imageReferenceProjectionPrompt,
  projectImageReferencesForProvider,
  remapImageReferenceMentions,
} from './imageReferencePolicy.ts';

test('declares the routed image reference limits', () => {
  assert.equal(imageReferenceLimitForEngine('gpt-image-2'), 10);
  assert.equal(imageReferenceLimitForEngine('seedream-v5-pro'), 10);
  assert.equal(imageReferenceLimitForEngine('midjourney-v82'), 10);
  assert.equal(imageReferenceLimitForEngine('other-image-model'), Number.POSITIVE_INFINITY);
});

test('keeps all references and their original order within the provider limit', () => {
  const references = [
    { path: '/scene.png', label: '主场景', kind: 'scene' as const },
    { path: '/character.png', label: '角色', kind: 'character' as const },
  ];
  const result = projectImageReferencesForProvider({ engineId: 'gpt-image-2', references });
  assert.deepEqual(result.selected, references);
  assert.equal(result.omitted.length, 0);
});

test('reserves the current start frame and prioritizes continuity, characters, scene and props', () => {
  const result = projectImageReferencesForProvider({
    engineId: 'seedream-v5-pro',
    references: [
      { path: '/start.png', label: '当前镜首帧', kind: 'start-frame', required: true },
      ...Array.from({ length: 4 }, (_, index) => ({ path: `/angle-${index}.png`, label: `场景角度 ${index + 2}`, kind: 'scene' as const })),
      ...Array.from({ length: 4 }, (_, index) => ({ path: `/character-${index}.png`, label: `角色 ${index + 1}`, kind: 'character' as const })),
      { path: '/scene.png', label: '场景 主视图', kind: 'scene' as const },
      { path: '/prop.png', label: '道具', kind: 'prop' as const },
      { path: '/tail.png', label: '上一镜尾帧', kind: 'previous-tail' as const },
      { path: '/palette.png', label: '色卡', kind: 'palette' as const },
    ],
  });
  assert.equal(result.selected.length, 10);
  assert.equal(result.selected[0].kind, 'start-frame');
  assert.ok(result.selected.some((item) => item.kind === 'previous-tail'));
  assert.ok(result.selected.some((item) => item.label === '场景 主视图'));
  assert.ok(result.selected.some((item) => item.kind === 'prop'));
  assert.ok(result.omitted.some((item) => item.kind === 'palette'));
  assert.match(imageReferenceProjectionPrompt(result), /实际提交/);
});

test('remaps kept image mentions and removes references that were not submitted', () => {
  const projection = projectImageReferencesForProvider({
    engineId: 'gpt-image-2',
    references: [
      { path: '/start.png', label: '当前镜首帧', kind: 'start-frame', required: true },
      { path: '/scene.png', label: '场景', kind: 'scene', sourceIndex: 1 },
      { path: '/character.png', label: '角色', kind: 'character', sourceIndex: 3 },
    ],
  });
  const remapped = remapImageReferenceMentions(
    '场景@图片一，角色@图片三，未提交@图片二；Combine <Picture 3> and <Picture 2>.',
    imageReferenceIndexMap(projection),
  );
  assert.match(remapped, /场景@图片二/);
  assert.match(remapped, /角色@图片三/);
  assert.doesNotMatch(remapped, /@图片二；Combine <Picture 3> and <Picture 2>/);
  assert.match(remapped, /<Picture 3>/);
  assert.doesNotMatch(remapped, /<Picture 2>/);
});
