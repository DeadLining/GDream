import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRejectedBatchRepairPrompt,
  parseRejectedShotBatch,
  summarizeRejectedBatch,
} from './rejectedBatch.ts';

const valid = JSON.stringify({
  savedAt: '2026-09-15T10:00:00.000Z',
  mode: 'merge',
  shotNos: '02-01,02-02',
  error: '待写入分镜数据质量检查未通过\n02-01: characterIds 包含不存在的角色 ID：qin_coach',
  shots: [
    { shotNo: '02-01', characterIds: ['qin_coach'], sceneId: 'scene-02-01' },
    { shotNo: '02-02', characterIds: [] },
  ],
});

test('parses a well-formed rejected batch file', () => {
  const batch = parseRejectedShotBatch(valid);
  assert.ok(batch);
  assert.equal(batch.mode, 'merge');
  assert.equal(batch.shots.length, 2);
  assert.equal(batch.shots[0].shotNo, '02-01');
});

test('rejects corrupt or empty batch files instead of feeding dirty data to the model', () => {
  assert.equal(parseRejectedShotBatch(null), null);
  assert.equal(parseRejectedShotBatch('not json'), null);
  assert.equal(parseRejectedShotBatch('[]'), null);
  assert.equal(parseRejectedShotBatch(JSON.stringify({ mode: 'merge', shots: [] })), null);
  assert.equal(parseRejectedShotBatch(JSON.stringify({ shots: [{ shotNo: 'x' }] }))?.mode, 'merge');
});

test('summarizes the rejected batch for the panel', () => {
  const batch = parseRejectedShotBatch(valid)!;
  assert.equal(summarizeRejectedBatch(batch), '2 镜（02-01,02-02）');
});

test('repair prompt carries the original payload, error, and same mode', () => {
  const batch = parseRejectedShotBatch(valid)!;
  const prompt = buildRejectedBatchRepairPrompt(batch);
  assert.match(prompt, /qin_coach/);
  assert.match(prompt, /02-01/);
  assert.match(prompt, /idManifest/);
  assert.match(prompt, /相同 mode（merge）/);
  assert.match(prompt, /禁止重写整批/);
  assert.match(prompt, /entryState\.characters/);
});

test('repair works on rejected JSON, never requires looking up unsaved shot references', () => {
  const prompt = buildRejectedBatchRepairPrompt(parseRejectedShotBatch(valid)!);
  assert.match(prompt, /失败请求的原始数据，不是已经存在于分镜表的记录/);
  assert.match(prompt, /禁止.*workshop_get_shot_refs.*workshop_update_shot.*workshop_update_shot_refs/);
  assert.match(prompt, /如有 next_call/);
  assert.match(prompt, /写入成功后汇报本批结果并结束/);
});
