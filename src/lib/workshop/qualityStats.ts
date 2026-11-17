import type { WsShot } from './types.ts';
import type { QualityIssueCode, QualityReviewReport } from './qualityReview.ts';

export interface WorkshopQualityStats {
  reviewCount: number;
  passedCount: number;
  failedCount: number;
  passRate: number;
  averageScore: number;
  boundaryFrameReviewCount: number;
  videoReviewCount: number;
  manualReviewShotCount: number;
  topIssue?: { code: QualityIssueCode; count: number };
}

function reviewKey(report: QualityReviewReport): string {
  return [
    report.kind,
    report.reviewedAt,
    report.model,
    report.attempt,
    report.score,
    report.summary,
    report.artifactPath ?? '',
    report.artifactFingerprint ?? '',
    report.reviewerFingerprint ?? '',
  ].join('|');
}

export function summarizeWorkshopQuality(shots: WsShot[]): WorkshopQualityStats {
  const reports = new Map<string, QualityReviewReport>();
  for (const shot of shots) {
    for (const report of [
      ...(shot.qualityReviewHistory ?? []),
      shot.boundaryFrameQualityReview,
      shot.videoQualityReview,
    ]) {
      if (report) reports.set(reviewKey(report), report);
    }
  }
  const values = [...reports.values()];
  const passedCount = values.filter((report) => report.passed).length;
  const issueCounts = new Map<QualityIssueCode, number>();
  for (const report of values) {
    for (const issue of report.issues) issueCounts.set(issue.code, (issueCounts.get(issue.code) ?? 0) + 1);
  }
  const topIssueEntry = [...issueCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  return {
    reviewCount: values.length,
    passedCount,
    failedCount: values.length - passedCount,
    passRate: values.length > 0 ? Math.round((passedCount / values.length) * 100) : 0,
    averageScore: values.length > 0
      ? Math.round(values.reduce((sum, report) => sum + report.score, 0) / values.length)
      : 0,
    boundaryFrameReviewCount: values.filter((report) => report.kind === 'boundary-frames').length,
    videoReviewCount: values.filter((report) => report.kind === 'video').length,
    manualReviewShotCount: shots.filter((shot) => shot.qualityReviewRequiresManualReview).length,
    topIssue: topIssueEntry ? { code: topIssueEntry[0], count: topIssueEntry[1] } : undefined,
  };
}
