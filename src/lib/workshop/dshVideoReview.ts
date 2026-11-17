import type { QualityReviewReport } from './qualityReview.ts';
export const reviewDimensions = ['continuity', 'visualIdentity', 'performance', 'pacing'] as const;
export type ReviewDimension = typeof reviewDimensions[number];
export type ReviewVerdict = 'pass' | 'fail' | 'not-reviewed';
export interface VideoReading {
  projectId: string; shotNo: string; candidatePath: string; candidateFingerprint: string;
  sha256: string; model: string; provider: string; expiresAt: number;
  frames: { path: string; time: number }[]; hasAudio: boolean;
}
export interface DshVideoEvidence {
  method: 'sampled-frames'; sha256: string; frames: VideoReading['frames'];
  audio: 'not-reviewed' | 'absent'; temporal: 'sampled-only';
  criteria: Record<ReviewDimension, ReviewVerdict>;
  observations: Record<ReviewDimension, string>;
}
export function validateVideoReading(reading: VideoReading, current: Pick<VideoReading, 'projectId' | 'shotNo' | 'candidatePath' | 'candidateFingerprint' | 'sha256' | 'model' | 'provider'>, now = Date.now()) {
  if (reading.expiresAt <= now || ['projectId','shotNo','candidatePath','candidateFingerprint','sha256','model','provider'].some(key => reading[key as keyof typeof current] !== current[key as keyof typeof current])) throw new Error('视频、项目、模型或阅读凭据已变化，请重新读取视频证据');
}
export function buildDshVideoReview(reading: VideoReading, value: unknown, now = Date.now()): QualityReviewReport {
  if (!value || typeof value !== 'object') throw new Error('缺少结构化评审');
  const raw = value as Record<string, unknown>;
  if (typeof raw.summary !== 'string' || !raw.summary.trim() || raw.summary.length > 6000 || typeof raw.score !== 'number' || !Number.isFinite(raw.score) || raw.score < 0 || raw.score > 100) throw new Error('需要审核摘要和0至100的有限分数');
  const criteria = raw.criteria as Record<ReviewDimension, ReviewVerdict> | undefined;
  const observations = raw.observations as Record<ReviewDimension,string> | undefined;
  for (const key of reviewDimensions) {
    if (!criteria || !['pass','fail','not-reviewed'].includes(criteria[key]) || !observations || typeof observations[key] !== 'string' || !observations[key].trim() || observations[key].length > 3000) throw new Error(`缺少有效的 ${key} 结论或观察依据`);
  }
  return {
    kind:'video', passed:false, score:raw.score, summary:raw.summary.trim(),
    issues:[...reviewDimensions.filter(key=>criteria![key] !== 'pass').map(key=>({code:'unknown' as const, severity:'error' as const, message:`${key}: ${observations![key]}`, target:'video' as const})),
      {code:'unknown',severity:'warning',message:'仅完成抽帧审核；不能据此宣称完整运动连续性和声音通过。',target:'video'}],
    reviewedAt:now, model:reading.model, reviewerFingerprint:`dsh:${reading.provider}:${reading.model}`, attempt:1,
    artifactPath:reading.candidatePath, artifactFingerprint:reading.candidateFingerprint,
    evidence:{method:'sampled-frames',sha256:reading.sha256,frames:reading.frames,audio:reading.hasAudio?'not-reviewed':'absent',temporal:'sampled-only',criteria:{...criteria!},observations:{...observations!}},
  };
}
