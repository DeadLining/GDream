import type { AudioCandidate, AudioProductionBinding, AudioReviewReceipt, GeneratedAudio } from './types.ts';

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function audioCandidateFingerprint(candidate: AudioCandidate): string {
  return `audio-${fnv1a([
    candidate.candidateId,
    candidate.characterId,
    candidate.path,
    candidate.prompt ?? '',
    candidate.engineId ?? '',
    String(candidate.createdAt),
  ].join('|'))}`;
}

export function acceptAudioCandidate(input: {
  candidates: AudioCandidate[];
  candidateId: string;
  expectedFingerprint: string;
  actor?: string;
  note?: string;
  now?: number;
}): { audio: GeneratedAudio; review: AudioReviewReceipt; binding: AudioProductionBinding } {
  const candidate = input.candidates.find((item) => item.candidateId === input.candidateId);
  if (!candidate) throw new Error('配音候选不存在或已被移除');
  const fingerprint = audioCandidateFingerprint(candidate);
  if (fingerprint !== input.expectedFingerprint) {
    throw new Error('配音候选已变化，请刷新后重新评审采用');
  }
  const reviewedAt = input.now ?? Date.now();
  const review: AudioReviewReceipt = {
    candidateId: candidate.candidateId,
    candidateFingerprint: fingerprint,
    verdict: 'accepted',
    actor: input.actor ?? 'local-user',
    note: input.note,
    reviewedAt,
  };
  return {
    audio: {
      characterId: candidate.characterId,
      characterName: candidate.characterName,
      path: candidate.path,
      duration: candidate.duration,
      trimmedPath: candidate.trimmedPath,
      trimmedDuration: candidate.trimmedDuration,
    },
    review,
    binding: {
      candidateId: candidate.candidateId,
      candidateFingerprint: fingerprint,
      reviewFingerprint: `review-${fnv1a(JSON.stringify(review))}`,
      boundAt: reviewedAt,
    },
  };
}
