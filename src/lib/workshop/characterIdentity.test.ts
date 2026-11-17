import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { reconcileCharacterIdentity, remapCharacterReferences } from './characterIdentity.ts';
import { normalizeLegacyWorkshopData } from './legacyMigration.ts';
import { emptyWorkshopData, type WsCharacter, type WsShot } from './types.ts';

const role = (id: string, patch: Partial<WsCharacter> = {}): WsCharacter => ({ id, name: '守城将领', appearance: '银甲，长枪', personality: '沉稳，谨慎', ...patch });
const project = () => ({ ...emptyWorkshopData('p1'), characters: [role('general-old')] });

test('new IDs for identical profiles collapse across writes and within one batch', () => {
  const before = project();
  const result = reconcileCharacterIdentity(before, [role('general-new'), role('general-third')]);
  assert.equal(result.data.characters.length, 1);
  assert.equal(result.data.characters[0].id, 'general-old');
  assert.deepEqual(result.data.characterIdAliases, { 'general-new': 'general-old', 'general-third': 'general-old' });
  assert.equal(before.characterIdAliases, undefined);
  const first = reconcileCharacterIdentity(emptyWorkshopData('p1'), [role('a'), role('b')], 'replace');
  assert.equal(first.data.characters.length, 1);
  assert.equal(first.data.characterIdAliases?.b, 'a');
});

test('migration rewires live references, never dialogue, paths or frozen production history', () => {
  const data = project();
  data.characters.push(role('general-new'));
  const shot = {
    shotNo: '01-01', characterIds: ['general-new', 'general-old'], voiceCharacterIds: ['general-new'],
    physicalCharacterIds: ['general-new'], visibleCharacterIds: ['general-new'], screenCharacterIds: ['general-new'],
    continuitySnapshot: { visibleCharacters: [{ id: 'general-new', presence: 'physical' }, { id: 'general-old', presence: 'physical' }], props: [{ id: 'general-new', holder: 'general-new', state: 'held' }] },
    propIds: ['general-new'], dialogue: 'general-new', videoPrompt: 'general-new', videoPath: '/general-new.mp4',
    audioPrompts: [{ characterId: 'general-new', prompt: '原文' }],
    generatedAudios: [{ characterId: 'general-new', path: '/voice.wav' }],
    actionTimeline: { segments: [{ track: 'body', subject: 'general-new' }, { track: 'prop', subject: 'general-new' }] },
    lastProductionPacket: { prompt: 'general-new', characterIds: ['general-new'] },
    videoCandidates: [{ path: '/paid.mp4', productionPacket: { characterIds: ['general-new'] } }],
  } as unknown as WsShot;
  data.shots = [shot];
  data.bibles = { character: { rules: [{ characterId: 'general-new', lockedAppearance: '银甲', costumeRules: [] }], globalRules: [], updatedAt: 1 } };
  data.characterHandoffs = [{ id: 'h', characterId: 'general-new', sourceEpisode: '1', targetEpisode: '2', inheritedState: '未变', intendedChange: '无', shotIds: [], createdAt: 1 }];
  const result = reconcileCharacterIdentity(data);
  const next = result.data.shots[0];
  for (const key of ['characterIds', 'physicalCharacterIds', 'visibleCharacterIds', 'screenCharacterIds', 'voiceCharacterIds'] as const) assert.deepEqual(next[key], ['general-old']);
  assert.equal(next.audioPrompts?.[0].characterId, 'general-old');
  assert.equal(next.generatedAudios?.[0].characterId, 'general-old');
  assert.equal(next.actionTimeline?.segments[0].subject, 'general-old');
  assert.equal(next.actionTimeline?.segments[1].subject, 'general-new');
  assert.deepEqual(next.continuitySnapshot?.visibleCharacters, [{ id: 'general-old', presence: 'physical' }]);
  assert.equal(next.continuitySnapshot?.props?.[0].id, 'general-new');
  assert.equal(next.continuitySnapshot?.props?.[0].holder, 'general-old');
  assert.deepEqual(next.propIds, shot.propIds);
  assert.equal(next.dialogue, shot.dialogue);
  assert.equal(next.videoPrompt, shot.videoPrompt);
  assert.equal(next.videoPath, shot.videoPath);
  assert.deepEqual(next.lastProductionPacket, shot.lastProductionPacket);
  assert.deepEqual(next.videoCandidates, shot.videoCandidates);
  assert.equal(next.promptNeedsRefresh, true);
  assert.equal(result.data.bibles?.character?.rules[0].characterId, 'general-old');
  assert.equal(result.data.characterHandoffs?.[0].characterId, 'general-old');
  assert.deepEqual(data.shots[0].characterIds, ['general-new', 'general-old']);
  assert.equal(reconcileCharacterIdentity(result.data).changed, false);
});

test('preserves selected image, all paid candidates and voice from duplicate records', () => {
  const data = project();
  data.characters[0].assetImagePath = '/original.png';
  data.characters[0].assetProductionBinding = { path: '/original.png', candidateFingerprint: 'c', reviewFingerprint: 'r', boundAt: 1 };
  const result = reconcileCharacterIdentity(data, [role('other', { assetImagePath: '/paid.png', voicePath: '/voice.mp3', candidates: [{ path: '/paid.png', source: 'generate', createdAt: 2 }] })]);
  const character = result.data.characters[0];
  assert.equal(character.assetImagePath, '/original.png');
  assert.equal(character.assetProductionBinding?.path, '/original.png');
  assert.deepEqual(new Set(character.candidates?.map((c) => c.path)), new Set(['/original.png', '/paid.png']));
  assert.equal(character.voicePath, '/voice.mp3');
});

test('does not combine homonyms, distinct life stages, conflicting voices or placeholders', () => {
  for (const patch of [
    { appearance: '少年，布衣' }, { personality: '急躁' },
    { lifecycleStages: [{ stage: '年少', appearance: '布衣' }] },
    { name: '同名不同字' },
  ]) assert.equal(reconcileCharacterIdentity(project(), [role('other', patch)]).data.characters.length, 2);
  const blank = { ...project(), characters: [role('a', { name: '新角色', appearance: '', personality: '' })] };
  assert.equal(reconcileCharacterIdentity(blank, [role('b', { name: '新角色', appearance: '', personality: '' })]).data.characters.length, 2);
  const voiced = project(); voiced.characters[0].voicePath = '/a.mp3';
  assert.equal(reconcileCharacterIdentity(voiced, [role('b', { voicePath: '/b.mp3' })]).data.characters.length, 2);
});

test('same-ID edits and historical alias edits remain possible, while late shot writes use canonical IDs', () => {
  const merged = reconcileCharacterIdentity(project(), [role('new')]).data;
  const edited = reconcileCharacterIdentity(merged, [{ id: 'new', personality: '已修改' }]).data;
  assert.equal(edited.characters.length, 1);
  assert.equal(edited.characters[0].personality, '已修改');
  assert.deepEqual(remapCharacterReferences({ characterIds: ['new'], audioPrompts: [{ characterId: 'new', prompt: '对白' }] }, edited.characterIdAliases),
    { characterIds: ['general-old'], audioPrompts: [{ characterId: 'general-old', prompt: '对白' }] });
});

test('replace mode still drops omitted roles but retains assets of identical re-IDed roles', () => {
  const data = project(); data.characters[0].assetImagePath = '/selected.png';
  data.characters.push(role('other', { name: '信使' }));
  const result = reconcileCharacterIdentity(data, [role('new')], 'replace').data;
  assert.equal(result.characters.length, 1);
  assert.equal(result.characters[0].assetImagePath, '/selected.png');
  assert.equal(result.characters[0].id, 'general-old');
});

test('legacy opening migrates duplicates and is idempotent', () => {
  const data = project(); data.characters.push(role('new'));
  const first = normalizeLegacyWorkshopData(data, data.projectId);
  assert.equal(first.changed, true);
  assert.equal(first.data.characters.length, 1);
  assert.equal(normalizeLegacyWorkshopData(first.data, data.projectId).changed, false);
});

test('AI breakdown, upsert, reload and later shot writes share the identity repair', () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const store = source('../../stores/workshopStore.ts');
  const tools = source('../agent/tools/workshopTools.ts');
  assert.match(store, /reconcileCharacterIdentity\(data, chars\)/);
  assert.match(store, /reconcileCharacterIdentity\(parsed\)/);
  assert.match(store, /shots = remapCharacterReferences\(shots, data.characterIdAliases\)/);
  assert.match(store, /patch = remapCharacterReferences\(patch, data.characterIdAliases\)/);
  assert.match(tools, /reconcileCharacterIdentity\(data!, characterPatches/);
  assert.match(tools, /\.\.\.characterIdentity.data/);
  assert.match(tools, /remapCharacterReferences\(params.shots/);
});
