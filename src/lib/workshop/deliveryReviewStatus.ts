import type { WsShot } from './types.ts';
import { videoCandidateFingerprint } from './productionLifecycle.ts';
import { videoQualityReviewForCandidate } from './qualityReview.ts';

export function deliveryReviewStatus(shot: WsShot, reviewerFingerprint?: string): {
  state: 'missing' | 'stale' | 'incomplete' | 'failed' | 'passed'; label: string;
} {
  const reports = [shot.videoQualityReview, ...(shot.qualityReviewHistory ?? [])].filter(Boolean);
  if (!reports.length) return {state:'missing',label:'尚未终审'};
  const candidate=shot.videoCandidates?.find(c=>c.path===shot.videoPath);
  const report=candidate && videoQualityReviewForCandidate({reports,candidatePath:candidate.path,candidateFingerprint:videoCandidateFingerprint(candidate),reviewerFingerprint});
  if (!report) return {state:'stale',label:'审核与当前视频版本或审核配置不匹配'};
  if (report.passed) return {state:'passed',label:'终审通过'};
  if (report.issues.some(i=>i.severity==='error')) return {state:'failed',label:'审核未通过：'+report.issues.filter(i=>i.severity==='error').map(i=>i.message).join('；')};
  if (report.evidence?.audio==='not-reviewed' || report.evidence?.temporal==='sampled-only') return {state:'incomplete',label:'仅完成抽帧检查，声音或完整运动尚未终审'};
  return {state:'failed',label:'审核未通过：'+report.summary};
}
