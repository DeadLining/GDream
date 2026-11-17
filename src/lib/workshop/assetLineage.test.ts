import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptAssetCandidate,
  assetBindingIsCurrent,
  assetCandidateFingerprint,
  assetInputFingerprint,
} from './assetLineage.ts';

const candidate = {
  candidateId: 'character-1-v2',
  path: '/tmp/character-v2.png',
  checksum: 'abc123',
  source: 'generate' as const,
  engineId: 'gpt-image-2',
  prompt: 'character sheet',
  createdAt: 100,
};

test('accepts an asset candidate and creates a current production binding', () => {
  const accepted = acceptAssetCandidate({
    candidates: [candidate],
    path: candidate.path,
    expectedFingerprint: assetCandidateFingerprint(candidate),
    actor: 'test-user',
    now: 200,
  });

  assert.equal(accepted.review.verdict, 'accepted');
  assert.equal(accepted.review.actor, 'test-user');
  assert.equal(accepted.binding.path, candidate.path);
  assert.equal(assetBindingIsCurrent({
    candidate,
    binding: accepted.binding,
    reviews: [accepted.review],
  }), true);
});

test('rejects stale asset candidate fingerprints before binding', () => {
  assert.throws(() => acceptAssetCandidate({
    candidates: [candidate],
    path: candidate.path,
    expectedFingerprint: 'asset-stale',
}), /changed/);
});

test('asset input fingerprint changes when ordered references or generation parameters change', () => {
  const base = assetInputFingerprint({
    kind: 'character',
    assetId: 'c1',
    engineId: 'gpt-image-2',
    prompt: 'character sheet',
    referencePaths: ['/tmp/style.png', '/tmp/pose.png'],
    params: { aspectRatio: '16:9', resolution: '2k' },
  });
  assert.notEqual(base, assetInputFingerprint({
    kind: 'character',
    assetId: 'c1',
    engineId: 'gpt-image-2',
    prompt: 'character sheet',
    referencePaths: ['/tmp/pose.png', '/tmp/style.png'],
    params: { aspectRatio: '16:9', resolution: '2k' },
  }));
  assert.notEqual(base, assetInputFingerprint({
    kind: 'character',
    assetId: 'c1',
    engineId: 'gpt-image-2',
    prompt: 'character sheet',
    referencePaths: ['/tmp/style.png', '/tmp/pose.png'],
    params: { aspectRatio: '9:16', resolution: '2k' },
  }));
});
