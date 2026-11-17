import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBreakdownInput } from './breakdownValidation.ts';

const valid = {
  synopsis: '一个人发现门缝透光并决定推门。',
  episodes: [{ no: '1', title: '第一集', sceneList: 'S1' }],
  scenes: [{ id: 's1', name: '走廊', description: '狭窄走廊，冷光从门缝透出。' }],
  narrativeBeats: [{ id: 'b1', sceneId: 's1', title: '发现门缝透光', purpose: '信息' as const }],
  characters: [{ id: 'c1', name: '林风', personality: '谨慎', appearance: '黑色外套，短发。' }],
  props: [],
};

test('accepts a structurally complete Scene → Beat breakdown', () => {
  assert.deepEqual(validateBreakdownInput(valid), []);
});

test('rejects duplicate ids and beats pointing at unknown scenes', () => {
  const errors = validateBreakdownInput({
    ...valid,
    scenes: [...valid.scenes, { id: 's1', name: '门内', description: '昏暗房间。' }],
    narrativeBeats: [{ ...valid.narrativeBeats[0], sceneId: 'missing', purpose: '多个动作' as never }],
  });
  assert.equal(errors.some((error) => error.includes('Scene id 重复：s1')), true);
  assert.equal(errors.some((error) => error.includes('不存在的 Scene')), true);
  assert.equal(errors.some((error) => error.includes('purpose 必须')), true);
});

test('supports partial validation for downstream enrichment', () => {
  assert.equal(validateBreakdownInput({ synopsis: '保留事实' }, false).includes('至少需要一个 Scene'), false);
});

test('product ads accept explicitly empty cast without weakening structural validation', () => {
  const ad = { ...valid, creativeSpec: { workKind: 'product-ad' }, characters: [] };
  assert.deepEqual(validateBreakdownInput(ad), []);
  assert.ok(validateBreakdownInput({ ...ad, characters: undefined }).some(e => e.includes('角色')));
  assert.ok(validateBreakdownInput({ ...valid, characters: [] }).some(e => e.includes('角色')));
  assert.ok(validateBreakdownInput({ ...ad, scenes: [] }).some(e => e.includes('Scene')));
});
