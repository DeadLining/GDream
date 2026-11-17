import test from 'node:test';
import assert from 'node:assert/strict';
import { imageBytesInput, mediaTypeForPath, normalizeLocalMediaPath } from './mediaInput.ts';

test('normalizes file URI paths before local media loading', () => {
  assert.equal(normalizeLocalMediaPath('file:///data/minimax-h3/reference-1.png'), '/data/minimax-h3/reference-1.png');
  assert.equal(normalizeLocalMediaPath('/tmp/reference.png'), '/tmp/reference.png');
});

test('recognizes common audio MIME types for multimodal conditions', () => {
  assert.equal(mediaTypeForPath('/tmp/reference.mp3'), 'audio/mpeg');
  assert.equal(mediaTypeForPath('/tmp/reference.wav'), 'audio/wav');
  assert.equal(mediaTypeForPath('/tmp/reference.m4a'), 'audio/mp4');
});

test('JPEG content is sent as JPEG even when disk filename says PNG', () => {
  const result=imageBytesInput(Uint8Array.from([255,216,255,224,0,16]));
  assert.equal(result.mediaType,'image/jpeg');
  assert.ok(result.dataUrl.startsWith('data:image/jpeg;base64,'));
});
test('non-image bytes cannot masquerade as image references', () => {
  assert.throws(()=>imageBytesInput(new TextEncoder().encode('<html>error</html>')));
});
