import assert from 'node:assert/strict';
import test from 'node:test';
import { characterHandoffsAreValid, validateCharacterHandoffs } from './characterContinuity.ts';
import type { WorkshopData } from './types.ts';

function data(): Pick<WorkshopData, 'episodes' | 'characters' | 'shots' | 'characterHandoffs'> {
  return {
    episodes: [{ no: '1', title: '一', sceneList: 's1' }, { no: '2', title: '二', sceneList: 's2' }],
    characters: [{ id: 'hero', name: '主角', personality: '', appearance: '短发' }],
    shots: [{ id: 'shot-2', shotNo: '02-01', episode: '2', description: '主角抬头', characterIds: ['hero'] }],
    characterHandoffs: [],
  };
}

test('validates an explicit cross-episode character handoff', () => {
  const input = data();
  input.characterHandoffs = [{ id: 'h1', characterId: 'hero', sourceEpisode: '1', targetEpisode: '2', inheritedState: '右手持钥匙，神情警惕', intendedChange: '进入受伤状态', shotIds: ['shot-2'], visualHandoff: { mode: 'preserve', sourceVariantId: 'hero-night', targetVariantId: 'hero-night' }, createdAt: 1 }];
  assert.equal(characterHandoffsAreValid(input), true);
});

test('points at the valid target-episode shots when a handoff binds the source tail shot', () => {
  // Real case: 1→2 handoff bound shot 01-10 (source episode tail) instead of a
  // 02-xx shot. The error must name the legal target-episode candidates so the
  // model can repair the exact field instead of guessing again.
  const input = data();
  input.shots = [
    { id: 'shot-1-10', shotNo: '01-10', episode: '1', description: '第一集收尾', characterIds: ['hero'] },
    { id: 'shot-2-01', shotNo: '02-01', episode: '2', description: '第二集开场', characterIds: ['hero'] },
    { id: 'shot-2-02', shotNo: '02-02', episode: '2', description: '第二集推进', characterIds: ['hero'] },
  ];
  input.characterHandoffs = [{
    id: 'handoff-01-02-hero', characterId: 'hero', sourceEpisode: '1', targetEpisode: '2',
    inheritedState: '右手持钥匙', intendedChange: '进入受伤状态',
    shotIds: ['shot-1-10'], createdAt: 1,
  }];
  const messages = validateCharacterHandoffs(input).map((issue) => issue.message);
  const missingTarget = messages.find((message) => message.includes('缺少 targetEpisode 2 的落点镜头'));
  assert.ok(missingTarget, `expected a missing-target-landing message, got: ${messages.join(' | ')}`);
  assert.match(missingTarget!, /只绑定了源集镜头/);
  assert.match(missingTarget!, /02-01/);
  assert.match(missingTarget!, /02-02/);
});

test('accepts source tail + target landing together, and accepts shotNo instead of id', () => {
  const input = data();
  input.shots = [
    { id: 'shot-1-10', shotNo: '01-10', episode: '1', description: '第一集收尾', characterIds: ['hero'] },
    { id: 'shot-2-01', shotNo: '02-01', episode: '2', description: '第二集开场', characterIds: ['hero'] },
  ];
  // Reference the source tail by shotNo and the target landing by shotNo too.
  input.characterHandoffs = [{
    id: 'handoff-01-02-hero', characterId: 'hero', sourceEpisode: '1', targetEpisode: '2',
    inheritedState: '右手持钥匙', intendedChange: '进入受伤状态',
    shotIds: ['01-10', '02-01'], createdAt: 1,
  }];
  assert.deepEqual(validateCharacterHandoffs(input), []);
});

test('rejects guessed or stale cross-episode handoffs', () => {
  const input = data();
  input.characterHandoffs = [{ id: 'h1', characterId: 'hero', sourceEpisode: '2', targetEpisode: '1', inheritedState: '', intendedChange: '', shotIds: ['missing'], visualHandoff: { mode: 'change', sourceVariantId: 'same', targetVariantId: 'same' }, createdAt: 1 }];
  const messages = validateCharacterHandoffs(input).map((issue) => issue.message);
  assert.ok(messages.some((message) => message.includes('sourceEpisode 必须严格早于 targetEpisode')));
  assert.ok(messages.some((message) => message.includes('不能让系统猜测跨集状态')));
  assert.ok(messages.some((message) => message.includes('未找到绑定镜头 missing')));
  assert.ok(messages.some((message) => message.includes('visualHandoff=change')));
});
