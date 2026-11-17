import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyShotDeletionTombstones,
  filterDeletedVideoCandidates,
  patchShotById,
  shotRewriteTargetIsCurrent,
  shotStableSelectionId,
} from './shotMutation.ts';
import type { WsShot } from './types.ts';
import { acceptVideoCandidate, videoCandidateFingerprint } from './productionLifecycle.ts';

const duplicateNumbers: WsShot[] = [
  { id: 'shot-a', shotNo: '01-01', description: 'A', characterIds: [] },
  { id: 'shot-b', shotNo: '01-01', description: 'B', characterIds: [] },
];

test('single-shot patch updates only the stable shot id even when shot numbers duplicate', () => {
  const result = patchShotById(duplicateNumbers, 'shot-b', { videoPrompt: 'rewritten' });
  assert.equal(result.applied, true);
  assert.equal(result.shots[0].videoPrompt, undefined);
  assert.equal(result.shots[1].videoPrompt, 'rewritten');
});

test('single-shot patch leaves the collection untouched when the target is gone', () => {
  const result = patchShotById(duplicateNumbers, 'missing', { videoPrompt: 'rewritten' });
  assert.equal(result.applied, false);
  assert.deepEqual(result.shots, duplicateNumbers);
});

test('late rewrite results are rejected after project switch or shot removal', () => {
  assert.equal(shotRewriteTargetIsCurrent({
    requestedProjectId: 'p1', requestedShotId: 'shot-a', currentProjectId: 'p1', currentShots: duplicateNumbers,
  }), true);
  assert.equal(shotRewriteTargetIsCurrent({
    requestedProjectId: 'p1', requestedShotId: 'shot-a', currentProjectId: 'p2', currentShots: duplicateNumbers,
  }), false);
  assert.equal(shotRewriteTargetIsCurrent({
    requestedProjectId: 'p1', requestedShotId: 'missing', currentProjectId: 'p1', currentShots: duplicateNumbers,
  }), false);
});

test('stable selection ids distinguish legacy shots with duplicate shot numbers', () => {
  assert.equal(shotStableSelectionId(duplicateNumbers[0]), 'shot-a');
  assert.equal(shotStableSelectionId(duplicateNumbers[1]), 'shot-b');
  assert.equal(shotStableSelectionId({ shotNo: '01-01' }), 'shot-no:01-01');
});


test('deleted video candidate paths stay deleted when an async result writes them back', () => {
  const candidate = { path: '/tmp/shot-01.mp4', source: 'generate' as const, createdAt: 100 };
  const current: WsShot = {
    id: 'shot-a',
    shotNo: '01-01',
    description: 'A',
    characterIds: [],
    videoCandidates: [],
    deletedVideoCandidatePaths: [candidate.path],
  };
  const safePatch = applyShotDeletionTombstones(current, {
    videoCandidates: [candidate],
    genStatus: 'done',
  });
  assert.deepEqual(safePatch.videoCandidates, []);
  assert.equal(safePatch.genStatus, 'done');
});

test('deleted candidate ids stay deleted even if recovery writes a new path', () => {
  const deletedCandidate = {
    candidateId: 'video-shot-a-job-123',
    path: '/tmp/shot-01-gateway.mp4',
    source: 'generate' as const,
    createdAt: 100,
  };
  const recoveredCandidate = {
    ...deletedCandidate,
    path: '/tmp/recovered/shot-01.mp4',
    createdAt: 200,
  };
  const current: WsShot = {
    id: 'shot-a',
    shotNo: '01-01',
    description: 'A',
    characterIds: [],
    videoCandidates: [],
    deletedVideoCandidateIds: [deletedCandidate.candidateId],
  };
  const safePatch = applyShotDeletionTombstones(current, { videoCandidates: [recoveredCandidate] });
  assert.deepEqual(safePatch.videoCandidates, []);
});

test('deleting a source copy cannot tombstone an explicitly adopted copy with the same id', () => {
  const source = { candidateId: 'shared-id', path: '/tmp/source.mp4', source: 'generate' as const, createdAt: 100 };
  const adopted = { ...source, path: '/tmp/adopted.mp4', createdAt: 200 };
  const accepted = acceptVideoCandidate({
    candidates: [adopted], path: adopted.path, expectedFingerprint: videoCandidateFingerprint(adopted), now: 300,
  });
  const current: WsShot = {
    shotNo: '01-01', description: '', characterIds: [], videoPath: adopted.path,
    videoProductionBinding: accepted.binding, videoReviews: [accepted.review],
    deletedVideoCandidatePaths: [source.path], deletedVideoCandidateIds: [source.candidateId],
  };
  assert.deepEqual(applyShotDeletionTombstones(current, { videoCandidates: [source, adopted] }).videoCandidates, [adopted]);
  assert.deepEqual(applyShotDeletionTombstones(current, { videoCandidates: [{ ...adopted, prompt: 'changed' }] }).videoCandidates, []);
  current.deletedVideoCandidatePaths!.push(adopted.path);
  assert.deepEqual(applyShotDeletionTombstones(current, { videoCandidates: [adopted] }).videoCandidates, []);
});

test('deleted canvas origin nodes stay deleted after a new copy path is created', () => {
  const copiedAgain = {
    candidateId: 'video-shot-a-canvas-node-1',
    path: '/tmp/project/shots/01-cv-new-timestamp.mp4',
    source: 'canvas' as const,
    originNodeId: 'node-canvas-video-1',
    createdAt: 300,
  };
  const current: WsShot = {
    id: 'shot-a',
    shotNo: '01-01',
    description: 'A',
    characterIds: [],
    videoCandidates: [],
    deletedVideoCandidateNodeIds: ['node-canvas-video-1'],
  };
  const safePatch = applyShotDeletionTombstones(current, { videoCandidates: [copiedAgain] });
  assert.deepEqual(safePatch.videoCandidates, []);
});

test('a newly generated candidate with a different path is still accepted', () => {
  const deleted = '/tmp/shot-01-old.mp4';
  const fresh = { path: '/tmp/shot-01-new.mp4', source: 'generate' as const, createdAt: 200 };
  assert.deepEqual(filterDeletedVideoCandidates([fresh], [deleted]), [fresh]);
});

test('patchShotById also respects deletion tombstones', () => {
  const candidate = { path: '/tmp/shot-01.mp4', source: 'generate' as const, createdAt: 100 };
  const current: WsShot = {
    id: 'shot-a',
    shotNo: '01-01',
    description: 'A',
    characterIds: [],
    videoCandidates: [],
    deletedVideoCandidatePaths: [candidate.path],
  };
  const safePatch = applyShotDeletionTombstones(current, { videoCandidates: [candidate] });
  assert.equal(current.id, 'shot-a');
  const result = patchShotById([current], current.id!, safePatch);
  assert.deepEqual(result.shots[0].videoCandidates, []);
});
