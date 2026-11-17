import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from './types.ts';
import { acceptVideoCandidate, videoCandidateFingerprint } from './productionLifecycle.ts';
import { adoptedVideoRecoveryCandidates } from './adoptedVideoRecovery.ts';

function fixture() {
  const data = emptyWorkshopData('p1');
  const candidate = {
    candidateId: 'shared-id', path: '/tmp/adopted.mp4', source: 'generate' as const,
    inputFingerprint: 'input-1', checksum: 'sha256', createdAt: 100,
  };
  const accepted = acceptVideoCandidate({
    candidates: [candidate], path: candidate.path, expectedFingerprint: videoCandidateFingerprint(candidate), now: 200,
  });
  data.shots = [{
    id: 'shot-1', shotNo: '01-01', description: '', characterIds: [], videoPath: candidate.path,
    videoProductionBinding: accepted.binding, videoReviews: [accepted.review], videoCandidates: [],
    deletedVideoCandidateIds: [candidate.candidateId], deletedVideoCandidatePaths: ['/tmp/source.mp4'],
  }];
  const node = { data: {
    workshopRef: { projectId: 'p1', kind: 'shot', role: 'shot-video', id: '01-01', shotId: 'shot-1' },
    assetVersions: [candidate],
  } };
  return { data, candidate, node };
}

test('recovery finds only the exact original adopted record, even when a source-copy id was deleted', () => {
  const { data, candidate, node } = fixture();
  assert.deepEqual(adoptedVideoRecoveryCandidates(data, [node]), [{ shotNo: '01-01', candidate }]);
  assert.deepEqual(data.shots[0].videoCandidates, [], 'discovery must not mutate workshop state');
  data.shots[0].videoCandidates = [candidate];
  assert.deepEqual(adoptedVideoRecoveryCandidates(data, [node]), [], 'recovery is idempotent');
});

test('recovery rejects unrelated projects, roles, stable shot ids and changed metadata', () => {
  const { data, node } = fixture();
  const ref = node.data.workshopRef;
  for (const patch of [{ projectId: 'p2' }, { role: 'asset' }, { kind: 'scene' }, { shotId: 'shot-2' }]) {
    assert.deepEqual(adoptedVideoRecoveryCandidates(data, [{ data: { ...node.data, workshopRef: { ...ref, ...patch } } }]), []);
  }
  node.data.assetVersions[0].createdAt++;
  assert.deepEqual(adoptedVideoRecoveryCandidates(data, [node]), []);
});

test('recovery never revives a deleted formal path or creates a missing adoption receipt', () => {
  const { data, node, candidate } = fixture();
  data.shots[0].deletedVideoCandidatePaths = [candidate.path];
  assert.deepEqual(adoptedVideoRecoveryCandidates(data, [node]), []);
  data.shots[0].deletedVideoCandidatePaths = [];
  data.shots[0].videoReviews = [];
  assert.deepEqual(adoptedVideoRecoveryCandidates(data, [node]), []);
});
