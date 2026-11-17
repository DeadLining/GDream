import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptAudioCandidate, audioCandidateFingerprint } from './audioLifecycle.ts';
import type { AudioCandidate } from './types.ts';

const candidate: AudioCandidate = {
  candidateId: 'audio-shot-1-char-1-1',
  characterId: 'char-1',
  characterName: '小明',
  path: '/tmp/shot-1.mp3',
  duration: 2.4,
  prompt: '平静地说：你好',
  engineId: 'doubao-speech',
  createdAt: 100,
};

test('audio candidate acceptance requires the current fingerprint', () => {
  const fingerprint = audioCandidateFingerprint(candidate);
  const accepted = acceptAudioCandidate({ candidates: [candidate], candidateId: candidate.candidateId, expectedFingerprint: fingerprint, now: 200 });
  assert.equal(accepted.audio.path, candidate.path);
  assert.equal(accepted.review.verdict, 'accepted');
  assert.equal(accepted.binding.candidateFingerprint, fingerprint);
  assert.throws(() => acceptAudioCandidate({ candidates: [candidate], candidateId: candidate.candidateId, expectedFingerprint: 'stale' }));
});
