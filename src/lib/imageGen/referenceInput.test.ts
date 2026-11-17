import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEditReferences, prepareMinimaxReferences } from './referenceInput.ts';
const jpeg = new Uint8Array([255,216,255,224,0,16]);
const png = new Uint8Array([137,80,78,71,13,10,26,10]);

test('local .png holding JPEG and compressed PNG both use the returned JPEG bytes', async () => {
  for (const compress of [false, true]) {
    const load = async () => jpeg;
    const params = {referenceImageUrl:'/product.png'};
    assert.deepEqual(await prepareEditReferences(params, load, compress), [{binary:jpeg,mime:'image/jpeg',ext:'jpg'}]);
    const refs = await prepareMinimaxReferences(params, load, compress);
    assert.equal(refs[0].image_file, 'data:image/jpeg;base64,' + Buffer.from(jpeg).toString('base64'));
  }
});
test('base64 header is not trusted, multiple references retain order and pixels', async () => {
  const refs = await prepareEditReferences({referenceImageUrls:['a','b'],referenceImageB64:'data:image/png;base64,ignored'}, async (input) => input.referenceUrl==='a' ? png : jpeg);
  assert.deepEqual(refs.map(r => r.mime), ['image/png','image/jpeg','image/jpeg']);
});
test('remote MiniMax URLs stay remote without compression; compression validates returned bytes', async () => {
  const params = {referenceImageUrl:'https://example.test/product.png'};
  assert.equal((await prepareMinimaxReferences(params, async () => {throw new Error('must not load');}))[0].image_file, params.referenceImageUrl);
  assert.match((await prepareMinimaxReferences(params, async () => jpeg, true))[0].image_file, /^data:image\/jpeg/);
});
test('invalid and MiniMax-unsupported content is rejected before submission, not discarded', async () => {
  for (const prepare of [prepareEditReferences, prepareMinimaxReferences]) {
    await assert.rejects(prepare({referenceImageUrl:'a.png'}, async () => new TextEncoder().encode('<html>bad gateway</html>')), /图片/);
  }
  const webp = new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80]);
  await assert.rejects(prepareMinimaxReferences({referenceImageUrl:'a.webp'}, async () => webp), /JPEG.*PNG/);
  const oversized = new Uint8Array(10*1024*1024); oversized.set(jpeg);
  await assert.rejects(prepareMinimaxReferences({referenceImageUrl:'a.jpg'}, async () => oversized), /10 MB/);
});
