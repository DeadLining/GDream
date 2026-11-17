/** Exercise the real store recovery with in-memory IPC files. No live project writes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installShims } from './preload.mjs';
import { acceptVideoCandidate, videoCandidateFingerprint } from '../../src/lib/workshop/productionLifecycle.ts';
import { normalizeLegacyWorkshopData } from '../../src/lib/workshop/legacyMigration.ts';

installShims();
window.crypto = globalThis.crypto;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('Network forbidden'); };
let bytes = Buffer.from('original adopted video fixture');
const checksum = createHash('sha256').update(bytes).digest('hex');
const candidate = {
  candidateId: 'same-id-as-deleted-source', path: '/fixture/adopted.mp4', source: 'generate',
  createdAt: 100, inputFingerprint: 'input-1', checksum,
};
const accepted = acceptVideoCandidate({
  candidates: [candidate], path: candidate.path, expectedFingerprint: videoCandidateFingerprint(candidate), now: 200,
});
const nodes = [{ data: {
  workshopRef: { projectId: 'p1', kind: 'shot', role: 'shot-video', id: '01-01', shotId: 'shot-1' },
  assetVersions: [candidate],
} }];
let readBarrier;
let readStarted;
window.__TAURI_IPC__ = async ({ callback, error, __tauriModule, message }) => {
  try {
    assert.equal(__tauriModule, 'Fs');
    let result;
    if (message.cmd === 'readTextFile') {
      assert.equal(message.path, '.gdream/projects/canvas-1/canvas.json');
      result = JSON.stringify({ nodes });
    } else if (message.cmd === 'readFile') {
      assert.equal(message.path, candidate.path);
      readStarted?.();
      if (readBarrier) await readBarrier;
      result = [...bytes];
    } else throw new Error(`Unexpected IPC: ${message.cmd}`);
    window[`_${callback}`](result);
  } catch (err) { window[`_${error}`](String(err)); }
};

const h = await import('./.gen/harness.mjs');
const store = h.useWorkshopStore;
const original = h.emptyWorkshopData('p1');
original.canvasProjectId = 'canvas-1';
original.shots = [{
  id: 'shot-1', shotNo: '01-01', description: '', characterIds: [], videoPath: candidate.path,
  videoCandidates: [], videoReviews: [accepted.review], videoProductionBinding: accepted.binding,
  deletedVideoCandidateIds: [candidate.candidateId], deletedVideoCandidatePaths: ['/fixture/deleted-source.mp4'],
}];
let commits = 0;
const reset = () => store.setState({
  data: structuredClone(original), scheduleSave: () => {}, commitNow: async () => { commits++; },
});

try {
  reset();
  assert.equal(await store.getState().restoreAdoptedVideoCandidatesFromCanvas(), 1);
  assert.deepEqual(store.getState().data.shots[0].videoCandidates, [candidate]);
  const normalized = normalizeLegacyWorkshopData(store.getState().data, 'p1').data.shots[0].videoCandidates;
  assert.equal(normalized.length, 1);
  assert.equal(videoCandidateFingerprint(normalized[0]), accepted.binding.candidateFingerprint);
  assert.equal(normalized[0].checksum, candidate.checksum);
  assert.equal(await store.getState().restoreAdoptedVideoCandidatesFromCanvas(), 0, 'repeated recovery is idempotent');
  assert.equal(commits, 1);

  reset();
  bytes = Buffer.from('changed video bytes');
  assert.equal(await store.getState().restoreAdoptedVideoCandidatesFromCanvas(), 0, 'checksum mismatch must remain blocked');
  assert.deepEqual(store.getState().data.shots[0].videoCandidates, []);

  reset();
  bytes = Buffer.from('original adopted video fixture');
  let release;
  readBarrier = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { readStarted = resolve; });
  const pending = store.getState().restoreAdoptedVideoCandidatesFromCanvas();
  await started;
  store.setState({ data: h.emptyWorkshopData('other-project') });
  release();
  assert.equal(await pending, 0, 'late recovery must not patch another project');
  assert.equal(store.getState().data.projectId, 'other-project');
  assert.equal(commits, 1);
  assert.equal(networkCalls, 0);
  console.log('PASS: exact record recovery, SHA-256 rejection, tombstone preservation, reopen normalization, idempotence, project-switch guard; no network/live writes');
} finally {
  store.setState({ project: null, data: null });
}
