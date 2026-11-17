/** Real adoption action, isolated state and mocked IPC. No provider or file writes. */
import assert from 'node:assert/strict';
import { installShims } from './preload.mjs';
import { videoCandidateFingerprint } from '../../src/lib/workshop/productionLifecycle.ts';

installShims();
window.crypto = globalThis.crypto;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error('Network forbidden');
};
window.__TAURI_IPC__ = ({ callback, error, cmd, __tauriModule }) => {
  if (__tauriModule === 'Http') networkCalls++;
  if (cmd === 'execute_command') window[`_${callback}`]({ exit_code: 1 });
  else window[`_${error}`](`Unexpected IPC: ${cmd ?? __tauriModule}`);
};

const h = await import('./.gen/harness.mjs');
const store = h.useWorkshopStore;
const data = h.emptyWorkshopData('adoption-test');
const candidates = ['01-01', '01-02'].map((shotNo) => ({
  path: `/isolated/${shotNo}.mp4`, source: 'generate', createdAt: 1,
  inputFingerprint: `video-input-${shotNo}`,
}));
data.currentStep = 'generate';
data.steps.generate = { status: 'stale', updatedAt: 1 };
data.shots = candidates.map((candidate, index) => ({
  shotNo: `01-0${index + 1}`, description: '', characterIds: [], videoCandidates: [candidate],
  lastProductionPacket: { inputFingerprint: candidate.inputFingerprint },
}));
let saves = 0;
store.setState({ data, scheduleSave: () => { saves++; }, commitNow: async () => {} });
h.useSettingsStore.setState({ qualityReviewEnabled: false });

function adopt(index) {
  const candidate = candidates[index];
  store.getState().selectVideoCandidate(`01-0${index + 1}`, candidate.path, videoCandidateFingerprint(candidate));
}

try {
  adopt(0);
  assert.equal(store.getState().data.steps.generate.status, 'stale', 'one adopted shot is not all shots');
  adopt(1);
  assert.equal(store.getState().data.steps.generate.status, 'done', 'last adoption completes the badge immediately');
  assert.equal(store.getState().data.currentStep, 'generate', 'adoption must not navigate away');
  assert.equal(store.getState().data.steps.handoff.status, 'pending');
  // Ensure the second receipt is distinct, not a same-millisecond duplicate.
  await new Promise((resolve) => setTimeout(resolve, 5));
  adopt(0);
  assert.equal(store.getState().data.steps.generate.status, 'done', 'repeated adoption stays complete');
  assert.equal(store.getState().data.shots[0].videoReviews.length, 2);
  store.getState().reconcileStepStates();
  assert.equal(store.getState().data.steps.generate.status, 'done', 'store reconciliation agrees with adoption');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(store.getState().data.steps.generate.status, 'done', 'tail capture failure does not undo adoption');
  assert.equal(networkCalls, 0);
  assert.ok(saves > 0);
  console.log('PASS: last adoption, repeated adoption, reconciliation, no forced navigation, handoff unchanged, no network/file writes');
} finally {
  store.setState({ data: null, project: null });
}
