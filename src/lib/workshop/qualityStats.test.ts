import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeWorkshopQuality } from './qualityStats.ts';
import type { QualityReviewReport } from './qualityReview.ts';
import type { WsShot } from './types.ts';

function review(patch: Partial<QualityReviewReport>): QualityReviewReport {
  return {
    kind: 'boundary-frames',
    passed: true,
    score: 90,
    summary: '通过',
    issues: [],
    reviewedAt: 1,
    model: 'reviewer',
    attempt: 1,
    ...patch,
  };
}

test('summarizes deduplicated project quality reviews and common issues', () => {
  const boundary = review({
    passed: false,
    score: 60,
    summary: '人物尺度异常',
    issues: [{ code: 'character-scale', severity: 'error', message: '人物比例变化' }],
  });
  const video = review({
    kind: 'video',
    passed: true,
    score: 96,
    summary: '成片通过',
    reviewedAt: 2,
    artifactPath: '/tmp/video.mp4',
    artifactFingerprint: 'video-current',
    issues: [{ code: 'character-scale', severity: 'warning', message: '轻微尺度波动' }],
  });
  const shots = [{
    id: 'shot-1',
    shotNo: '01',
    sceneId: 'scene-1',
    description: '',
    characterIds: [],
    qualityReviewHistory: [boundary, video],
    boundaryFrameQualityReview: boundary,
    videoQualityReview: video,
    qualityReviewRequiresManualReview: true,
  }] as WsShot[];
  assert.deepEqual(summarizeWorkshopQuality(shots), {
    reviewCount: 2,
    passedCount: 1,
    failedCount: 1,
    passRate: 50,
    averageScore: 78,
    boundaryFrameReviewCount: 1,
    videoReviewCount: 1,
    manualReviewShotCount: 1,
    topIssue: { code: 'character-scale', count: 2 },
  });
});

test('returns zeroed stats for a project without review evidence', () => {
  assert.deepEqual(summarizeWorkshopQuality([]), {
    reviewCount: 0,
    passedCount: 0,
    failedCount: 0,
    passRate: 0,
    averageScore: 0,
    boundaryFrameReviewCount: 0,
    videoReviewCount: 0,
    manualReviewShotCount: 0,
    topIssue: undefined,
  });
});
