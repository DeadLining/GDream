import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPromptPreview } from './promptScroll.ts';
test('unfocused highlighted preview follows native scroll without changing focus or content', () => {
  const input = { scrollTop: 125, clientWidth: 680, clientHeight: 180 };
  const preview = { scrollTop: 0, style: { width: '', height: '' } };
  syncPromptPreview(input, preview);
  assert.deepEqual(preview, { scrollTop: 125, style: { width: '680px', height: '180px' } });
  input.scrollTop = 20;
  syncPromptPreview(input, preview);
  assert.equal(preview.scrollTop, 20);
});
test('remounted preview restores reading position after editing; detached layers are safe', () => {
  const input = { scrollTop: 500, clientWidth: 320, clientHeight: 100 };
  syncPromptPreview(input, null);
  syncPromptPreview(null, null);
  const preview = { scrollTop: 0, style: { width: '', height: '' } };
  syncPromptPreview(input, preview);
  assert.equal(preview.scrollTop, 500);
  assert.equal(preview.style.width, '320px');
});
