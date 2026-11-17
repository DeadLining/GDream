import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWebImages, MAX_NATIVE_IMAGE_BYTES, nativeImageBlock } from './nativeImageContent.ts';

test('native PNG bytes become actual model content, not an interpretation', () => {
  const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,0]);
  const block = nativeImageBlock(bytes);
  assert.equal(block.type, 'image');
  if (block.type === 'image' && block.source.type === 'base64') {
    assert.equal(block.source.media_type, 'image/png');
    assert.deepEqual(Buffer.from(block.source.data, 'base64'), Buffer.from(bytes));
  } else assert.fail('missing native image');
});
test('HTML disguised as an image and oversized images fail explicitly', () => {
  assert.throws(() => nativeImageBlock(new TextEncoder().encode('<html>sign in</html>')), /不是支持/);
  assert.throws(() => nativeImageBlock(new Uint8Array(MAX_NATIVE_IMAGE_BYTES + 1)), /5 MB/);
});
test('web image references resolve relative/lazy URLs and exclude trackers/scripts', () => {
  assert.deepEqual(extractWebImages(`<img src="/a.png" alt="产品"><img data-src="b.webp?a=1&amp;b=2"><img src="/a.png"><img src="javascript:bad"><img src="/track" width="1"><script>"<img src='/fake'>"</script>`, 'https://example.com/page/'), [
    { url: 'https://example.com/a.png', alt: '产品' },
    { url: 'https://example.com/page/b.webp?a=1&b=2', alt: '' },
  ]);
});
test('web extraction is bounded and excludes credentials in URLs', () => {
  assert.equal(extractWebImages('<img src="https://user:pass@example.com/a"><img src="a"><img src="b">', 'https://example.com', 1).length, 1);
});
