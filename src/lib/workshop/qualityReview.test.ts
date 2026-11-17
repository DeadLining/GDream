import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendQualityRepairPatch,
  boundaryFrameRedrawPlan,
  buildQualityRepairPatch,
  clampQualityScore,
  currentVideoQualityReview,
  normalizeQualityIssueCode,
  normalizeQualityReviewTarget,
  parseQualityReviewResponse,
  qualityReviewEndpoint,
  qualityReviewMatchesReviewer,
  boundaryFrameReviewGate,
  qualityReviewerFingerprint,
  shouldRetryQualityReview,
  videoQualityReviewForCandidate,
  type QualityReviewReport,
} from './qualityReview.ts';

test('normalizes review scores and issue aliases', () => {
  assert.equal(clampQualityScore(108), 100);
  assert.equal(clampQualityScore('-3'), 0);
  assert.equal(clampQualityScore('88.4'), 88);
  assert.equal(normalizeQualityIssueCode('character_scale'), 'character-scale');
  assert.equal(normalizeQualityIssueCode('lighting'), 'lighting-continuity');
  assert.equal(normalizeQualityIssueCode('unexpected'), 'unknown');
  assert.equal(qualityReviewEndpoint('http://127.0.0.1:30377', 'chat'), 'http://127.0.0.1:30377/v1/chat/completions');
  assert.equal(qualityReviewEndpoint('http://127.0.0.1:30377/v1/', 'models'), 'http://127.0.0.1:30377/v1/models');
});

test('reviewer fingerprint changes with service address or model', () => {
  const first = qualityReviewerFingerprint('http://127.0.0.1:30377', 'qwen3.8-27b');
  assert.equal(first, qualityReviewerFingerprint('http://127.0.0.1:30377/', 'qwen3.8-27b'));
  assert.notEqual(first, qualityReviewerFingerprint('http://127.0.0.1:30378', 'qwen3.8-27b'));
  assert.notEqual(first, qualityReviewerFingerprint('http://127.0.0.1:30377', 'other-model'));
  assert.doesNotMatch(first, /127\.0\.0\.1|qwen/);
  const report: QualityReviewReport = {
    kind: 'video', passed: true, score: 90, summary: '通过', issues: [], reviewedAt: 1,
    model: 'qwen3.8-27b', reviewerFingerprint: first, attempt: 1,
  };
  assert.equal(qualityReviewMatchesReviewer(report, first), true);
  assert.equal(qualityReviewMatchesReviewer(report, 'changed'), false);
  assert.equal(qualityReviewMatchesReviewer(undefined, first), false);
});

test('boundary-frame gate blocks disabled, stale, failed, and manual-review states', () => {
  const report: QualityReviewReport = {
    kind: 'boundary-frames', passed: true, score: 95, summary: '通过', issues: [], reviewedAt: 1,
    model: 'qwen3.8-27b', reviewerFingerprint: 'reviewer-current', attempt: 1,
  };
  assert.equal(boundaryFrameReviewGate({ enabled: false }).allowed, false);
  assert.equal(boundaryFrameReviewGate({
    enabled: true,
    report,
    boundarySignature: 'current',
    reviewSignature: 'old',
    reviewerFingerprint: 'reviewer-current',
  }).allowed, false);
  assert.equal(boundaryFrameReviewGate({
    enabled: true,
    report: { ...report, passed: false },
    boundarySignature: 'current',
    reviewSignature: 'current',
    reviewerFingerprint: 'reviewer-current',
  }).allowed, false);
  assert.equal(boundaryFrameReviewGate({
    enabled: true,
    report,
    boundarySignature: 'current',
    reviewSignature: 'current',
    reviewerFingerprint: 'reviewer-current',
    manualReviewRequired: true,
  }).allowed, false);
  assert.equal(boundaryFrameReviewGate({
    enabled: true,
    report,
    boundarySignature: 'current',
    reviewSignature: 'current',
    reviewerFingerprint: 'reviewer-current',
  }).allowed, true);
});

test('builds a minimal deduplicated repair patch without rewriting the shot', () => {
  const patch = buildQualityRepairPatch([
    { code: 'character-scale', severity: 'error', message: '人物比例变化' },
    { code: 'character-scale', severity: 'error', message: '人物比例再次变化' },
    { code: 'lighting-continuity', severity: 'warning', message: '轻微色温变化' },
  ]);
  assert.match(patch, /人物尺度锚点/);
  assert.doesNotMatch(patch, /光源连续性/);
  assert.equal((patch.match(/人物尺度锚点/g) ?? []).length, 1);
  assert.match(patch, /不重写剧情/);
});

test('replaces the previous automatic patch and stops after three attempts', () => {
  const first = appendQualityRepairPatch('原提示词', [
    { code: 'prop-continuity', severity: 'error', message: '道具错位' },
  ]);
  const second = appendQualityRepairPatch(first, [
    { code: 'action-mismatch', severity: 'error', message: '动作缺失' },
  ]);
  assert.doesNotMatch(second, /道具状态账本/);
  assert.match(second, /动作验收/);
  const report: QualityReviewReport = {
    kind: 'boundary-frames', passed: false, score: 40, summary: '失败',
    issues: [{ code: 'action-mismatch', severity: 'error', message: '动作缺失' }],
    reviewedAt: 1, model: 'qwen3.8-27b', attempt: 3,
  };
  assert.equal(shouldRetryQualityReview(report, 3), false);
  assert.equal(shouldRetryQualityReview({ ...report, attempt: 2 }, 3), true);
});

test('parses fenced model JSON and blocks reports containing errors', () => {
  const report = parseQualityReviewResponse({
    text: '```json\n{"passed":true,"score":91,"summary":"基本可用","issues":[{"code":"prop","severity":"error","target":"end-frame","message":"尾帧道具回到旧持有人"}]}\n```',
    kind: 'boundary-frames',
    model: 'qwen3.8-27b',
    attempt: 1,
    reviewedAt: 10,
  });
  assert.equal(report.passed, false);
  assert.equal(report.score, 91);
  assert.equal(report.issues[0].code, 'prop-continuity');
  assert.equal(report.issues[0].target, 'end-frame');
  assert.equal(report.reviewedAt, 10);
});

test('binds video reviews to both candidate path and fingerprint', () => {
  const older: QualityReviewReport = {
    kind: 'video', passed: true, score: 92, summary: '旧候选通过', issues: [],
    reviewedAt: 10, model: 'qwen3.8-27b', attempt: 1,
    artifactPath: '/tmp/candidate.mp4', artifactFingerprint: 'video-old',
  };
  const current: QualityReviewReport = {
    ...older,
    summary: '当前候选通过',
    reviewedAt: 20,
    artifactFingerprint: 'video-current',
  };
  assert.equal(currentVideoQualityReview({
    reports: [current, older],
    candidatePath: '/tmp/candidate.mp4',
    candidateFingerprint: 'video-current',
  })?.summary, '当前候选通过');
  assert.equal(currentVideoQualityReview({
    reports: [older],
    candidatePath: '/tmp/candidate.mp4',
    candidateFingerprint: 'video-current',
  }), undefined);
  assert.equal(currentVideoQualityReview({
    reports: [{ ...current, reviewerFingerprint: 'reviewer-old' }],
    candidatePath: '/tmp/candidate.mp4',
    candidateFingerprint: 'video-current',
    reviewerFingerprint: 'reviewer-new',
  }), undefined);
  assert.equal(videoQualityReviewForCandidate({
    reports: [{ ...current, passed: false, score: 41 }],
    candidatePath: '/tmp/candidate.mp4',
    candidateFingerprint: 'video-current',
  })?.score, 41);
});

test('normalizes structured and legacy frame targets', () => {
  assert.equal(normalizeQualityReviewTarget('first_frame'), 'start-frame');
  assert.equal(normalizeQualityReviewTarget('both'), 'both-frames');
  assert.equal(normalizeQualityReviewTarget(undefined, '首尾帧人物尺度不一致'), 'both-frames');
  assert.equal(normalizeQualityReviewTarget(undefined, '尾帧人物朝向反转'), 'end-frame');
});

test('redraws both frames for start or shared defects and only the tail otherwise', () => {
  const base: QualityReviewReport = {
    kind: 'boundary-frames', passed: false, score: 50, summary: '失败',
    issues: [], reviewedAt: 1, model: 'qwen3.8-27b', attempt: 1,
  };
  assert.deepEqual(boundaryFrameRedrawPlan({
    ...base,
    issues: [{ code: 'composition-continuity', severity: 'error', target: 'start-frame', message: '首帧错误' }],
  }), { redrawStart: true, redrawEnd: true });
  assert.deepEqual(boundaryFrameRedrawPlan({
    ...base,
    issues: [{ code: 'character-scale', severity: 'error', target: 'both-frames', message: '两帧比例不一致' }],
  }), { redrawStart: true, redrawEnd: true });
  assert.deepEqual(boundaryFrameRedrawPlan({
    ...base,
    issues: [{ code: 'prop-continuity', severity: 'error', target: 'end-frame', message: '尾帧道具错误' }],
  }), { redrawStart: false, redrawEnd: true });
});
