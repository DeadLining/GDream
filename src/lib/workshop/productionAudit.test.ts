import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from './types.ts';
import { buildProductionAudit } from './productionAudit.ts';
import { acceptAssetCandidate, assetCandidateFingerprint } from './assetLineage.ts';
import { acceptVideoCandidate, videoCandidateFingerprint } from './productionLifecycle.ts';

test('production audit blocks unfrozen and incomplete projects', () => {
  const report = buildProductionAudit(emptyWorkshopData('p1'));
  assert.equal(report.status, 'blocked');
  assert.equal(report.checks.find((item) => item.id === 'script-revision')?.status, 'blocked');
  assert.equal(report.checks.find((item) => item.id === 'asset-bundle')?.status, 'pass');
});

test('production audit reports current script and atomic-shot readiness', () => {
  const data = emptyWorkshopData('p1');
  data.currentScriptRevisionId = 'rev-1';
  data.steps.breakdown.status = 'done';
  data.shots = [{ shotNo: '01', description: '一个动作', characterIds: [], planningReview: { status: 'pass', issues: [], reviewedAt: 1 } }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'script-revision')?.status, 'pass');
  assert.equal(report.checks.find((item) => item.id === 'script-review')?.status, 'blocked');
  assert.equal(report.checks.find((item) => item.id === 'script-evidence')?.status, 'blocked');
  assert.equal(report.checks.find((item) => item.id === 'project-bibles')?.status, 'blocked');
  assert.equal(report.checks.find((item) => item.id === 'atomic-shots'), undefined);
  assert.equal(report.checks.find((item) => item.id === 'video-output')?.status, 'warn');
  assert.equal(report.checks.find((item) => item.id === 'director-report'), undefined);
});

test('production audit does not evaluate authored shot density', () => {
  const data = emptyWorkshopData('p1');
  data.shots = [{ shotNo: '01', description: '一个动作', characterIds: [], durationSec: 9 }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'director-report'), undefined);
});

test('production audit requires explicit handoff for characters crossing episodes', () => {
  const data = emptyWorkshopData('p1');
  data.shots = [
    { shotNo: '01', episode: '1', description: '主角进入', characterIds: ['hero'] },
    { shotNo: '02', episode: '2', description: '主角醒来', characterIds: ['hero'] },
  ];
  data.characters = [{ id: 'hero', name: '主角', personality: '', appearance: '' }];
  data.episodes = [{ no: '1', title: '一', sceneList: '' }, { no: '2', title: '二', sceneList: '' }];
  const blocked = buildProductionAudit(data);
  assert.equal(blocked.checks.find((item) => item.id === 'character-continuity')?.status, 'blocked');
  data.characterHandoffs = [{ id: 'h1', characterId: 'hero', sourceEpisode: '1', targetEpisode: '2', inheritedState: '站在门口', intendedChange: '醒来后抬头', shotIds: ['02'], createdAt: 1 }];
  const passed = buildProductionAudit(data);
  assert.equal(passed.checks.find((item) => item.id === 'character-continuity')?.status, 'pass');
});

test('production audit revalidates breakdown structure for legacy projects', () => {
  const data = emptyWorkshopData('p1');
  data.steps.breakdown.status = 'done';
  data.synopsis = '故事';
  data.episodes = [{ no: '1', title: '第一集', sceneList: '场景一' }];
  data.characters = [{ id: 'c1', name: '角色', personality: '', appearance: '短发' }];
  data.scenes = [{ id: 's1', name: '场景', description: '室内' }];
  data.narrativeBeats = [{ id: 'b1', sceneId: 'unknown', title: '发现异常', purpose: '信息', shotNos: [] }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'breakdown-structure')?.status, 'blocked');
});

test('production audit requires Draft Review for the current script revision', () => {
  const data = emptyWorkshopData('p1');
  data.currentScriptRevisionId = 'rev-1';
  data.scriptReview = { revisionId: 'rev-old', status: 'passed', sceneCount: 1, beatCount: 1, issues: [], reviewedAt: 1 };
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'script-review')?.status, 'blocked');
  data.scriptReview = { revisionId: 'rev-1', status: 'passed', sceneCount: 2, beatCount: 3, issues: [], reviewedAt: 2 };
  const passed = buildProductionAudit(data);
  assert.equal(passed.checks.find((item) => item.id === 'script-review')?.status, 'pass');
});

test('production audit rejects a stale render binding', () => {
  const data = emptyWorkshopData('p1');
  data.renderCandidates = [{ candidateId: 'render-1', kind: 'render', path: '/tmp/render.mp4', createdAt: 1 }];
  data.renderProductionBinding = {
    candidateId: 'render-1',
    kind: 'render',
    path: '/tmp/old-render.mp4',
    candidateFingerprint: 'render-old',
    reviewFingerprint: 'review-old',
    boundAt: 1,
  };
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'render-lineage')?.status, 'blocked');
  assert.equal(report.checks.find((item) => item.id === 'render-run-mapping')?.status, 'blocked');
});

test('production audit requires input lineage for formal videos', () => {
  const data = emptyWorkshopData('p1');
  data.shots = [{
    shotNo: '01',
    description: '一个动作',
    characterIds: [],
    videoPath: '/tmp/shot.mp4',
    videoCandidates: [{ path: '/tmp/shot.mp4', source: 'generate', createdAt: 1 }],
  }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'video-input-lineage')?.status, 'blocked');
});

test('delivery accepts repeated adoption but still requires the candidate input lineage', () => {
  const data = emptyWorkshopData('p1');
  const candidate = { path: '/tmp/shot.mp4', source: 'generate' as const, createdAt: 1 };
  const accept = (now: number) => acceptVideoCandidate({
    candidates: [candidate], path: candidate.path,
    expectedFingerprint: videoCandidateFingerprint(candidate), now,
  });
  const first = accept(100);
  const second = accept(200);
  data.shots = [{
    shotNo: '01-01', description: '', characterIds: [], videoPath: candidate.path,
    videoCandidates: [candidate], videoReviews: [first.review, second.review],
    videoProductionBinding: second.binding,
  }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'video-binding')?.status, 'pass');
  assert.equal(report.checks.find((item) => item.id === 'video-input-lineage')?.status, 'blocked');
  data.shots[0].videoCandidates = [];
  assert.equal(buildProductionAudit(data).checks.find((item) => item.id === 'video-binding')?.status, 'blocked');
});

test('production audit requires a current production packet for formal videos', () => {
  const data = emptyWorkshopData('p1');
  data.currentScriptRevisionId = 'rev-1';
  data.shots = [{
    shotNo: '01',
    description: '一个动作',
    characterIds: [],
    videoPath: '/tmp/shot.mp4',
    videoCandidates: [{
      path: '/tmp/shot.mp4',
      source: 'generate',
      createdAt: 1,
      inputFingerprint: 'video-input-current',
    }],
    lastProductionPacket: {
      packetVersion: 1,
      projectId: 'p1',
      shotNo: '01',
      sourceScriptRevisionId: 'rev-old',
      model: 'h3',
      engineId: 'h3',
      prompt: '动作',
      referencePaths: [],
      referenceLabels: [],
      audioPaths: [],
      videoPaths: [],
      params: {},
      inputFingerprint: 'video-input-current',
      createdAt: 1,
    },
  }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'production-packet')?.status, 'blocked');
});

test('production audit uses the accepted candidate packet instead of a later failed attempt', () => {
  const data = emptyWorkshopData('p1');
  const packet = {
    packetVersion: 1 as const,
    projectId: 'p1', shotNo: '01', model: 'h3', engineId: 'h3', prompt: '动作',
    referencePaths: [], referenceLabels: [], audioPaths: [], videoPaths: [], params: {},
    inputFingerprint: 'video-input-formal', jobId: 'job-formal', productionRunId: 'production-run-job-formal', createdAt: 1,
  };
  const candidate = {
    path: '/tmp/shot.mp4', source: 'generate' as const, createdAt: 1,
    inputFingerprint: packet.inputFingerprint, productionPacket: packet,
  };
  data.shots = [{
    shotNo: '01', description: '一个动作', characterIds: [], videoPath: candidate.path,
    videoCandidates: [candidate],
    lastProductionPacket: { ...packet, inputFingerprint: 'later-failed-attempt' },
  }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'production-packet')?.status, 'pass');
  assert.equal(report.checks.find((item) => item.id === 'production-run-mapping')?.status, 'pass');
});

test('production audit requires a one-to-one durable job mapping', () => {
  const data = emptyWorkshopData('p1');
  data.shots = [{
    shotNo: '01',
    description: '一个动作',
    characterIds: [],
    videoPath: '/tmp/shot.mp4',
    videoCandidates: [{ path: '/tmp/shot.mp4', source: 'generate', createdAt: 1, inputFingerprint: 'input-1' }],
    lastProductionPacket: {
      packetVersion: 1,
      projectId: 'p1',
      shotNo: '01',
      jobId: 'job-1',
      productionRunId: 'production-run-other',
      model: 'h3',
      engineId: 'h3',
      prompt: '动作',
      referencePaths: [],
      referenceLabels: [],
      audioPaths: [],
      videoPaths: [],
      params: {},
      inputFingerprint: 'input-1',
      createdAt: 1,
    },
  }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'production-run-mapping')?.status, 'blocked');
});

test('production audit requires the persisted run record for new-format projects', () => {
  const data = emptyWorkshopData('p1');
  data.productionRuns = [];
  data.shots = [{
    shotNo: '01',
    description: '一个动作',
    characterIds: [],
    videoPath: '/tmp/shot.mp4',
    videoCandidates: [{ path: '/tmp/shot.mp4', source: 'generate', createdAt: 1, inputFingerprint: 'input-1' }],
    lastProductionPacket: {
      packetVersion: 1,
      projectId: 'p1',
      shotNo: '01',
      jobId: 'job-1',
      productionRunId: 'production-run-job-1',
      model: 'h3',
      engineId: 'h3',
      prompt: '动作',
      referencePaths: [],
      referenceLabels: [],
      audioPaths: [],
      videoPaths: [],
      params: {},
      inputFingerprint: 'input-1',
      createdAt: 1,
    },
  }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'production-run-mapping')?.status, 'blocked');
});

test('production audit requires checksum for selected visual assets', () => {
  const data = emptyWorkshopData('p1');
  data.characters = [{
    id: 'c1', name: '角色', personality: '', appearance: '', assetImagePath: '/tmp/character.png',
  }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'asset-lineage')?.status, 'blocked');
});

test('production audit requires a current accepted asset binding', () => {
  const data = emptyWorkshopData('p1');
  const candidate = {
    candidateId: 'c1-v1',
    path: '/tmp/character.png',
    checksum: 'sha256',
    source: 'upload' as const,
    createdAt: 1,
  };
  data.characters = [{
    id: 'c1', name: '角色', personality: '', appearance: '', assetImagePath: candidate.path,
    candidates: [candidate],
  }];
  const blocked = buildProductionAudit(data);
  assert.equal(blocked.checks.find((item) => item.id === 'asset-binding')?.status, 'blocked');
  const accepted = acceptAssetCandidate({ candidates: [candidate], path: candidate.path, expectedFingerprint: assetCandidateFingerprint(candidate), now: 2 });
  data.characters[0].assetReviews = [accepted.review];
  data.characters[0].assetProductionBinding = accepted.binding;
  const passed = buildProductionAudit(data);
  assert.equal(passed.checks.find((item) => item.id === 'asset-binding')?.status, 'pass');
});

test('production audit warns when accepted videos lack creative review evidence', () => {
  const data = emptyWorkshopData('p1');
  const candidate = { path: '/tmp/shot.mp4', source: 'generate' as const, inputFingerprint: 'input', createdAt: 1 };
  const accepted = acceptVideoCandidate({ candidates: [candidate], path: candidate.path, expectedFingerprint: videoCandidateFingerprint(candidate), now: 2 });
  data.shots = [{ shotNo: '01', description: '一个动作', characterIds: [], videoPath: candidate.path, videoCandidates: [candidate], videoReviews: [accepted.review], videoProductionBinding: accepted.binding }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'creative-review-evidence')?.status, 'warn');
});

test('production audit requires input lineage for generated assets', () => {
  const data = emptyWorkshopData('p1');
  const candidate = {
    candidateId: 'c1-v1',
    path: '/tmp/character.png',
    checksum: 'sha256',
    source: 'generate' as const,
    createdAt: 1,
  };
  data.characters = [{
    id: 'c1', name: '角色', personality: '', appearance: '', assetImagePath: candidate.path,
    candidates: [candidate],
  }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'asset-input-lineage')?.status, 'blocked');
});

test('production audit applies the asset gate to selected color palettes', () => {
  const data = emptyWorkshopData('p1');
  data.colorPalettes = [{
    id: 'palette-1',
    name: '夜景色卡',
    assetImagePath: '/tmp/palette.png',
    candidates: [{ path: '/tmp/palette.png', source: 'upload', createdAt: 1 }],
    createdAt: 1,
  }];
  data.globalColorPaletteId = 'palette-1';
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'asset-lineage')?.status, 'blocked');
  assert.equal(report.checks.find((item) => item.id === 'asset-binding')?.status, 'blocked');
});

test('production audit ignores unused color palettes', () => {
  const data = emptyWorkshopData('p1');
  data.colorPalettes = [{ id: 'palette-unused', name: '未使用色卡', createdAt: 1 }];
  const report = buildProductionAudit(data);
  assert.equal(report.checks.find((item) => item.id === 'asset-bundle')?.status, 'pass');
  assert.equal(report.checks.find((item) => item.id === 'asset-lineage')?.status, 'pass');
});

test('production audit blocks shots that exhausted automatic boundary redraws', () => {
  const data = emptyWorkshopData('p1');
  data.shots = [{
    shotNo: '01',
    description: '一个动作',
    characterIds: [],
    videoStartFramePath: '/tmp/start.png',
    videoEndFramePath: '/tmp/end.png',
    videoBoundaryFrameSignature: 'boundary-current',
    qualityReviewRequiresManualReview: true,
    lastProductionPacket: {
      packetVersion: 1, projectId: 'p1', shotNo: '01', model: 'h3', engineId: 'h3',
      prompt: '动作', referencePaths: ['/tmp/start.png', '/tmp/end.png'], referenceLabels: ['首帧', '尾帧'], audioPaths: [], videoPaths: [],
      params: { h3Task: 'fl2va', boundaryFrames: true }, inputFingerprint: 'input', createdAt: 1,
    },
  }];
  const report = buildProductionAudit(data);
  const qualityCheck = report.checks.find((item) => item.id === 'quality-manual-review');
  assert.equal(qualityCheck?.status, 'blocked');
  assert.match(qualityCheck?.detail ?? '', /01/);
});

test('production audit binds final review to the exact video candidate fingerprint', () => {
  const data = emptyWorkshopData('p1');
  const candidate = { path: '/tmp/shot.mp4', source: 'generate' as const, inputFingerprint: 'input', createdAt: 1 };
  const accepted = acceptVideoCandidate({
    candidates: [candidate],
    path: candidate.path,
    expectedFingerprint: videoCandidateFingerprint(candidate),
    now: 2,
  });
  data.shots = [{
    shotNo: '01', description: '一个动作', characterIds: [],
    videoPath: candidate.path,
    videoCandidates: [candidate],
    videoReviews: [accepted.review],
    videoProductionBinding: accepted.binding,
    videoQualityReview: {
      kind: 'video', passed: true, score: 95, summary: '通过', issues: [], reviewedAt: 3,
      model: 'qwen3.8-27b', attempt: 1, artifactPath: candidate.path, artifactFingerprint: 'stale-fingerprint',
    },
  }];
  const stale = buildProductionAudit(data);
  assert.equal(stale.checks.find((item) => item.id === 'video-quality-review')?.status, 'blocked');
  data.shots[0].qualityReviewHistory = [{
    ...data.shots[0].videoQualityReview!,
    artifactFingerprint: videoCandidateFingerprint(candidate),
    reviewedAt: 4,
  }];
  const current = buildProductionAudit(data);
  assert.equal(current.checks.find((item) => item.id === 'video-quality-review')?.status, 'pass');
  data.shots[0].qualityReviewHistory![0].reviewerFingerprint = 'reviewer-old';
  const changedReviewer = buildProductionAudit(data, { reviewerFingerprint: 'reviewer-new' });
  assert.equal(changedReviewer.checks.find((item) => item.id === 'video-quality-review')?.status, 'blocked');
  data.shots[0].qualityReviewHistory![0].reviewerFingerprint = 'reviewer-new';
  const currentReviewer = buildProductionAudit(data, { reviewerFingerprint: 'reviewer-new' });
  assert.equal(currentReviewer.checks.find((item) => item.id === 'video-quality-review')?.status, 'pass');
});

test('disabled AI review is disclosed as a warning without bypassing lineage blockers', () => {
  const data = emptyWorkshopData('p1');
  data.shots = [{ shotNo: '01-01', description: '', characterIds: [], videoPath: '/tmp/shot.mp4' }];
  assert.equal(buildProductionAudit(data).checks.find((item) => item.id === 'video-quality-review')?.status, 'blocked');
  const disabled = buildProductionAudit(data, { videoQualityReviewRequired: false });
  const reviewCheck = disabled.checks.find((item) => item.id === 'video-quality-review');
  assert.equal(reviewCheck?.status, 'warn');
  assert.match(reviewCheck?.detail ?? '', /未启用 AI/);
  for (const id of ['video-binding', 'video-input-lineage', 'production-packet', 'production-run-mapping']) {
    assert.equal(disabled.checks.find((item) => item.id === id)?.status, 'blocked');
  }
  assert.equal(buildProductionAudit(data, { videoQualityReviewRequired: true })
    .checks.find((item) => item.id === 'video-quality-review')?.status, 'blocked');
});

test('creative evidence follows the exact adopted receipt, not an earlier review', () => {
  const data = emptyWorkshopData('p1');
  const candidate = { path: '/tmp/shot.mp4', source: 'generate' as const, createdAt: 1 };
  const first = acceptVideoCandidate({
    candidates: [candidate], path: candidate.path, expectedFingerprint: videoCandidateFingerprint(candidate), now: 100,
  });
  const latest = acceptVideoCandidate({
    candidates: [candidate], path: candidate.path, expectedFingerprint: videoCandidateFingerprint(candidate), now: 200,
    criteria: { continuity: 'pass', visualIdentity: 'pass', performance: 'pass', pacing: 'pass' },
  });
  data.shots = [{
    shotNo: '01-01', description: '', characterIds: [], videoPath: candidate.path, videoCandidates: [candidate],
    videoReviews: [first.review, latest.review], videoProductionBinding: latest.binding,
  }];
  assert.equal(buildProductionAudit(data).checks.find((item) => item.id === 'creative-review-evidence')?.status, 'pass');
});

test('production audit requires boundary review only for fl2va production packets', () => {
  const data = emptyWorkshopData('p1');
  data.shots = [{
    shotNo: '01', description: '一个动作', characterIds: [],
    videoStartFramePath: '/tmp/start.png',
    videoEndFramePath: '/tmp/end.png',
    videoBoundaryFrameSignature: 'boundary-current',
    lastProductionPacket: {
      packetVersion: 1, projectId: 'p1', shotNo: '01', model: 'h3', engineId: 'h3',
      prompt: '动作', referencePaths: [], referenceLabels: [], audioPaths: [], videoPaths: [],
      params: { h3Task: 'ref2va', boundaryFrames: false }, inputFingerprint: 'input', createdAt: 1,
    },
  }];
  const referenceTask = buildProductionAudit(data);
  assert.equal(referenceTask.checks.find((item) => item.id === 'boundary-frame-quality')?.status, 'pass');
  data.shots[0].lastProductionPacket = undefined;
  const optionalLegacyFrames = buildProductionAudit(data);
  assert.equal(optionalLegacyFrames.checks.find((item) => item.id === 'boundary-frame-quality')?.status, 'pass');
  data.shots[0].lastProductionPacket = {
    packetVersion: 1, projectId: 'p1', shotNo: '01', model: 'h3', engineId: 'h3',
    prompt: '动作', referencePaths: [], referenceLabels: [], audioPaths: [], videoPaths: [],
    params: { h3Task: 'ref2va', boundaryFrames: false }, inputFingerprint: 'input', createdAt: 1,
  };
  data.shots[0].qualityReviewRequiresManualReview = true;
  const optionalFailure = buildProductionAudit(data);
  assert.equal(optionalFailure.checks.find((item) => item.id === 'quality-manual-review')?.status, 'pass');
  data.shots[0].lastProductionPacket = {
    ...data.shots[0].lastProductionPacket!,
    params: { h3Task: 'fl2va', boundaryFrames: true },
  };
  const frameTask = buildProductionAudit(data);
  assert.equal(frameTask.checks.find((item) => item.id === 'boundary-frame-quality')?.status, 'blocked');
});

test('production audit counts H3 universal prompts as prepared', () => {
  const data = emptyWorkshopData('p-h3');
  data.videoModel = 'minimax-h3';
  data.shots = [{
    shotNo: '01-01',
    description: '实体工作站在办公桌上',
    characterIds: [],
    videoPromptTemplate: 'universal',
    universalVideoPrompt: 'integrated_multimodal_description: a restrained product shot',
  }];
  const report = buildProductionAudit(data);
  const promptCheck = report.checks.find((item) => item.id === 'shot-prompts');
  assert.equal(promptCheck?.status, 'pass');
  assert.match(promptCheck?.detail ?? '', /已准备 1 镜/);
});

test('not-reviewed criteria are not creative review evidence', () => {
  const data = emptyWorkshopData('p1');
  const candidate = { path: '/tmp/shot.mp4', source: 'generate' as const, inputFingerprint: 'input', createdAt: 1 };
  const accepted = acceptVideoCandidate({ candidates: [candidate], path: candidate.path, expectedFingerprint: videoCandidateFingerprint(candidate), criteria: { continuity: 'not-reviewed', visualIdentity: 'not-reviewed', performance: 'not-reviewed', pacing: 'not-reviewed' } });
  data.shots = [{ shotNo: '01', description: '', characterIds: [], videoPath: candidate.path, videoCandidates: [candidate], videoReviews: [accepted.review], videoProductionBinding: accepted.binding }];
  assert.equal(buildProductionAudit(data).checks.find(item => item.id === 'creative-review-evidence')?.status, 'warn');
});
