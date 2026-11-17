import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptProductionCandidate,
  bindingIsCurrent,
  productionCandidateFingerprint,
  type ProductionCandidate,
} from './lifecycle.ts';

const candidate: ProductionCandidate = {
  candidateId: 'render-1',
  kind: 'render',
  path: '/tmp/final.mp4',
  engineId: 'compose-editor-timeline',
  prompt: 'timeline input',
  inputFingerprint: 'input-abc',
  createdAt: 100,
};

test('accepts a current candidate and creates a binding', () => {
  const accepted = acceptProductionCandidate({
    candidates: [candidate],
    candidateId: candidate.candidateId,
    kind: 'render',
    expectedFingerprint: productionCandidateFingerprint(candidate),
    actor: 'tester',
    now: 200,
  });
  assert.equal(accepted.review.verdict, 'accepted');
  assert.equal(accepted.binding.path, candidate.path);
  assert.equal(bindingIsCurrent({ candidate, binding: accepted.binding, reviews: [accepted.review] }), true);
});

test('rejects a stale candidate fingerprint', () => {
  assert.throws(() => acceptProductionCandidate({
    candidates: [candidate],
    candidateId: candidate.candidateId,
    kind: 'render',
    expectedFingerprint: 'stale',
  }));
});
