import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCharacterBibleRules } from './bibleNormalization.ts';
import type { WsCharacter } from './types.ts';

const characters = [
  { id: 'erlangshen', name: '二郎神（杨戬）', appearance: '银冠玄甲', personality: '沉稳' },
  { id: 'sasuke', name: '宇智波佐助', appearance: '深色忍服', personality: '冷傲' },
] as WsCharacter[];

test('reconstructs indexed legacy character rules and binds them by canonical name', () => {
  const indexed = (text: string) => Object.fromEntries([...text].map((char, index) => [String(index), char]));
  const result = normalizeCharacterBibleRules([
    indexed('二郎神额心竖眼闭合为细线，睁开为金色瞳仁。'),
    indexed('佐助左眼在第六回合转为轮回眼。'),
    indexed('全片保持人物身高比例。'),
  ], characters, ['既有全局规则']);

  assert.equal(result.rules.length, 2);
  assert.equal(result.rules[0].characterId, 'erlangshen');
  assert.match(result.rules[0].lockedAppearance, /二郎神额心竖眼/);
  assert.equal(result.rules[1].characterId, 'sasuke');
  assert.deepEqual(result.globalRules, ['既有全局规则', '全片保持人物身高比例。']);
});

test('keeps valid structured character rules and never emits index-keyed fields', () => {
  const result = normalizeCharacterBibleRules([
    { characterId: 'sasuke', lockedAppearance: '右臂全程缠白色绷带。', costumeRules: ['不换装'], lifecycleRules: ['第六回合后保持破损'] },
  ], characters);

  assert.deepEqual(result.rules, [{
    characterId: 'sasuke',
    lockedAppearance: '右臂全程缠白色绷带。',
    costumeRules: ['不换装'],
    voiceRules: undefined,
    lifecycleRules: ['第六回合后保持破损'],
  }]);
  assert.deepEqual(result.globalRules, []);
});

test('repairs corrupted persisted data before identity reconciliation', async () => {
  const { normalizeLegacyWorkshopData } = await import('./legacyMigration.ts');
  const indexed = (text: string) => Object.fromEntries([...text].map((char, index) => [String(index), char]));
  const data = {
    projectId: 'p1', synopsis: '', currentStep: 'breakdown', steps: {},
    scriptRevisions: [], episodes: [], narrativeBeats: [], characters, scenes: [], props: [], colorPalettes: [], shots: [], changelog: [],
    bibles: { character: { rules: [indexed('佐助右臂与左腿全程缠白色绷带。')], globalRules: [], updatedAt: 1 } },
  };
  const result = normalizeLegacyWorkshopData(data, 'p1', 100);
  assert.equal(result.changed, true);
  assert.equal(result.data.bibles?.character?.rules[0].characterId, 'sasuke');
  assert.equal(normalizeLegacyWorkshopData(result.data, 'p1', 100).changed, false);
});
