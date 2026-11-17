import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcpPromptContent, mediaToAcpContent } from './mediaFilter.ts';

test('native inline images survive the GDream ACP boundary', () => {
  assert.deepEqual(mediaToAcpContent({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }),
    { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' });
});
test('text remains ordered with native images', () => {
  const result = buildAcpPromptContent([{ type: 'text', text: 'question' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'YWJj' } }]);
  assert.deepEqual(result.map((block) => block.type), ['text', 'image']);
});
test('unresolved URL images are rejected, never misrepresented as visual input', () => {
  assert.throws(() => mediaToAcpContent({ type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } }), /图片.*加载/);
});
test('unsupported video fails explicitly rather than silently losing media', () => {
  assert.throws(() => mediaToAcpContent({ type: 'video', source: { type: 'base64', media_type: 'video/mp4', data: 'YWJj' } }), /视频/);
});
