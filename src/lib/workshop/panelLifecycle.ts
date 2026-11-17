import type { AssetCandidate, StoryboardFrame } from './types';
import {
  acceptProductionCandidate,
  productionCandidateFingerprint,
  type ProductionBinding,
  type ProductionCandidate,
  type ProductionReviewReceipt,
} from '../production/lifecycle.ts';

export function panelCandidateId(candidate: AssetCandidate, frameId: string): string {
  return candidate.candidateId ?? `panel-${frameId}-${candidate.path}-${candidate.createdAt}`;
}

function frameCandidates(frame: StoryboardFrame): AssetCandidate[] {
  if (frame.candidates?.length) return frame.candidates;
  return frame.imagePath
    ? [{ path: frame.imagePath, source: 'generate', prompt: frame.prompt, createdAt: 0 }]
    : [];
}

export function toPanelCandidate(candidate: AssetCandidate, frameId: string): ProductionCandidate {
  return {
    candidateId: panelCandidateId(candidate, frameId),
    kind: 'panel',
    path: candidate.path,
    engineId: candidate.engineId,
    prompt: candidate.prompt,
    createdAt: candidate.createdAt,
    metadata: {
      source: candidate.source,
      role: candidate.role ?? '',
      clientToken: candidate.clientToken ?? '',
    },
  };
}

export function panelCandidateFingerprint(candidate: AssetCandidate, frameId: string): string {
  return productionCandidateFingerprint(toPanelCandidate(candidate, frameId));
}

export function acceptPanelCandidate(input: {
  frame: StoryboardFrame;
  path: string;
  expectedFingerprint: string;
  actor?: string;
  note?: string;
  comparisonFingerprint?: string;
  now?: number;
}): {
  review: ProductionReviewReceipt;
  binding: ProductionBinding;
  candidateId: string;
} {
  const candidate = frameCandidates(input.frame).find((item) => item.path === input.path);
  if (!candidate) throw new Error('故事板候选不存在或已被移除');
  const normalized = toPanelCandidate(candidate, input.frame.id);
  const accepted = acceptProductionCandidate({
    candidates: [normalized],
    candidateId: normalized.candidateId,
    kind: 'panel',
    expectedFingerprint: input.expectedFingerprint,
    actor: input.actor,
    note: input.note,
    comparisonFingerprint: input.comparisonFingerprint,
    now: input.now,
  });
  return { ...accepted, candidateId: normalized.candidateId };
}
