import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliveryManifest } from './deliveryManifest.ts';
import type { WsShot } from './types.ts';
import { acceptProductionCandidate, productionCandidateFingerprint } from '../production/lifecycle.ts';
import { acceptVideoCandidate, videoCandidateFingerprint } from './productionLifecycle.ts';

const shot: WsShot = {
  shotNo: '01-01',
  description: '单一动作',
  characterIds: [],
  videoPath: '/tmp/a.mp4',
  videoCandidates: [{ path: '/tmp/a.mp4', source: 'generate', inputFingerprint: 'input-a', createdAt: 1 }],
  lastProductionPacket: {
    packetVersion: 1,
    projectId: 'p1',
    shotNo: '01-01',
    jobId: 'job-a',
    productionRunId: 'production-run-job-a',
    model: 'h3',
    engineId: 'h3',
    prompt: '动作',
    referencePaths: [],
    referenceLabels: [],
    audioPaths: [],
    videoPaths: [],
    params: {},
    inputFingerprint: 'input-a',
    createdAt: 1,
  },
  videoProductionBinding: { path: '/tmp/a.mp4', candidateFingerprint: 'candidate-a', reviewFingerprint: 'review-a', boundAt: 1 },
};

const acceptedVideo = acceptVideoCandidate({
  candidates: shot.videoCandidates!,
  path: '/tmp/a.mp4',
  expectedFingerprint: videoCandidateFingerprint(shot.videoCandidates![0]),
  now: 2,
});
const acceptedShot: WsShot = {
  ...shot,
  videoProductionBinding: acceptedVideo.binding,
  videoReviews: [acceptedVideo.review],
  videoQualityReview: {
    kind: 'video',
    passed: true,
    score: 93,
    summary: '连续性、动作与声画同步通过',
    issues: [],
    reviewedAt: 2,
    model: 'qwen3.8-27b',
    attempt: 1,
    artifactPath: '/tmp/a.mp4',
    artifactFingerprint: videoCandidateFingerprint(shot.videoCandidates![0]),
  },
};

test('delivery manifest is ready only for checksum-backed accepted videos', () => {
  const manifest = buildDeliveryManifest({ projectId: 'p1', shots: [acceptedShot], checksums: { '/tmp/a.mp4': 'sha256-a' }, now: 2 });
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.shots[0].reviewFingerprint, acceptedVideo.binding.reviewFingerprint);
});

test('delivery manifest blocks missing formal videos', () => {
  const manifest = buildDeliveryManifest({ projectId: 'p1', shots: [{ ...shot, videoPath: undefined }], checksums: {} });
  assert.equal(manifest.status, 'blocked');
  assert.match(manifest.reason ?? '', /缺少正式视频/);
});

test('delivery manifest blocks formal videos without a checksum', () => {
  const manifest = buildDeliveryManifest({ projectId: 'p1', shots: [acceptedShot], checksums: {} });
  assert.equal(manifest.status, 'blocked');
  assert.match(manifest.reason ?? '', /checksum/);
});

test('delivery manifest blocks videos without a current multimodal final review', () => {
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [{ ...acceptedShot, videoQualityReview: undefined }],
    checksums: { '/tmp/a.mp4': 'sha256-a' },
  });
  assert.equal(manifest.status, 'blocked');
  assert.match(manifest.reason ?? '', /多模态终审/);
});

test('manual-adoption policy is explicit and does not fabricate an AI approval', () => {
  const manual = { ...acceptedShot, videoQualityReview: undefined };
  const manifest = buildDeliveryManifest({
    projectId: 'p1', shots: [manual], checksums: { '/tmp/a.mp4': 'sha256-a' }, videoQualityReviewRequired: false,
  });
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.videoQualityReviewRequired, false);
  assert.equal(manifest.shots[0].qualityReview, undefined);
  const strict = buildDeliveryManifest({ projectId: 'p1', shots: [manual], checksums: { '/tmp/a.mp4': 'sha256-a' } });
  assert.equal(strict.videoQualityReviewRequired, true);
  assert.equal(strict.status, 'blocked');
  const noChecksum = buildDeliveryManifest({ projectId: 'p1', shots: [manual], checksums: {}, videoQualityReviewRequired: false });
  assert.match(noChecksum.reason ?? '', /checksum/);
  const noPacket = buildDeliveryManifest({
    projectId: 'p1', shots: [{ ...manual, lastProductionPacket: undefined }],
    checksums: { '/tmp/a.mp4': 'sha256-a' }, videoQualityReviewRequired: false,
  });
  assert.match(noPacket.reason ?? '', /提交输入包/);
  const noBinding = buildDeliveryManifest({
    projectId: 'p1', shots: [{ ...manual, videoProductionBinding: undefined }],
    checksums: { '/tmp/a.mp4': 'sha256-a' }, videoQualityReviewRequired: false,
  });
  assert.match(noBinding.reason ?? '', /评审绑定/);
});

test('delivery validates the exact receipt after repeated adoption', () => {
  const candidate = acceptedShot.videoCandidates![0];
  const latest = acceptVideoCandidate({
    candidates: [candidate], path: candidate.path, expectedFingerprint: videoCandidateFingerprint(candidate), now: 10,
  });
  const manifest = buildDeliveryManifest({
    projectId: 'p1', checksums: { '/tmp/a.mp4': 'sha256-a' },
    shots: [{ ...acceptedShot, videoReviews: [...acceptedShot.videoReviews!, latest.review], videoProductionBinding: latest.binding }],
  });
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.shots[0].reviewFingerprint, latest.binding.reviewFingerprint);
});

test('delivery manifest invalidates reviews from a different reviewer configuration', () => {
  const reviewedShot: WsShot = {
    ...acceptedShot,
    videoQualityReview: {
      ...acceptedShot.videoQualityReview!,
      reviewerFingerprint: 'reviewer-old',
    },
  };
  const blocked = buildDeliveryManifest({
    projectId: 'p1',
    shots: [reviewedShot],
    checksums: { '/tmp/a.mp4': 'sha256-a' },
    reviewerFingerprint: 'reviewer-new',
  });
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.reason ?? '', /多模态终审/);
  const ready = buildDeliveryManifest({
    projectId: 'p1',
    shots: [{
      ...reviewedShot,
      videoQualityReview: { ...reviewedShot.videoQualityReview!, reviewerFingerprint: 'reviewer-new' },
    }],
    checksums: { '/tmp/a.mp4': 'sha256-a' },
    reviewerFingerprint: 'reviewer-new',
  });
  assert.equal(ready.status, 'ready');
});

test('delivery manifest can use the matching candidate review from history', () => {
  const matchingReview = acceptedShot.videoQualityReview!;
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [{
      ...acceptedShot,
      videoQualityReview: { ...matchingReview, artifactFingerprint: 'different-candidate' },
      qualityReviewHistory: [matchingReview],
    }],
    checksums: { '/tmp/a.mp4': 'sha256-a' },
  });
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.shots[0].qualityReview?.score, 93);
});

test('delivery manifest rejects a review for an overwritten file at the same path', () => {
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [{
      ...acceptedShot,
      videoQualityReview: { ...acceptedShot.videoQualityReview!, artifactFingerprint: 'different-candidate' },
    }],
    checksums: { '/tmp/a.mp4': 'sha256-a' },
  });
  assert.equal(manifest.status, 'blocked');
  assert.match(manifest.reason ?? '', /多模态终审/);
});

test('delivery manifest requires a current boundary review for fl2va only', () => {
  const fl2vaShot: WsShot = {
    ...acceptedShot,
    videoStartFramePath: '/tmp/start.png',
    videoEndFramePath: '/tmp/end.png',
    videoBoundaryFrameSignature: 'boundary-current',
    lastProductionPacket: {
      ...acceptedShot.lastProductionPacket!,
      params: { ...acceptedShot.lastProductionPacket!.params, h3Task: 'fl2va', boundaryFrames: true },
    },
  };
  const blocked = buildDeliveryManifest({ projectId: 'p1', shots: [fl2vaShot], checksums: { '/tmp/a.mp4': 'sha256-a' } });
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.reason ?? '', /fl2va 首尾帧/);
  fl2vaShot.boundaryFrameQualityReview = {
    kind: 'boundary-frames', passed: true, score: 90, summary: '首尾状态通过', issues: [],
    reviewedAt: 3, model: 'qwen3.8-27b', attempt: 1,
  };
  fl2vaShot.boundaryFrameQualityReviewSignature = 'boundary-current';
  const ready = buildDeliveryManifest({ projectId: 'p1', shots: [fl2vaShot], checksums: { '/tmp/a.mp4': 'sha256-a' } });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.shots[0].boundaryFrames?.score, 90);
  const ref2vaShot = {
    ...fl2vaShot,
    boundaryFrameQualityReview: undefined,
    boundaryFrameQualityReviewSignature: undefined,
    lastProductionPacket: {
      ...fl2vaShot.lastProductionPacket!,
      params: { ...fl2vaShot.lastProductionPacket!.params, h3Task: 'ref2va', boundaryFrames: false },
    },
  };
  const referenceReady = buildDeliveryManifest({ projectId: 'p1', shots: [ref2vaShot], checksums: { '/tmp/a.mp4': 'sha256-a' } });
  assert.equal(referenceReady.status, 'ready');
});

test('delivery manifest blocks a video that fails container validation', () => {
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [acceptedShot],
    checksums: { '/tmp/a.mp4': 'sha256-a' },
    videoValidations: { '/tmp/a.mp4': { valid: false, reason: 'not a video' } },
  });
  assert.equal(manifest.status, 'blocked');
  assert.match(manifest.reason ?? '', /容器校验/);
});

test('delivery manifest carries and validates the formal video production packet', () => {
  const data = {
    ...shot,
    videoCandidates: [{
      path: '/tmp/a.mp4',
      source: 'generate' as const,
      inputFingerprint: 'input-a',
      createdAt: 1,
    }],
    lastProductionPacket: {
      packetVersion: 1 as const,
      projectId: 'p1',
      shotNo: '01-01',
      jobId: 'job-a',
      productionRunId: 'production-run-job-a',
      model: 'h3',
      engineId: 'h3',
      prompt: '动作',
      referencePaths: ['/tmp/ref.png'],
      referenceLabels: ['角色'],
      audioPaths: [],
      videoPaths: [],
      params: {},
      inputFingerprint: 'input-a',
      createdAt: 2,
    },
  };
  const manifest = buildDeliveryManifest({ projectId: 'p1', shots: [{ ...acceptedShot, ...data, videoProductionBinding: acceptedVideo.binding, videoReviews: [acceptedVideo.review] }], checksums: { '/tmp/a.mp4': 'sha' } });
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.shots[0].productionPacketFingerprint, 'input-a');
  assert.equal(manifest.shots[0].productionPacketCreatedAt, 2);
  assert.equal(manifest.shots[0].sourceScriptRevisionId, undefined);

  const stale = buildDeliveryManifest({
    projectId: 'p1',
    shots: [{ ...acceptedShot, ...data, videoProductionBinding: acceptedVideo.binding, videoReviews: [acceptedVideo.review], lastProductionPacket: { ...data.lastProductionPacket, inputFingerprint: 'old-input' } }],
    checksums: { '/tmp/a.mp4': 'sha' },
  });
  assert.equal(stale.status, 'blocked');
  assert.match(stale.reason ?? '', /输入包/);
});

test('delivery manifest keeps the accepted candidate valid when a later attempt replaces the shot packet', () => {
  const formalPacket = acceptedShot.lastProductionPacket!;
  const candidate = { ...acceptedShot.videoCandidates![0], productionPacket: formalPacket };
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [{
      ...acceptedShot,
      videoCandidates: [candidate],
      lastProductionPacket: { ...formalPacket, inputFingerprint: 'later-failed-attempt' },
    }],
    checksums: { '/tmp/a.mp4': 'sha256-a' },
  });
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.shots[0].productionPacketFingerprint, 'input-a');
});

test('delivery manifest records accepted injected audio lineage', () => {
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [{
      ...shot,
      audioInjected: true,
      generatedAudios: [{ characterId: 'c1', characterName: '小明', path: '/tmp/a.mp3', duration: 1 }],
      audioCandidates: [{ candidateId: 'a1', characterId: 'c1', characterName: '小明', path: '/tmp/a.mp3', duration: 1, createdAt: 1 }],
      audioReviews: [{ candidateId: 'a1', candidateFingerprint: 'audio-fp', verdict: 'accepted', actor: 'test', reviewedAt: 2 }],
    }],
    checksums: { '/tmp/a.mp4': 'sha256-a', '/tmp/a.mp3': 'sha256-audio' },
    now: 2,
  });
  assert.equal(manifest.shots[0].audio?.[0].candidateFingerprint, 'audio-fp');
  assert.equal(manifest.shots[0].audio?.[0].checksum, 'sha256-audio');
});

test('delivery manifest blocks injected audio without a checksum', () => {
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [{
      ...acceptedShot,
      audioInjected: true,
      generatedAudios: [{ characterId: 'c1', characterName: '小明', path: '/tmp/missing.mp3', duration: 1 }],
    }],
    checksums: { '/tmp/a.mp4': 'sha256-a' },
  });
  assert.equal(manifest.status, 'blocked');
  assert.match(manifest.reason ?? '', /音频.*checksum/);
});

test('delivery manifest blocks a video without a durable run mapping', () => {
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [{ ...acceptedShot, lastProductionPacket: { ...acceptedShot.lastProductionPacket!, jobId: undefined, productionRunId: undefined } }],
    checksums: { '/tmp/a.mp4': 'sha256-a' },
  });
  assert.equal(manifest.status, 'blocked');
  assert.match(manifest.reason ?? '', /运行任务映射/);
});

test('delivery manifest blocks an unaccepted render candidate', () => {
  const candidate = { candidateId: 'render-1', kind: 'render' as const, path: '/tmp/final.mp4', createdAt: 1 };
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [acceptedShot],
    checksums: { '/tmp/a.mp4': 'sha256-a', '/tmp/final.mp4': 'sha256-final' },
    renderCandidate: candidate,
  });
  assert.equal(manifest.status, 'blocked');
  assert.match(manifest.reason ?? '', /渲染候选/);
});

test('delivery manifest records an accepted current render candidate', () => {
  const candidate = { candidateId: 'render-1', kind: 'render' as const, path: '/tmp/final.mp4', createdAt: 1 };
  const accepted = acceptProductionCandidate({
    candidates: [candidate],
    candidateId: candidate.candidateId,
    kind: 'render',
    expectedFingerprint: productionCandidateFingerprint(candidate),
    now: 2,
  });
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [acceptedShot],
    checksums: { '/tmp/a.mp4': 'sha256-a', '/tmp/final.mp4': 'sha256-final' },
    renderCandidate: candidate,
    renderReviews: [accepted.review],
    renderBinding: accepted.binding,
  });
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.render?.checksum, 'sha256-final');
});

test('delivery manifest carries the successful render ProductionRun mapping', () => {
  const candidate = {
    candidateId: 'render-run',
    kind: 'render' as const,
    path: '/tmp/final-run.mp4',
    inputFingerprint: 'render-input-1',
    metadata: { jobId: 'render-job-1' },
    createdAt: 1,
  };
  const accepted = acceptProductionCandidate({
    candidates: [candidate],
    candidateId: candidate.candidateId,
    kind: 'render',
    expectedFingerprint: productionCandidateFingerprint(candidate),
    now: 2,
  });
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [acceptedShot],
    checksums: { '/tmp/a.mp4': 'sha256-a', [candidate.path]: 'sha256-final' },
    renderCandidate: candidate,
    renderReviews: [accepted.review],
    renderBinding: accepted.binding,
    productionRuns: [{
      runId: 'production-run-render-job-1', projectId: 'p1', kind: 'render', jobId: 'render-job-1',
      inputFingerprint: 'render-input-1', status: 'succeeded', createdAt: 1, updatedAt: 3,
    }],
  });
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.render?.productionRunId, 'production-run-render-job-1');
  assert.equal(manifest.render?.runStatus, 'succeeded');
});

test('delivery manifest blocks an invalid accepted render artifact', () => {
  const candidate = { candidateId: 'render-1', kind: 'render' as const, path: '/tmp/final.mp4', createdAt: 1 };
  const accepted = acceptProductionCandidate({
    candidates: [candidate],
    candidateId: candidate.candidateId,
    kind: 'render',
    expectedFingerprint: productionCandidateFingerprint(candidate),
    now: 2,
  });
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [acceptedShot],
    checksums: { '/tmp/a.mp4': 'sha256-a', '/tmp/final.mp4': 'sha256-final' },
    renderCandidate: candidate,
    renderReviews: [accepted.review],
    renderBinding: accepted.binding,
    renderVideoValidation: { valid: false, reason: 'not a video' },
  });
  assert.equal(manifest.status, 'blocked');
  assert.match(manifest.reason ?? '', /最终渲染文件/);
});

test('freezes episode and shot order in the delivery manifest', () => {
  const manifest = buildDeliveryManifest({
    projectId: 'p1',
    shots: [
      { ...acceptedShot, shotNo: '01-02', episode: '1' },
      { ...acceptedShot, shotNo: '02-01', episode: '2' },
      { ...acceptedShot, shotNo: '01-03', episode: '1' },
    ],
    checksums: { '/tmp/a.mp4': 'sha256-a' },
  });
  assert.deepEqual(manifest.episodes, [
    { episode: '1', shotNos: ['01-02', '01-03'] },
    { episode: '2', shotNos: ['02-01'] },
  ]);
  assert.equal(manifest.shots[0].episode, '1');
  assert.equal(manifest.schemaVersion, 3);
});

test('repeated acceptance resolves the bound receipt in delivery, step status and audit', async () => {
  const { emptyWorkshopData } = await import('./types.ts');
  const { reasonsForStepCompletion } = await import('./stepStatus.ts');
  const { buildProductionAudit } = await import('./productionAudit.ts');
  const latest = acceptVideoCandidate({
    candidates: acceptedShot.videoCandidates!, path: acceptedShot.videoPath!,
    expectedFingerprint: videoCandidateFingerprint(acceptedShot.videoCandidates![0]), now: 300,
    criteria: { continuity: 'pass', visualIdentity: 'pass', performance: 'pass', pacing: 'pass' },
  });
  const revised = {
    ...acceptedShot,
    videoCandidates: acceptedShot.videoCandidates!.map(c => ({ ...c, checksum: 'sha256-a' })),
    videoReviews: [acceptedVideo.review, latest.review], videoProductionBinding: latest.binding,
  };
  const data = emptyWorkshopData('p1'); data.shots = [revised];
  assert.deepEqual(reasonsForStepCompletion({ data, step: 'generate' }), []);
  const manifest = buildDeliveryManifest({ projectId: 'p1', shots: [revised], checksums: { '/tmp/a.mp4': 'sha256-a' } });
  assert.equal(manifest.status, 'ready');
  const audit = buildProductionAudit(data);
  assert.equal(audit.checks.find(c => c.id === 'video-binding')?.status, 'pass');
  assert.equal(audit.checks.find(c => c.id === 'creative-review-evidence')?.status, 'pass');
});
