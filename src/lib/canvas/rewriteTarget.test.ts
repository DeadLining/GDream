import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRewriteSnapshot } from './rewriteTarget.ts';
const original = { projectId: 'A', data: '{"description":"old"}', prompt: 'draft' };
const current = { ...original, switching: false, aborted: false };
test('unchanged rewrite target is writable', () => assert.doesNotThrow(() => assertRewriteSnapshot(original, current)));
test('project switch and cancellation reject late output', () => {
  for (const change of [{ projectId: 'B' }, { switching: true }, { aborted: true }]) {
    assert.throws(() => assertRewriteSnapshot(original, { ...current, ...change }), /取消|切换/);
  }
});
test('saved edits, unsaved edits and node removal cannot be overwritten', () => {
  for (const change of [{ data: '{"description":"new"}' }, { prompt: 'new draft' }, { data: undefined }]) {
    assert.throws(() => assertRewriteSnapshot(original, { ...current, ...change }), /修改/);
  }
});
test('selecting another node permits result on the original unchanged node', () => {
  assert.doesNotThrow(() => assertRewriteSnapshot(original, { ...current, prompt: undefined }));
});
