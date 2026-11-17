import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeContent, installNativeToolImages } from '../gdream-native-images.mjs';

function store() {
  const saved = [], validated = [];
  return {
    saved, validated,
    imageLimits: { maxImagesPerMessage: 2, maxImageBytes: 20, maxMessageImageBytes: 25, mediaTypes: ['image/png'] },
    async validateImage(input) { validated.push(input); },
    async saveImage(input) { saved.push(input); return { attachmentId: `image-${saved.length}`, mediaType: input.mediaType }; },
  };
}
const image = { type: 'image', data: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64'), mimeType: 'image/png' };
test('ACP images are durably stored and remain ordered with text', async () => {
  const attachments = store();
  const content = await nativeContent([{ type: 'text', text: 'question' }, image], attachments);
  assert.deepEqual(content.map((b) => b.type), ['text', 'image']);
  assert.equal(content[1].attachment.attachmentId, 'image-1');
  assert.equal(attachments.saved[0].data.toString('base64'), image.data);
});
test('invalid MIME, base64 and batch limits reject before committing images', async () => {
  for (const blocks of [[{ ...image, mimeType: 'text/html' }], [{ ...image, data: 'bad!' }], [image, image, image]]) {
    const attachments = store();
    await assert.rejects(nativeContent(blocks, attachments));
    assert.equal(attachments.saved.length, 0);
  }
});
test('MCP post-execute replaces discarded-image placeholders with native references', async () => {
  let listener;
  const ctx = { attachments: store(), on(name, fn) { assert.equal(name, 'tools/post-execute'); listener = fn; } };
  installNativeToolImages(ctx, true);
  const decision = await listener({ name: 'mcp__gdream__read_image', signal: new AbortController().signal },
    { isError: false, value: { content: [{ type: 'text', text: 'source' }, image] }, content: [{ type: 'text', text: 'content discarded' }] },
    async () => ({ kind: 'accept' }));
  assert.deepEqual(decision.content.map((b) => b.type), ['text', 'image']);
});
test('text-only channel and downstream denial never silently accept images', async () => {
  let listener;
  const ctx = { attachments: store(), on(_name, fn) { listener = fn; } };
  installNativeToolImages(ctx, false);
  const result = { isError: false, value: { content: [image] } };
  const exec = { name: 'mcp__gdream__read_image', signal: new AbortController().signal };
  assert.equal((await listener(exec, result, async () => ({ kind: 'accept' }))).kind, 'block');
  const deny = { kind: 'block', feedback: [] };
  assert.equal(await listener(exec, result, async () => deny), deny);
  assert.equal(ctx.attachments.saved.length, 0);
});

test('legacy PNG declaration with JPEG bytes is normalized before validation', async () => {
 const attachments=store(); attachments.imageLimits.mediaTypes.push('image/jpeg');
 await nativeContent([{...image,data:Buffer.from([255,216,255,224]).toString('base64')}],attachments);
 assert.equal(attachments.validated[0].mediaType,'image/jpeg');
 assert.equal(attachments.saved[0].mediaType,'image/jpeg');
});
test('HTML labelled PNG and detected types outside capability are rejected',async()=>{
 for(const data of [Buffer.from('<html>'),Buffer.from([255,216,255,224])]) {
  const attachments=store();await assert.rejects(nativeContent([{...image,data:data.toString('base64')}],attachments));
  assert.equal(attachments.saved.length,0);
 }
});

test('real DSH decoder admits mislabeled images and rejects corrupt batches before saving', async () => {
  const { default: sharp } = await import('sharp');
  const { validateImageFile } = await import('@deepseek-ai/dsh-attachment-local');
  const attachments = store();
  attachments.imageLimits = { maxImagesPerMessage: 4, maxImageBytes: 100000,
    maxMessageImageBytes: 400000, mediaTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] };
  attachments.validateImage = (input) => validateImageFile(input,
    { maxImageBytes: 100000, maxImagePixels: 100000 });
  const valid = [];
  for (const format of ['png', 'jpeg', 'gif', 'webp']) {
    const data = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } })
      .toFormat(format).toBuffer();
    valid.push({ type: 'image', data: data.toString('base64'), mimeType: 'image/png' });
  }
  const result = await nativeContent(valid, attachments);
  assert.deepEqual(result.map((b) => b.attachment.mediaType), attachments.imageLimits.mediaTypes);
  attachments.saved.length = 0;
  await assert.rejects(nativeContent([valid[1], image], attachments));
  assert.equal(attachments.saved.length, 0, 'a corrupt second image must not save the first');
});
