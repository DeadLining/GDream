export type ProductionCandidateKind = 'panel' | 'video' | 'speech' | 'render';

export interface ProductionCandidate {
  candidateId: string;
  kind: ProductionCandidateKind;
  path: string;
  engineId?: string;
  prompt?: string;
  inputFingerprint?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface ProductionReviewReceipt {
  candidateId: string;
  kind: ProductionCandidateKind;
  candidateFingerprint: string;
  verdict: 'accepted' | 'rejected';
  actor: string;
  note?: string;
  reviewedAt: number;
  comparisonFingerprint?: string;
}

export interface ProductionBinding {
  candidateId: string;
  kind: ProductionCandidateKind;
  path: string;
  candidateFingerprint: string;
  reviewFingerprint: string;
  boundAt: number;
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableMetadata(value: Record<string, unknown> | undefined): string {
  if (!value) return '';
  return Object.keys(value).sort().map((key) => `${key}:${JSON.stringify(value[key])}`).join('|');
}

export function productionCandidateFingerprint(candidate: ProductionCandidate): string {
  return `${candidate.kind}-${fnv1a([
    candidate.candidateId,
    candidate.path,
    candidate.engineId ?? '',
    candidate.prompt ?? '',
    candidate.inputFingerprint ?? '',
    String(candidate.createdAt),
    stableMetadata(candidate.metadata),
  ].join('|'))}`;
}

export function productionReviewFingerprint(review: ProductionReviewReceipt): string {
  return `review-${fnv1a(JSON.stringify({
    candidateId: review.candidateId,
    kind: review.kind,
    candidateFingerprint: review.candidateFingerprint,
    verdict: review.verdict,
    actor: review.actor,
    note: review.note ?? '',
    reviewedAt: review.reviewedAt,
    comparisonFingerprint: review.comparisonFingerprint ?? '',
  }))}`;
}

export function acceptProductionCandidate(input: {
  candidates: ProductionCandidate[];
  candidateId: string;
  kind: ProductionCandidateKind;
  expectedFingerprint: string;
  actor?: string;
  note?: string;
  comparisonFingerprint?: string;
  now?: number;
}): { review: ProductionReviewReceipt; binding: ProductionBinding } {
  const candidate = input.candidates.find((item) => item.candidateId === input.candidateId && item.kind === input.kind);
  if (!candidate) throw new Error(`${input.kind} candidate does not exist or was removed`);
  const fingerprint = productionCandidateFingerprint(candidate);
  if (fingerprint !== input.expectedFingerprint) {
    throw new Error(`${input.kind} candidate changed; refresh before accepting`);
  }
  const reviewedAt = input.now ?? Date.now();
  const review: ProductionReviewReceipt = {
    candidateId: candidate.candidateId,
    kind: candidate.kind,
    candidateFingerprint: fingerprint,
    verdict: 'accepted',
    actor: input.actor ?? 'local-user',
    note: input.note,
    reviewedAt,
    comparisonFingerprint: input.comparisonFingerprint,
  };
  return {
    review,
    binding: {
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      path: candidate.path,
      candidateFingerprint: fingerprint,
      reviewFingerprint: productionReviewFingerprint(review),
      boundAt: reviewedAt,
    },
  };
}

export function bindingIsCurrent(input: {
  candidate: ProductionCandidate;
  binding?: ProductionBinding;
  reviews?: ProductionReviewReceipt[];
}): boolean {
  if (!input.binding) return false;
  const fingerprint = productionCandidateFingerprint(input.candidate);
  const review = input.reviews?.find((item) =>
    item.candidateId === input.binding!.candidateId
    && item.kind === input.binding!.kind
    && item.candidateFingerprint === fingerprint
    && item.verdict === 'accepted',
  );
  return Boolean(
    input.binding.candidateId === input.candidate.candidateId
    && input.binding.kind === input.candidate.kind
    && input.binding.path === input.candidate.path
    && input.binding.candidateFingerprint === fingerprint
    && review
    && input.binding.reviewFingerprint === productionReviewFingerprint(review),
  );
}
