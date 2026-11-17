import type { AssetCandidate, VideoProductionBinding, VideoReviewCriteria, VideoReviewReceipt, WsShot } from './types';

export function videoCandidateDeletionGuard(input: {
  candidates: AssetCandidate[];
  path: string;
  acceptedPath?: string;
}): { ok: true } | { ok: false; reason: string } {
  if (input.acceptedPath === input.path) {
    return { ok: false, reason: '该候选已被采用为正式视频，请先采用其他候选后再删除。' };
  }
  if (!input.candidates.some((candidate) => candidate.path === input.path)) {
    return { ok: false, reason: '视频候选不存在或已被移除。' };
  }
  return { ok: true };
}

export interface VideoInputFingerprintInput {
  engineId: string;
  prompt: string;
  referencePaths: string[];
  audioPaths?: string[];
  videoPaths?: string[];
  params?: Record<string, unknown>;
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableRecord(value: Record<string, unknown> | undefined): string {
  if (!value) return '';
  return Object.keys(value)
    .sort()
    .map((key) => `${key}:${JSON.stringify(value[key])}`)
    .join('|');
}

export function videoInputFingerprint(input: VideoInputFingerprintInput): string {
  return `video-input-${fnv1a([
    input.engineId,
    input.prompt,
    input.referencePaths.join('|'),
    input.audioPaths?.join('|') ?? '',
    input.videoPaths?.join('|') ?? '',
    stableRecord(input.params),
  ].join('|'))}`;
}

export function videoCandidateFingerprint(candidate: AssetCandidate): string {
  return `video-${fnv1a([
    candidate.path,
    candidate.engineId ?? '',
    candidate.prompt ?? '',
    candidate.inputFingerprint ?? '',
    String(candidate.createdAt),
  ].join('|'))}`;
}

export function videoCandidateMatchesProductionInput(
  candidate: AssetCandidate,
  productionInputFingerprint?: string,
): boolean {
  if (!candidate.inputFingerprint) return false;
  const frozenFingerprint = candidate.productionPacket?.inputFingerprint;
  if (frozenFingerprint) return candidate.inputFingerprint === frozenFingerprint;
  return Boolean(productionInputFingerprint && candidate.inputFingerprint === productionInputFingerprint);
}

export function videoReviewFingerprint(review: VideoReviewReceipt): string {
  return `review-${fnv1a(JSON.stringify(review))}`;
}

/** Adoption is a user decision; file/input lineage is audited separately at handoff. */
export function videoAdoptionIsCurrent(shot: Pick<WsShot,
  'videoPath' | 'videoCandidates' | 'videoReviews' | 'videoProductionBinding'
>): boolean {
  const binding = shot.videoProductionBinding;
  if (!shot.videoPath || binding?.path !== shot.videoPath
    || !binding.candidateFingerprint || !binding.reviewFingerprint) return false;
  const candidate = shot.videoCandidates?.find((item) => item.path === shot.videoPath);
  if (candidate && videoCandidateFingerprint(candidate) !== binding.candidateFingerprint) return false;
  // Legacy projects can retain a formal video and its receipt after losing the candidate row.
  return Boolean(shot.videoReviews?.some((review) => review.candidatePath === shot.videoPath
    && review.candidateFingerprint === binding.candidateFingerprint
    && review.verdict === 'accepted'
    && videoReviewFingerprint(review) === binding.reviewFingerprint));
}

export function acceptVideoCandidate(input: {
  candidates: AssetCandidate[];
  path: string;
  expectedFingerprint: string;
  actor?: string;
  note?: string;
  criteria?: VideoReviewCriteria;
  now?: number;
}): { review: VideoReviewReceipt; binding: VideoProductionBinding } {
  const candidate = input.candidates.find((item) => item.path === input.path);
  if (!candidate) throw new Error('视频候选不存在或已被移除');
  const fingerprint = videoCandidateFingerprint(candidate);
  if (fingerprint !== input.expectedFingerprint) {
    throw new Error('视频候选已变化，请刷新后重新评审采用');
  }
  const reviewedAt = input.now ?? Date.now();
  const review: VideoReviewReceipt = {
    candidatePath: candidate.path,
    candidateFingerprint: fingerprint,
    verdict: 'accepted',
    actor: input.actor ?? 'local-user',
    note: input.note,
    criteria: input.criteria,
    reviewedAt,
  };
  return {
    review,
    binding: {
      path: candidate.path,
      candidateFingerprint: fingerprint,
      reviewFingerprint: videoReviewFingerprint(review),
      boundAt: reviewedAt,
    },
  };
}

/** Resolve the receipt named by the binding, not an arbitrary review of the same file. */
export function boundVideoReview(shot: Pick<WsShot, 'videoPath' | 'videoCandidates' | 'videoReviews' | 'videoProductionBinding'>): VideoReviewReceipt | undefined {
  const binding = shot.videoProductionBinding;
  if (!binding || !shot.videoPath || binding.path !== shot.videoPath) return undefined;
  const candidate = shot.videoCandidates?.find(item => item.path === binding.path);
  if (!candidate || videoCandidateFingerprint(candidate) !== binding.candidateFingerprint) return undefined;
  return shot.videoReviews?.find(review => review.verdict === 'accepted'
    && review.candidatePath === binding.path
    && review.candidateFingerprint === binding.candidateFingerprint
    && videoReviewFingerprint(review) === binding.reviewFingerprint);
}

/** Old alternatives remain accessible, but cannot be offered as a newer replacement. */
export function videoCandidateChoices(candidates: AssetCandidate[] = [], adoptedPath?: string): {
  newer: AssetCandidate[]; history: AssetCandidate[]; latest?: AssetCandidate;
} {
  const adopted = candidates.find(item => item.path === adoptedPath);
  const alternatives = candidates.filter(item => item.path !== adoptedPath)
    .slice().sort((a, b) => a.createdAt - b.createdAt);
  const newer = alternatives.filter(item => !adoptedPath || (adopted && item.createdAt > adopted.createdAt));
  const history = alternatives.filter(item => !newer.includes(item));
  return { newer, history, latest: newer[newer.length - 1] };
}
