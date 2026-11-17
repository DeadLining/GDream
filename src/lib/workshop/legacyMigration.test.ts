import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLegacyWorkshopData } from './legacyMigration.ts';
import { emptyWorkshopData } from './types.ts';

test('normalizes a legacy project without dropping prompts, assets or candidates', () => {
  const legacy = {
    projectId: 'old-id',
    synopsis: '旧项目梗概',
    characters: [{ id: 'c1', name: '林砚', description: '灰布衣', assetImagePath: '/assets/linyan.png' }],
    scenes: [{ id: 's1', name: '广场', description: '青石高台', assetImagePath: '/assets/square.png' }],
    shots: [{
      shotNo: '01-01',
      description: '接住婚书',
      imagePrompt: '旧图片提示词',
      videoPrompt: '旧视频提示词',
      videoPath: '/shots/01.mp4',
      videoCandidates: [{ path: '/shots/01.mp4', source: 'generate', createdAt: 10 }],
    }],
  };

  const { data, changed } = normalizeLegacyWorkshopData(legacy, 'project-new', 100);
  assert.equal(changed, true);
  assert.equal(data.projectId, 'project-new');
  assert.equal(data.synopsis, '旧项目梗概');
  assert.equal(data.characters[0].assetImagePath, '/assets/linyan.png');
  assert.equal(data.characters[0].candidates?.[0].path, '/assets/linyan.png');
  assert.equal(data.scenes[0].candidates?.[0].path, '/assets/square.png');
  assert.equal(data.shots[0].imagePrompt, '旧图片提示词');
  assert.equal(data.shots[0].videoPrompt, '旧视频提示词');
  assert.equal(data.shots[0].videoPath, '/shots/01.mp4');
  assert.equal(data.shots[0].videoCandidates?.[0].path, '/shots/01.mp4');
  assert.deepEqual(data.shots[0].characterIds, []);
  assert.deepEqual(data.shots[0].propIds, []);
  assert.deepEqual(data.shots[0].voiceCharacterIds, []);
  assert.match(data.shots[0].id ?? '', /^shot-project-new-legacy-/);
});

test('repairs duplicate legacy shot ids deterministically', () => {
  const { data } = normalizeLegacyWorkshopData({
    projectId: 'p1', synopsis: '', currentStep: 'script', steps: {},
    scriptRevisions: [], episodes: [], narrativeBeats: [], characters: [], scenes: [], props: [], colorPalettes: [], changelog: [],
    shots: [
      { id: 'duplicate', shotNo: '01-01', description: '', characterIds: [], propIds: [], voiceCharacterIds: [] },
      { id: 'duplicate', shotNo: '01-02', description: '', characterIds: [], propIds: [], voiceCharacterIds: [] },
    ],
  }, 'p1', 100);
  assert.equal(data.shots[0].id, 'duplicate');
  assert.equal(data.shots[1].id, 'shot-p1-legacy-2');
});

test('does not invent a valid production fingerprint for incomplete legacy packets', () => {
  const { data } = normalizeLegacyWorkshopData({
    projectId: 'p1', synopsis: '', currentStep: 'script', steps: {},
    scriptRevisions: [], episodes: [], narrativeBeats: [], characters: [], scenes: [], props: [], colorPalettes: [], changelog: [],
    shots: [{
      shotNo: '01-01', description: '', characterIds: [], propIds: [], voiceCharacterIds: [],
      lastProductionPacket: { model: 'legacy' },
    }],
  }, 'p1', 100);
  assert.equal(data.shots[0].lastProductionPacket?.inputFingerprint, '');
  assert.equal(data.shots[0].lastProductionPacket?.projectId, 'p1');
  assert.equal(data.shots[0].lastProductionPacket?.shotNo, '01-01');
});



test('legacy workshop load drops candidates whose paths were explicitly deleted', () => {
  const result = normalizeLegacyWorkshopData({
    ...emptyWorkshopData('p1'),
    shots: [{
      id: 'shot-a',
      shotNo: '01-01',
      description: 'A',
      characterIds: [],
      videoCandidates: [{
        candidateId: 'video-shot-a-job-1',
        path: '/tmp/shot-01.mp4',
        source: 'canvas',
        originNodeId: 'node-canvas-video-1',
        createdAt: 1,
      }],
      deletedVideoCandidateNodeIds: ['node-canvas-video-1'],
    }],
  }, 'p1', 100);
  assert.deepEqual(result.data.shots[0].videoCandidates, []);
  assert.equal(result.changed, true);
});

test('legacy workshop load removes whitebox-only fields and unreadable Blender references', () => {
  const result = normalizeLegacyWorkshopData({
    ...emptyWorkshopData('p1'),
    shots: [{
      id: 'shot-a',
      shotNo: '01-01',
      description: 'A',
      characterIds: [],
      extraRefImages: ['/tmp/white_model_preview.png', '/assets/keep.png'],
      stageBImagePath: '/tmp/white_model_preview.png',
      directorPrevisVideoPaths: ['/tmp/director-previs.mp4'],
      firstFrameMode: 'whitebox',
      directorDecisionRequired: true,
    }],
  }, 'p1', 100);
  const shot = result.data.shots[0] as unknown as Record<string, unknown>;
  assert.deepEqual(shot.extraRefImages, ['/assets/keep.png']);
  for (const key of ['stageBImagePath', 'directorPrevisVideoPaths', 'firstFrameMode', 'directorDecisionRequired']) {
    assert.equal(key in shot, false, `${key} should be removed`);
  }
  assert.equal(result.changed, true);
});
