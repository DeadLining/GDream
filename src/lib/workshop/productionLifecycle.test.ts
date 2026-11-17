import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptVideoCandidate,
  videoAdoptionIsCurrent,
  videoCandidateDeletionGuard,
  videoCandidateFingerprint,
  videoCandidateMatchesProductionInput,
  videoInputFingerprint,
} from './productionLifecycle.ts';
import type { AssetCandidate, WsShot } from './types.ts';

const candidate: AssetCandidate = {
  path: '/tmp/shot-1.mp4',
  source: 'generate',
  engineId: 'minimax-h3',
  prompt: 'single atomic shot',
  createdAt: 100,
};

test('accepts a candidate with the expected fingerprint', () => {
  const result = acceptVideoCandidate({
    candidates: [candidate],
    path: candidate.path,
    expectedFingerprint: videoCandidateFingerprint(candidate),
    criteria: { continuity: 'pass', visualIdentity: 'pass', performance: 'not-reviewed', pacing: 'pass' },
    now: 200,
  });
  assert.equal(result.review.verdict, 'accepted');
  assert.equal(result.review.criteria?.continuity, 'pass');
  assert.equal(result.binding.path, candidate.path);
  assert.equal(result.binding.candidateFingerprint, videoCandidateFingerprint(candidate));
});

function adoptedShot(): WsShot {
  const accepted = acceptVideoCandidate({
    candidates: [candidate], path: candidate.path,
    expectedFingerprint: videoCandidateFingerprint(candidate), now: 200,
  });
  return {
    shotNo: '01-01', description: '', characterIds: [],
    videoPath: candidate.path, videoCandidates: [{ ...candidate }],
    videoReviews: [accepted.review], videoProductionBinding: accepted.binding,
  };
}

test('adoption completion does not require asynchronous checksum or delivery lineage', () => {
  assert.equal(videoAdoptionIsCurrent(adoptedShot()), true);
});

test('repeated adoption validates the exact bound receipt instead of the first review', () => {
  const shot = adoptedShot();
  const accepted = acceptVideoCandidate({
    candidates: [candidate], path: candidate.path,
    expectedFingerprint: videoCandidateFingerprint(candidate), now: 300,
  });
  shot.videoReviews!.push(accepted.review);
  shot.videoProductionBinding = accepted.binding;
  assert.equal(videoAdoptionIsCurrent(shot), true);
});

test('legacy formal video keeps its explicit adoption when the candidate row is missing', () => {
  const shot = adoptedShot();
  shot.videoCandidates = [];
  assert.equal(videoAdoptionIsCurrent(shot), true);
  shot.videoReviews = [];
  assert.equal(videoAdoptionIsCurrent(shot), false);
});

test('adoption rejects missing output, mismatched paths, edited candidates and invalid receipts', () => {
  const mutations: ((shot: WsShot) => void)[] = [
    (shot) => { shot.videoPath = undefined; },
    (shot) => { shot.videoProductionBinding = undefined; },
    (shot) => { shot.videoProductionBinding!.path = '/tmp/other.mp4'; },
    (shot) => { shot.videoProductionBinding!.candidateFingerprint = ''; },
    (shot) => { shot.videoProductionBinding!.reviewFingerprint = 'wrong'; },
    (shot) => { shot.videoCandidates![0].prompt = 'changed'; },
    (shot) => { shot.videoReviews![0].candidatePath = '/tmp/other.mp4'; },
    (shot) => { shot.videoReviews![0].candidateFingerprint = 'wrong'; },
    (shot) => { shot.videoReviews![0].verdict = 'rejected'; },
    (shot) => { shot.videoReviews![0].note = 'changed'; },
  ];
  for (const mutate of mutations) {
    const shot = adoptedShot();
    mutate(shot);
    assert.equal(videoAdoptionIsCurrent(shot), false, mutate.toString());
  }
});

test('rejects stale candidate fingerprints', () => {
  assert.throws(() => acceptVideoCandidate({
    candidates: [candidate],
    path: candidate.path,
    expectedFingerprint: 'stale',
  }), /视频候选已变化/);
});

test('video input fingerprint preserves ordered multimodal inputs', () => {
  const first = videoInputFingerprint({
    engineId: 'minimax-h3',
    prompt: 'single atomic shot',
    referencePaths: ['/tmp/character.png', '/tmp/scene.png'],
    audioPaths: ['/tmp/dialogue.mp3'],
    videoPaths: ['/tmp/previs.mp4'],
    params: { ratio: '16:9', duration: '5' },
  });
  const sameWithReorderedParams = videoInputFingerprint({
    engineId: 'minimax-h3',
    prompt: 'single atomic shot',
    referencePaths: ['/tmp/character.png', '/tmp/scene.png'],
    audioPaths: ['/tmp/dialogue.mp3'],
    videoPaths: ['/tmp/previs.mp4'],
    params: { duration: '5', ratio: '16:9' },
  });
  const reorderedReferences = videoInputFingerprint({
    engineId: 'minimax-h3',
    prompt: 'single atomic shot',
    referencePaths: ['/tmp/scene.png', '/tmp/character.png'],
  });
  assert.equal(first, sameWithReorderedParams);
  assert.notEqual(first, reorderedReferences);
});

test('candidate fingerprint changes when the frozen input packet changes', () => {
  const withoutInput = videoCandidateFingerprint(candidate);
  const withInput = videoCandidateFingerprint({
    ...candidate,
    inputFingerprint: 'video-input-abc',
  });
  assert.notEqual(withoutInput, withInput);
});

test('legacy candidate adoption requires the current production input', () => {
  const current = { ...candidate, inputFingerprint: 'video-input-current' };
  assert.equal(videoCandidateMatchesProductionInput(current, 'video-input-current'), true);
  assert.equal(videoCandidateMatchesProductionInput(current, 'video-input-old'), false);
  assert.equal(videoCandidateMatchesProductionInput(candidate, 'video-input-current'), false);
});

test('candidate with a frozen production packet validates against its own packet', () => {
  const frozen = {
    ...candidate,
    inputFingerprint: 'video-input-old',
    productionPacket: {
      packetVersion: 1 as const,
      projectId: 'p1',
      shotNo: '01',
      model: 'MiniMaxAI/MiniMax-H3',
      engineId: 'minimax-h3',
      prompt: 'old but valid prompt',
      referencePaths: [],
      referenceLabels: [],
      audioPaths: [],
      videoPaths: [],
      params: {},
      inputFingerprint: 'video-input-old',
      createdAt: 90,
    },
  };
  assert.equal(videoCandidateMatchesProductionInput(frozen, 'video-input-new'), true);
  assert.equal(videoCandidateMatchesProductionInput({ ...frozen, inputFingerprint: 'tampered' }, 'video-input-new'), false);
});

test('candidate deletion guard blocks the accepted formal video', () => {
  assert.deepEqual(videoCandidateDeletionGuard({
    candidates: [candidate],
    path: candidate.path,
    acceptedPath: candidate.path,
  }), { ok: false, reason: '该候选已被采用为正式视频，请先采用其他候选后再删除。' });
});

test('candidate deletion guard permits only an existing pending candidate', () => {
  assert.deepEqual(videoCandidateDeletionGuard({
    candidates: [candidate],
    path: candidate.path,
    acceptedPath: '/tmp/formal.mp4',
  }), { ok: true });
  assert.equal(videoCandidateDeletionGuard({
    candidates: [candidate],
    path: '/tmp/missing.mp4',
  }).ok, false);
});

test('bound review resolves the exact receipt instead of the first or latest review', async () => {
  const { boundVideoReview } = await import('./productionLifecycle.ts');
  const adopt = (now: number) => acceptVideoCandidate({ candidates: [candidate], path: candidate.path, expectedFingerprint: videoCandidateFingerprint(candidate), now });
  const first = adopt(200), bound = adopt(300), later = adopt(400);
  const shot = { videoPath: candidate.path, videoCandidates: [candidate], videoReviews: [first.review, bound.review, later.review], videoProductionBinding: bound.binding };
  assert.equal(boundVideoReview(shot), bound.review);
  assert.equal(boundVideoReview({ ...shot, videoProductionBinding: { ...bound.binding, path: '/wrong.mp4' } }), undefined);
  assert.equal(boundVideoReview({ ...shot, videoReviews: [first.review, later.review] }), undefined);
  assert.equal(boundVideoReview({ ...shot, videoCandidates: [{ ...candidate, prompt: 'changed' }] }), undefined);
});

test('candidate choices never label an older alternative as the newest video', async () => {
  const { videoCandidateChoices } = await import('./productionLifecycle.ts');
  const old = { ...candidate, path: '/old.mp4', createdAt: 100 };
  const adopted = { ...candidate, path: '/adopted.mp4', createdAt: 200 };
  const newer = { ...candidate, path: '/new.mp4', createdAt: 300 };
  const result = videoCandidateChoices([newer, old, adopted], adopted.path);
  assert.deepEqual(result.newer, [newer]);
  assert.deepEqual(result.history, [old]);
  assert.equal(result.latest?.path, newer.path);
  assert.equal(videoCandidateChoices([old, adopted], adopted.path).latest, undefined);
  assert.equal(videoCandidateChoices([newer, old], undefined).latest?.path, newer.path);
  assert.equal(videoCandidateChoices([old], '/missing.mp4').latest, undefined);
  assert.equal(videoCandidateChoices([{ ...old, createdAt: 200 }, adopted], adopted.path).latest, undefined);
});
