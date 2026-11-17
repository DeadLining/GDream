import type {
  AssetCandidate,
  AssetProductionBinding,
  AssetReviewReceipt,
} from './types.ts';

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function assetCandidateFingerprint(candidate: AssetCandidate): string {
  return `asset-${fnv1a([
    candidate.candidateId ?? '',
    candidate.path,
    candidate.checksum ?? '',
    candidate.source,
    candidate.engineId ?? '',
    candidate.prompt ?? '',
    candidate.role ?? '',
    String(candidate.revision ?? ''),
    String(candidate.createdAt),
  ].join('|'))}`;
}

export function assetInputFingerprint(input: {
  kind: string;
  assetId: string;
  engineId: string;
  prompt: string;
  referencePaths?: string[];
  params?: Record<string, unknown>;
}): string {
  const params = Object.keys(input.params ?? {}).sort().map((key) => `${key}:${JSON.stringify(input.params?.[key])}`);
  return `asset-input-${fnv1a(JSON.stringify({
    kind: input.kind,
    assetId: input.assetId,
    engineId: input.engineId,
    prompt: input.prompt,
    referencePaths: input.referencePaths ?? [],
    params,
  }))}`;
}

export function assetReviewFingerprint(review: AssetReviewReceipt): string {
  return `asset-review-${fnv1a(JSON.stringify({
    candidatePath: review.candidatePath,
    candidateFingerprint: review.candidateFingerprint,
    verdict: review.verdict,
    actor: review.actor,
    note: review.note ?? '',
    reviewedAt: review.reviewedAt,
  }))}`;
}

export function acceptAssetCandidate(input: {
  candidates: AssetCandidate[];
  path: string;
  expectedFingerprint?: string;
  actor?: string;
  note?: string;
  now?: number;
}): { review: AssetReviewReceipt; binding: AssetProductionBinding } {
  const candidate = input.candidates.find((item) => item.path === input.path);
  if (!candidate) throw new Error('asset candidate does not exist or was removed');
  const fingerprint = assetCandidateFingerprint(candidate);
  if (input.expectedFingerprint && fingerprint !== input.expectedFingerprint) {
    throw new Error('asset candidate changed; refresh before accepting');
  }
  const reviewedAt = input.now ?? Date.now();
  const review: AssetReviewReceipt = {
    candidatePath: candidate.path,
    candidateFingerprint: fingerprint,
    verdict: 'accepted',
    actor: input.actor ?? 'local-user',
    note: input.note,
    reviewedAt,
  };
  return {
    review,
    binding: {
      path: candidate.path,
      candidateFingerprint: fingerprint,
      reviewFingerprint: assetReviewFingerprint(review),
      boundAt: reviewedAt,
    },
  };
}

export function assetBindingIsCurrent(input: {
  candidate: AssetCandidate;
  binding?: AssetProductionBinding;
  reviews?: AssetReviewReceipt[];
}): boolean {
  if (!input.binding) return false;
  const fingerprint = assetCandidateFingerprint(input.candidate);
  const review = input.reviews?.find((item) =>
    item.candidatePath === input.candidate.path
    && item.candidateFingerprint === fingerprint
    && item.verdict === 'accepted',
  );
  return Boolean(
    input.binding.path === input.candidate.path
    && input.binding.candidateFingerprint === fingerprint
    && review
    && input.binding.reviewFingerprint === assetReviewFingerprint(review),
  );
}
