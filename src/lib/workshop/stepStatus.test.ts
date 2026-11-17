import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyWorkshopData } from './types.ts';
import { breakdownActionLabel, breakdownCompletionReasons, reasonsForStepCompletion } from './stepStatus.ts';
import { acceptVideoCandidate, videoCandidateFingerprint } from './productionLifecycle.ts';
import type { WsShot } from './types.ts';

test('step completion requires a script source but accepts saved shots without review', () => {
  const data = emptyWorkshopData('p1');
  assert.deepEqual(reasonsForStepCompletion({ data, project: { sources: [] }, step: 'script' }), ['尚未导入剧本源文件']);
  data.synopsis = '故事';
  data.episodes = [{ no: '1', title: '第一集', sceneList: '场景一' }];
  data.characters = [{ id: 'c1', name: '角色', personality: '', appearance: '' }];
  data.scenes = [{ id: 's1', name: '场景', description: '' }];
  data.shots = [{ shotNo: '1-1-1', description: '', dialogue: '', characterIds: [], propIds: [], durationSec: 5 }];
  const reasons = reasonsForStepCompletion({ data, project: { sources: [{ name: 'script.md', type: 'md', size: 1, uploadedAt: 1 }] }, step: 'breakdown' });
  assert.deepEqual(reasons, []);
});

test('asset completion rejects generated candidates without input fingerprint', () => {
  const data = emptyWorkshopData('p1');
  data.characters = [{
    id: 'c1', name: '角色', personality: '', appearance: '', assetImagePath: '/tmp/a.png',
    candidates: [{ path: '/tmp/a.png', source: 'generate', checksum: 'sha', createdAt: 1 }],
  }];
  const reasons = reasonsForStepCompletion({ data, project: { sources: [{ name: 'script.md', type: 'md', size: 1, uploadedAt: 1 }] }, step: 'assets' });
  assert.match(reasons[0] ?? '', /角色角色/);
});

test('handoff cannot be completed by the agent tool', () => {
  const data = emptyWorkshopData('p1');
  assert.deepEqual(reasonsForStepCompletion({ data, project: { sources: [{ name: 'script.md', type: 'md', size: 1, uploadedAt: 1 }] }, step: 'handoff' }), [
    '交付步骤只能通过交付界面的 manifest 门禁完成，不能由 Agent 直接标记 done。',
  ]);
});

test('breakdown completion ignores legacy failed reviews', () => {
  const data = emptyWorkshopData('p1');
  data.synopsis = '故事';
  data.episodes = [{ no: '1', title: '第一集', sceneList: '场景一' }];
  data.characters = [{ id: 'c1', name: '角色', personality: '', appearance: '短发，深色外套' }];
  data.scenes = [{ id: 's1', name: '场景', description: '室内' }];
  data.narrativeBeats = [{ id: 'b1', sceneId: 's1', title: '发现异常', purpose: '信息', shotNos: ['1-1-1'] }];
  data.shots = [{
    shotNo: '1-1-1',
    sceneId: 's1',
    description: '角色抬头看向门口',
    dialogue: '',
    characterIds: ['c1'],
    propIds: [],
    durationSec: 5,
    narrativeBeat: '发现异常',
    atomicAction: '抬头看向门口',
    planningReview: { status: 'pass', issues: [], reviewedAt: 1 },
  }];
  assert.deepEqual(breakdownCompletionReasons(data), []);
  data.shots[0].planningReview = { status: 'needs-repair', issues: ['动作过载'], reviewedAt: 2 };
  assert.deepEqual(breakdownCompletionReasons(data), []);
});

test('breakdown completion accepts a breakdown where most beats have no atomic shot', () => {
  const data = emptyWorkshopData('p1');
  data.synopsis = '故事';
  data.episodes = [{ no: '1', title: '第一集', sceneList: '场景一' }];
  data.characters = [{ id: 'c1', name: '角色', personality: '', appearance: '短发' }];
  data.scenes = [{ id: 's1', name: '场景一', description: '训练室' }];
  data.narrativeBeats = [
    { id: 'b1', sceneId: 's1', title: '复盘起点', purpose: '信息' },
    { id: 'b2', sceneId: 's1', title: '承受失误压力', purpose: '情绪' },
    { id: 'b3', sceneId: 's1', title: '教练坚持单一结果', purpose: '关系' },
  ];
  data.shots = [{
    shotNo: '01-01',
    sceneId: 's1',
    narrativeBeat: 'b1',
    description: '角色坐在操作位',
    characterIds: ['c1'],
    propIds: [],
    durationSec: 8,
    atomicAction: '坐下',
    planningReview: { status: 'pass', issues: [], reviewedAt: 1 },
  }];
  const reasons = breakdownCompletionReasons(data);
  assert.deepEqual(reasons, []);
});

test('breakdown completion still requires at least one saved shot', () => {
  const data = emptyWorkshopData('p1');
  data.synopsis = '故事';
  data.episodes = [{ no: '1', title: '第一集', sceneList: '房间' }];
  data.characters = [{ id: 'c1', name: '角色', personality: '谨慎', appearance: '短发，深色外套' }];
  data.currentScriptRevisionId = 'revision-1';
  data.scriptReview = {
    revisionId: 'revision-1',
    status: 'passed',
    sceneCount: 2,
    beatCount: 3,
    issues: [],
    summary: '通过',
    reviewedAt: 1,
  };
  data.scenes = [{ id: 'scene-1', name: '房间', description: '夜间室内' }];
  data.narrativeBeats = [{ id: 'beat-1', sceneId: 'scene-1', title: '发现', purpose: '信息' }];

  const reasons = breakdownCompletionReasons(data);
  assert.deepEqual(reasons, ['尚未保存分镜，请先写入镜头。']);
});

test('prompt completion reads the H3 universal prompt slot', () => {
  const data = emptyWorkshopData('p1');
  data.shots = [{ shotNo: '1-1-1', description: '镜头', dialogue: '', characterIds: [], propIds: [], durationSec: 5 }];
  data.videoModel = 'minimax-hailuo-h3';
  data.shots[0].videoPrompt = undefined;
  data.shots[0].universalVideoPrompt = 'integrated_multimodal_description: valid';
  data.shots[0].planningReview = { status: 'pass', issues: [], reviewedAt: 1 };
  assert.deepEqual(reasonsForStepCompletion({ data, step: 'prompts' }), []);
});


test('legacy failed planning review does not block prompts, but missing prompt text does', () => {
  const data = emptyWorkshopData('p1');
  data.shots = [{ shotNo: '01-01', description: '', characterIds: [], propIds: [],
    planningReview: { status: 'needs-repair', issues: ['动作过载'], reviewedAt: 1 } }];
  assert.ok(reasonsForStepCompletion({ data, step: 'prompts' }).length > 0);
  data.shots[0].videoPrompt = '作者的提示词';
  assert.deepEqual(reasonsForStepCompletion({ data, step: 'prompts' }), []);
});

test('saved episode 1 does not mean a five-episode breakdown is complete', () => {
  const data = emptyWorkshopData('p');
  data.episodes = Array.from({ length: 5 }, (_, i) => ({ no: String(i + 1), title: '', sceneList: '' }));
  data.shots = [{ shotNo: '01-01', description: '', characterIds: [] }];
  assert.match(breakdownCompletionReasons(data).join(''), /2、3、4、5/);
  data.shots.push(...[2, 3, 4, 5].map((no) => ({ shotNo: `0${no}-01`, description: '', characterIds: [] })));
  assert.deepEqual(breakdownCompletionReasons(data), []);
});

test('reconcileWorkshopSteps repairs persisted badges without mounting a step page', async () => {
  const data = emptyWorkshopData('p1');
  data.currentStep = 'generate';
  for (const step of Object.values(data.steps)) step.status = 'done';
  data.shots = [{ shotNo: '1-1-1', description: '镜头', dialogue: '', characterIds: [], propIds: [], durationSec: 5, videoPrompt: 'video' }];
  const { reconcileWorkshopSteps } = await import('./stepStatus.ts');
  const next = reconcileWorkshopSteps(data, { sources: [{ name: 'script.md', type: 'md', size: 1, uploadedAt: 1 }] });
  assert.equal(next.steps.assets.status, 'done');
  assert.equal(next.steps.prompts.status, 'done');
  assert.equal(next.steps.generate.status, 'in-progress');
  assert.equal(next.currentStep, 'generate');
});

test('reconcileWorkshopSteps moves a stale future current step back to the first unmet gate', async () => {
  const data = emptyWorkshopData('p1');
  data.currentStep = 'generate';
  for (const step of Object.values(data.steps)) step.status = 'done';
  data.shots = [];
  const { reconcileWorkshopSteps } = await import('./stepStatus.ts');
  const next = reconcileWorkshopSteps(data, { sources: [] });
  assert.equal(next.currentStep, 'script');
  assert.equal(next.steps.script.status, 'in-progress');
  assert.equal(next.steps.breakdown.status, 'in-progress');
});

test('breakdown action distinguishes saved planning from actual shot progress', () => {
  const data = emptyWorkshopData('planning-only');
  data.synopsis = '已生成故事规划';
  data.episodes = [{ no: '1', title: '第一集', sceneList: '山门' }];
  data.characters = [{ id: 'c1', name: '角色', personality: '', appearance: '' }];
  assert.equal(breakdownActionLabel({
    scriptNeedsRepair: false, shotCount: data.shots.length,
    incomplete: breakdownCompletionReasons(data).length > 0,
  }), 'AI 拆解');
  assert.equal(breakdownActionLabel({ scriptNeedsRepair: false, shotCount: 5, incomplete: true }), '继续 AI 拆解');
  assert.equal(breakdownActionLabel({ scriptNeedsRepair: false, shotCount: 35, incomplete: false }), '重新拆解');
  assert.equal(breakdownActionLabel({ scriptNeedsRepair: true, shotCount: 0, incomplete: true }), 'AI 修订剧本');
});

test('stale breakdown heals only with current revision source receipts', async () => {
  const { reconcileWorkshopSteps } = await import('./stepStatus.ts');
  const { breakdownWorkUnits, recordBreakdownWork } = await import('./breakdownQueue.ts');
  const data = emptyWorkshopData('p1');
  data.currentScriptRevisionId = 'rev1';
  data.episodes = [{ no: '1', title: '广告', sceneList: '', script: '产品在桌上展示。', scriptStatus: 'draft' }];
  data.shots = [{ shotNo: '01-01', description: '产品展示', characterIds: [], propIds: [], durationSec: 8, sourceScriptRevisionId: 'rev1' }];
  data.steps.breakdown.status = 'stale';
  assert.equal(reconcileWorkshopSteps(data).steps.breakdown.status, 'stale');
  data.breakdownWork = recordBreakdownWork(data, breakdownWorkUnits(data)[0].id, ['01-01'], true);
  assert.equal(reconcileWorkshopSteps(data).steps.breakdown.status, 'done');
  data.episodes[0].script += '新的剧情。';
  assert.equal(reconcileWorkshopSteps(data).steps.breakdown.status, 'stale');
});

function completedVideo(shotNo: string, now = 200): WsShot {
  const candidate = { path: `/tmp/${shotNo}.mp4`, source: 'generate' as const, createdAt: 1 };
  const accepted = acceptVideoCandidate({
    candidates: [candidate], path: candidate.path,
    expectedFingerprint: videoCandidateFingerprint(candidate), now,
  });
  return {
    shotNo, description: '', characterIds: [], videoPrompt: 'prompt',
    videoPath: candidate.path, videoCandidates: [candidate],
    videoReviews: [accepted.review], videoProductionBinding: accepted.binding,
  };
}

test('stale generation heals from adopted videos without requiring delivery metadata', async () => {
  const { reconcileWorkshopSteps } = await import('./stepStatus.ts');
  const data = emptyWorkshopData('p1');
  data.shots = [completedVideo('01-01'), completedVideo('01-02')];
  data.shots[1].videoCandidates = [];
  data.steps.generate = { status: 'stale', updatedAt: 100 };
  data.steps.prompts.status = 'stale';
  const next = reconcileWorkshopSteps(data);
  assert.deepEqual(reasonsForStepCompletion({ data, step: 'generate' }), []);
  assert.equal(next.steps.generate.status, 'done');
  assert.equal(next.steps.prompts.status, 'stale', 'other upstream warnings must be preserved');
  assert.equal(next.steps.handoff.status, 'pending', 'generation completion is not delivery approval');
  assert.equal(data.steps.generate.status, 'stale', 'reconciliation is pure');
});

test('generation stays stale when upstream changed after any adoption', async () => {
  const { reconcileGenerationStepState } = await import('./stepStatus.ts');
  const shots = [completedVideo('01-01', 90), completedVideo('01-02', 200)];
  const current = { status: 'stale' as const, updatedAt: 100 };
  assert.equal(reconcileGenerationStepState(shots, current), current);
  shots[0] = completedVideo('01-01', 300);
  assert.equal(reconcileGenerationStepState(shots, current).status, 'done');
});

test('generated but unadopted videos and empty projects do not complete generation', async () => {
  const { reconcileGenerationStepState } = await import('./stepStatus.ts');
  const data = emptyWorkshopData('p1');
  assert.ok(reasonsForStepCompletion({ data, step: 'generate' }).length > 0);
  const shot = completedVideo('01-01');
  shot.videoProductionBinding = undefined;
  data.shots = [shot];
  assert.match(reasonsForStepCompletion({ data, step: 'generate' }).join(''), /01-01/);
  assert.equal(reconcileGenerationStepState(data.shots, { status: 'done', updatedAt: 100 }).status, 'in-progress');
  assert.equal(reconcileGenerationStepState([], { status: 'pending', updatedAt: 100 }).status, 'pending');
  assert.equal(reconcileGenerationStepState(data.shots, { status: 'stale', updatedAt: 100 }).status, 'stale');
});
