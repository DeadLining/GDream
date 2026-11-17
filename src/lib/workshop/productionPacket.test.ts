import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShotProductionPacket,
  normalizeShotProductionPacket,
  recoveredShotProductionPacket,
} from './productionPacket.ts';

test('production packet freezes ordered references and continuity inputs', () => {
  const packet = buildShotProductionPacket({
    projectId: 'p1',
    shotNo: '01-02',
    jobId: 'job-1',
    productionRunId: 'production-run-job-1',
    sourceScriptRevisionId: 'script-1',
    model: 'minimax-h3',
    engineId: 'minimax-hailuo-h3',
    prompt: '单一连续动作',
    referencePaths: ['/scene.png', '/character.png', '/tail.png', '/start.png', '/end.png'],
    referenceLabels: ['场景', '角色', '上一镜尾帧', '首帧', '尾帧'],
    referenceSignature: 'refs-test-1',
    audioPaths: ['/dialogue.mp3'],
    videoPaths: [],
    params: { ratio: '16:9', duration: 5, boundaryFrames: true },
    continuityMode: 'inherit',
    previousTailPath: '/tail.png',
    startFramePath: '/start.png',
    endFramePath: '/end.png',
    createdAt: 123,
  });
  assert.equal(packet.packetVersion, 1);
  assert.deepEqual(packet.referenceLabels, ['场景', '角色', '上一镜尾帧', '首帧', '尾帧']);
  assert.equal(packet.previousTailPath, '/tail.png');
  assert.equal(packet.jobId, 'job-1');
  assert.equal(packet.productionRunId, 'production-run-job-1');
  assert.equal(packet.referenceSignature, 'refs-test-1');
  assert.match(packet.inputFingerprint, /^video-input-/);
});

test('production packet fingerprint changes when any ordered execution input changes', () => {
  const input = {
    projectId: 'p1', shotNo: '01-01', model: 'minimax-h3', engineId: 'h3', prompt: '动作',
    referencePaths: ['/a.png'], audioPaths: [], videoPaths: [], params: { ratio: '16:9' }, createdAt: 1,
  };
  const first = buildShotProductionPacket(input);
  const second = buildShotProductionPacket({ ...input, referencePaths: ['/b.png'] });
  assert.notEqual(first.inputFingerprint, second.inputFingerprint);
});

test('normalizes incomplete legacy production packets without inventing a valid fingerprint', () => {
  const normalized = normalizeShotProductionPacket({
    model: 'legacy-model',
    referencePaths: undefined as unknown as string[],
    params: undefined as unknown as Record<string, unknown>,
  }, { projectId: 'p1', shotNo: '01-01' });
  assert.deepEqual(normalized, {
    packetVersion: 1,
    projectId: 'p1',
    shotNo: '01-01',
    jobId: undefined,
    productionRunId: undefined,
    sourceScriptRevisionId: undefined,
    model: 'legacy-model',
    engineId: '',
    prompt: '',
    referencePaths: [],
    referenceLabels: [],
    audioPaths: [],
    videoPaths: [],
    params: {},
    continuityMode: undefined,
    previousTailPath: undefined,
    startFramePath: undefined,
    endFramePath: undefined,
    inputFingerprint: '',
    createdAt: 0,
  });
});

test('recovery uses the task-owned packet even after a later attempt replaced the shot packet', () => {
  const taskPacket = buildShotProductionPacket({
    projectId: 'p1', shotNo: '01-01', model: 'h3', engineId: 'h3', prompt: 'first attempt',
    referencePaths: ['/first.png'], params: { h3Task: 'ref2va' }, createdAt: 1,
  });
  const laterPacket = buildShotProductionPacket({
    projectId: 'p1', shotNo: '01-01', model: 'h3', engineId: 'h3', prompt: 'later attempt',
    referencePaths: ['/later.png'], params: { h3Task: 'ref2va' }, createdAt: 2,
  });

  const recovered = recoveredShotProductionPacket({
    taskPacket,
    latestShotPacket: laterPacket,
    inputFingerprint: taskPacket.inputFingerprint,
    jobId: 'job-recovered',
    productionRunId: 'production-run-job-recovered',
  });

  assert.equal(recovered?.prompt, 'first attempt');
  assert.deepEqual(recovered?.referencePaths, ['/first.png']);
  assert.equal(recovered?.jobId, 'job-recovered');
  assert.equal(recovered?.productionRunId, 'production-run-job-recovered');
});

test('recovery rejects packets whose input fingerprint does not match the durable task', () => {
  const packet = buildShotProductionPacket({
    projectId: 'p1', shotNo: '01-01', model: 'h3', engineId: 'h3', prompt: 'attempt',
    referencePaths: ['/image.png'], createdAt: 1,
  });
  assert.equal(recoveredShotProductionPacket({
    latestShotPacket: packet,
    inputFingerprint: 'different-fingerprint',
    jobId: 'job-1',
    productionRunId: 'run-1',
  }), undefined);
});


test('anchoring an existing tail reference changes the execution fingerprint', () => {
  const input = { projectId: 'p1', shotNo: '01-02', model: 'h3', engineId: 'h3',
    prompt: 'Open on <Picture 4>', referencePaths: ['scene', 'suhe', 'chenyu', 'tail'],
    previousTailPath: 'tail', params: { h3Task: 'ref2va' } };
  const soft = buildShotProductionPacket(input);
  const anchored = buildShotProductionPacket({ ...input, startFramePath: 'tail' });
  assert.notEqual(soft.inputFingerprint, anchored.inputFingerprint);
  assert.equal(anchored.startFramePath, 'tail');
  assert.equal(anchored.params.h3StartFramePath, 'tail');
  assert.deepEqual(anchored.referencePaths, soft.referencePaths);
});
