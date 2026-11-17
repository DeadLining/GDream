import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionRun, productionInputFingerprint, productionRunIdForJob, reconcileProductionRunsFromJobs, renderInputFingerprint, updateProductionRunStatus } from './run.ts';

test('production input fingerprint changes when execution inputs change', () => {
  const base = {
    kind: 'video' as const,
    engineId: 'minimax-h3',
    endpoint: '/v1/videos',
    prompt: 'single atomic shot',
    referenceUrls: ['/tmp/reference.png'],
    params: { duration: 5 },
  };
  assert.equal(productionInputFingerprint(base), productionInputFingerprint({ ...base }));
  assert.notEqual(productionInputFingerprint(base), productionInputFingerprint({ ...base, prompt: 'different shot' }));
  assert.notEqual(productionInputFingerprint(base), productionInputFingerprint({ ...base, audioUrls: ['/tmp/reference.mp3'] }));
  assert.notEqual(productionInputFingerprint(base), productionInputFingerprint({ ...base, videoUrls: ['/tmp/reference.mp4'] }));
});

test('ProductionRun owns the durable job mapping and terminal transitions', () => {
  assert.equal(productionRunIdForJob('job-1'), 'production-run-job-1');
  const run = createProductionRun({ projectId: 'p1', shotNo: '01', kind: 'video', inputFingerprint: 'input-1', jobId: 'job-1', now: 10 });
  assert.equal(run.runId, 'production-run-job-1');
  assert.equal(run.status, 'running');
  const done = updateProductionRunStatus(run, 'succeeded', 20);
  assert.equal(done.updatedAt, 20);
  assert.throws(() => updateProductionRunStatus(done, 'running', 30), /terminal/);
});

test('render input fingerprint changes when timeline or export settings change', () => {
  const base = {
    projectId: 'p1',
    timeline: { clips: [{ path: '/tmp/a.mp4', start: 0 }] },
    settings: { resolution: '1080p', fps: 30 },
    outputPath: '/tmp/final.mp4',
  };
  assert.equal(renderInputFingerprint(base), renderInputFingerprint({ ...base }));
  assert.notEqual(renderInputFingerprint(base), renderInputFingerprint({ ...base, timeline: { clips: [] } }));
  assert.notEqual(renderInputFingerprint(base), renderInputFingerprint({ ...base, settings: { resolution: '4k', fps: 30 } }));
  assert.notEqual(renderInputFingerprint(base), renderInputFingerprint({ ...base, outputPath: '/tmp/other.mp4' }));
});

test('reconciles render runs with persisted queue terminal states', () => {
  const runs = [
    createProductionRun({ projectId: 'p1', kind: 'render', inputFingerprint: 'a', jobId: 'job-done', now: 1 }),
    createProductionRun({ projectId: 'p1', kind: 'render', inputFingerprint: 'b', jobId: 'job-failed', now: 1 }),
    createProductionRun({ projectId: 'p1', kind: 'render', inputFingerprint: 'c', jobId: 'job-active', now: 1 }),
  ];
  const reconciled = reconcileProductionRunsFromJobs(runs, [
    { id: 'job-done', status: 'completed' },
    { id: 'job-failed', status: 'failed' },
    { id: 'job-active', status: 'running' },
  ], 10);
  assert.equal(reconciled[0].status, 'succeeded');
  assert.equal(reconciled[1].status, 'failed');
  assert.equal(reconciled[2].status, 'running');
});
